import { accounts, referrals } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { hashPassword } from '@/lib/password';
import { grantDiscount } from '@/lib/promoEconomy';
import { clientIp, rateLimit } from '@/lib/rateLimit';

/** Referral reward window (SCALE-UP-PLAN §1.3 / §7.2). */
const REFERRAL_DISCOUNT_PCT = 20;
const REFERRAL_GRANT_DAYS = 90;

/**
 * If anyone invited this (now-registered) email, flip their referral(s) to
 * 'joined' and grant BOTH parties a 20%/90-day discount. Only rows still
 * 'pending' transition — an already joined/rewarded row is left alone, which
 * is what prevents double-granting on any retry of this same call. One email
 * can have pending referral rows from multiple referrers (unique index is
 * (referrerId, inviteeEmail)), so every matching referrer is granted too.
 * Best-effort: a referral-wiring failure must never fail registration itself.
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
    await grantDiscount({
      accountId,
      source: 'referral',
      pct: REFERRAL_DISCOUNT_PCT,
      expiresAt,
    });
    for (const row of joined) {
      await grantDiscount({
        accountId: row.referrerId,
        source: 'referral',
        pct: REFERRAL_DISCOUNT_PCT,
        expiresAt,
      });
    }
  } catch {
    // Best-effort — the account is already created; the next referral fetch
    // or a support ticket can reconcile. Never fail registration for this.
  }
}

export const runtime = 'nodejs';

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().max(120),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  // Mass-signup damping: 10 registrations/min per IP (in-memory, per instance).
  const limited = rateLimit({
    route: 'auth/register',
    limit: 10,
    windowMs: 60_000,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const email = parsed.data.email.toLowerCase();
  const db = getDb();

  const existing = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);
  if (existing.length > 0) return json({ error: 'email_taken' }, 409);

  const passwordHash = await hashPassword(parsed.data.password);

  let created: { id: string; email: string; displayName: string; tier: string }[];
  try {
    created = await db
      .insert(accounts)
      .values({
        email,
        passwordHash,
        displayName: parsed.data.displayName.trim(),
      })
      .returning({
        id: accounts.id,
        email: accounts.email,
        displayName: accounts.displayName,
        tier: accounts.tier,
      });
  } catch {
    // Unique-constraint race: someone registered the same email between the
    // check above and this insert.
    return json({ error: 'email_taken' }, 409);
  }

  const user = created[0];
  if (!user) return json({ error: 'invalid' }, 400);

  await wireReferralsForNewAccount(user.id, email);

  const token = await createSession(user.id);
  return json({ token, user }, 201);
}
