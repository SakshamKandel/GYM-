import { accounts } from '@gym/db';
import { effectiveTier } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { allowedGoogleClientIds, verifyGoogleIdToken } from '@/lib/google';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';

/**
 * POST /api/auth/google — exchange a verified Google ID token for a session.
 * Same contract as /api/auth/login: 200 {token, user}.
 * 503 not_configured until GOOGLE_CLIENT_ID(S) is set;
 * 401 bad_credentials on any verification failure.
 */

export const runtime = 'nodejs';

const bodySchema = z.object({ idToken: z.string().min(1) });

const publicColumns = {
  id: accounts.id,
  email: accounts.email,
  displayName: accounts.displayName,
  tier: accounts.tier,
  tierExpiresAt: accounts.tierExpiresAt,
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
  //    email and inherit their Google sign-in (account pre-hijacking). Refuse
  //    to auto-link a password account — linking Google requires proving the
  //    password first, via an explicit authenticated link step.
  if (!user) {
    const existing = (
      await db
        .select({ id: accounts.id, passwordHash: accounts.passwordHash })
        .from(accounts)
        .where(eq(accounts.email, identity.email))
        .limit(1)
    )[0];

    if (existing) {
      if (existing.passwordHash) return json({ error: 'link_required' }, 409);
      // Same email, no password, but not matched by our sub in step 1: another
      // Google subject already owns this row. Never merge across subjects.
      return json({ error: 'bad_credentials' }, 401);
    }
  }

  // 3. First sign-in — create a Google-only account (passwordHash stays null).
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
    } catch {
      // Unique race: the same sub/email landed between the checks above and
      // this insert — re-read by sub.
      user = (
        await db
          .select(publicColumns)
          .from(accounts)
          .where(eq(accounts.googleSub, identity.sub))
          .limit(1)
      )[0];
    }
  }

  if (!user) return json({ error: 'bad_credentials' }, 401);

  const token = await createSession(user.id);
  // Strip the internal expiry column and return the EFFECTIVE tier (a lapsed
  // paid tier signs in as 'starter', matching userForToken — no cron).
  const { tierExpiresAt, ...publicUser } = user;
  return json(
    {
      token,
      user: { ...publicUser, tier: effectiveTier(user.tier, tierExpiresAt, new Date()) },
    },
    200,
  );
}
