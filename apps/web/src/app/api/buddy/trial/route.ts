import { accounts, trialUsage } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

const TRIAL_DAYS = 2;

const bodySchema = z.object({
  tier: z.enum(['silver', 'gold', 'elite']),
});

export function OPTIONS() {
  return preflight();
}

/** GET — trial status for this account (which tiers have been trialed). */
export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const db = getDb();
  const rows = await db
    .select({
      tier: trialUsage.tier,
      startedAt: trialUsage.startedAt,
      expiresAt: trialUsage.expiresAt,
    })
    .from(trialUsage)
    .where(eq(trialUsage.accountId, me.id));

  const now = new Date();
  const trials = rows.map((r) => ({
    tier: r.tier,
    startedAt: r.startedAt,
    expiresAt: r.expiresAt,
    active: now < r.expiresAt,
  }));

  return json({ trials, trialDays: TRIAL_DAYS }, 200);
}

/** POST — start a 2-day trial for a tier (one-time per tier per account). */
export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();
  const tier = parsed.data.tier;

  // Check if trial already used for this tier.
  const existing = await db
    .select({ id: trialUsage.id, expiresAt: trialUsage.expiresAt })
    .from(trialUsage)
    .where(and(eq(trialUsage.accountId, me.id), eq(trialUsage.tier, tier)))
    .limit(1);

  if (existing.length > 0) {
    return json({ error: 'trial_used', expiresAt: existing[0].expiresAt }, 409);
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);

  await db.insert(trialUsage).values({
    accountId: me.id,
    tier,
    startedAt: now,
    expiresAt,
  });

  // Apply the tier to the account for the trial duration.
  await db
    .update(accounts)
    .set({ tier })
    .where(eq(accounts.id, me.id));

  return json({ ok: true, tier, expiresAt }, 201);
}
