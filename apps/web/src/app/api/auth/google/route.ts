import { accounts, referrals } from '@gym/db';
import { effectiveTier } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { canCreateSession } from '@/lib/accountStatus';
import { createSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { allowedGoogleClientIds, verifyGoogleIdToken } from '@/lib/google';
import { json, preflight, readJson } from '@/lib/http';
import { verifyPassword } from '@/lib/password';
import { grantDiscount } from '@/lib/promoEconomy';
import { clientIp, rateLimit } from '@/lib/rateLimit';

/** Referral reward window (SCALE-UP-PLAN §1.3 / §7.2). */
const REFERRAL_DISCOUNT_PCT = 20;
const REFERRAL_GRANT_DAYS = 90;

/**
 * Same wiring as auth/register — NEW-ACCOUNT path only (step 3 below). If
 * anyone invited this email, flip their still-'pending' referral(s) to
 * 'joined' and grant BOTH parties a 20%/90-day discount. Best-effort: a
 * failure here must never fail the sign-in itself.
 */
async function wireReferralsForNewAccount(accountId: string, email: string): Promise<void> {
  try {
    const db = getDb();
    const joined = await db
      .update(referrals)
      .set({ inviteeId: accountId, status: 'joined' })
      .where(and(eq(referrals.inviteeEmail, email), eq(referrals.status, 'pending')))
      .returning({ referrerId: referrals.referrerId });

    if (joined.length === 0) return;

    const expiresAt = new Date(Date.now() + REFERRAL_GRANT_DAYS * 24 * 60 * 60 * 1000);
    await grantDiscount({ accountId, source: 'referral', pct: REFERRAL_DISCOUNT_PCT, expiresAt });
    for (const row of joined) {
      await grantDiscount({
        accountId: row.referrerId,
        source: 'referral',
        pct: REFERRAL_DISCOUNT_PCT,
        expiresAt,
      });
    }
  } catch {
    // Best-effort — never fail sign-in for this.
  }
}

/**
 * POST /api/auth/google — exchange a verified Google ID token for a session.
 * Same contract as /api/auth/login: 200 {token, user}.
 * 503 not_configured until GOOGLE_CLIENT_ID(S) is set;
 * 401 bad_credentials on any verification failure;
 * 409 link_required when the email already has a password account and no
 *     `password` was sent — retrying WITH that account's password proves
 *     ownership and links the Google subject onto the SAME account.
 */

export const runtime = 'nodejs';

const bodySchema = z.object({
  idToken: z.string().min(1),
  /** Only for linking: the existing password account's password. */
  password: z.string().min(1).optional(),
});

const publicColumns = {
  id: accounts.id,
  email: accounts.email,
  displayName: accounts.displayName,
  tier: accounts.tier,
  tierExpiresAt: accounts.tierExpiresAt,
  status: accounts.status,
};

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  // Token-guessing damping: 10 attempts/min per IP (in-memory, per instance).
  const limited = rateLimit({
    route: 'auth/google',
    limit: 10,
    windowMs: 60_000,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const allowedAuds = allowedGoogleClientIds();
  if (allowedAuds.length === 0) return json({ error: 'not_configured' }, 503);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const identity = await verifyGoogleIdToken(parsed.data.idToken, allowedAuds);
  if (!identity) return json({ error: 'bad_credentials' }, 401);

  const db = getDb();

  // 1. Returning Google user — matched by stable subject id.
  let user = (
    await db
      .select(publicColumns)
      .from(accounts)
      .where(eq(accounts.googleSub, identity.sub))
      .limit(1)
  )[0];

  // 2. An account already claims this (verified) email. We must NOT silently
  //    merge googleSub onto it: registration never proves email ownership, so
  //    an attacker could pre-create a password account under the victim's
  //    email and inherit their Google sign-in (account pre-hijacking).
  //    Linking therefore requires proving the password: without one the
  //    client gets 409 link_required, asks the user for the account password
  //    and retries with it — a verified password links the Google subject
  //    onto that SAME account (one human, one account, one data set).
  if (!user) {
    const existing = (
      await db
        .select({
          id: accounts.id,
          passwordHash: accounts.passwordHash,
          status: accounts.status,
        })
        .from(accounts)
        .where(eq(accounts.email, identity.email))
        .limit(1)
    )[0];

    if (existing) {
      if (!existing.passwordHash) {
        // Same email, no password, but not matched by our sub in step 1:
        // another Google subject already owns this row. Never merge across
        // subjects.
        return json({ error: 'bad_credentials' }, 401);
      }
      if (!parsed.data.password) return json({ error: 'link_required' }, 409);
      const passwordOk = await verifyPassword(parsed.data.password, existing.passwordHash);
      if (!passwordOk) return json({ error: 'bad_credentials' }, 401);
      if (!canCreateSession(existing.status)) {
        return json({ error: 'bad_credentials' }, 401);
      }
      // Password proven — link this Google subject to the account for good.
      try {
        user = (
          await db
            .update(accounts)
            .set({ googleSub: identity.sub })
            .where(eq(accounts.id, existing.id))
            .returning(publicColumns)
        )[0];
      } catch {
        // Unique race on google_sub: the same subject landed on a row between
        // step 1 and this write — re-read by sub.
        user = (
          await db
            .select(publicColumns)
            .from(accounts)
            .where(eq(accounts.googleSub, identity.sub))
            .limit(1)
        )[0];
      }
      if (!user) {
        // The link write failed for a reason OTHER than the sub race (the
        // re-read found nothing — e.g. a transient DB error). Surface a
        // server error: falling through to the insert below would hit the
        // email unique constraint and misreport this VERIFIED password as
        // bad_credentials ("password doesn't match") on the client.
        return json({ error: 'server_error' }, 500);
      }
    }
  }

  // 3. First sign-in — create a Google-only account (passwordHash stays null).
  let createdNewAccount = false;
  if (!user) {
    try {
      user = (
        await db
          .insert(accounts)
          .values({
            email: identity.email,
            googleSub: identity.sub,
            displayName: identity.displayName,
          })
          .returning(publicColumns)
      )[0];
      createdNewAccount = user !== undefined;
    } catch {
      // Unique race: the same sub/email landed between the checks above and
      // this insert — re-read by sub. Not treated as a new-account creation
      // here: the concurrent request that actually won the insert is the one
      // that runs the referral wiring below, so this request must not repeat it.
      user = (
        await db
          .select(publicColumns)
          .from(accounts)
          .where(eq(accounts.googleSub, identity.sub))
          .limit(1)
      )[0];
    }
  }

  if (!user || !canCreateSession(user.status)) {
    return json({ error: 'bad_credentials' }, 401);
  }

  if (createdNewAccount) {
    await wireReferralsForNewAccount(user.id, user.email);
  }

  const token = await createSession(user.id);
  // Strip the internal expiry column and return the EFFECTIVE tier (a lapsed
  // paid tier signs in as 'starter', matching userForToken — no cron).
  const { tierExpiresAt, status: _status, ...publicUser } = user;
  return json(
    {
      token,
      user: { ...publicUser, tier: effectiveTier(user.tier, tierExpiresAt, new Date()) },
    },
    200,
  );
}
