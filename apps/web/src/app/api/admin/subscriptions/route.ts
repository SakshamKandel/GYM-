import { accounts } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { setAccountTier } from '@/lib/tier';

export const runtime = 'nodejs';

/**
 * Admin console — override a member's subscription tier.
 *
 *  - POST {accountId, tier, reason?} → confirms the account exists, then hands
 *          off to setAccountTier() which updates accounts.tier (source of
 *          truth), mirrors the tier onto account_profiles.data (jsonb merge,
 *          skipped if no profile row), and writes a 'subscription.override'
 *          audit row. No-ops that set the same tier are still audited so the
 *          change log reflects every deliberate override.
 *
 * Guarded by requirePermission('subscription.override'); super_admin passes
 * too. The legacy 'subscriptions' table is intentionally NOT touched.
 */

const postSchema = z.object({
  accountId: z.string().trim().min(1),
  tier: z.enum(['starter', 'silver', 'gold', 'elite']),
  reason: z.string().trim().max(500).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'subscription.override');
  if (principal instanceof Response) return principal;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { accountId, tier, reason } = parsed.data;

  const db = getDb();

  // accountId must be a real account before we mutate / audit anything.
  const account = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (account.length === 0) return json({ error: 'account_not_found' }, 404);

  // setAccountTier gates nothing itself — we've already enforced the permission
  // above. It updates accounts.tier, mirrors account_profiles, and audits.
  await setAccountTier(accountId, tier, principal, reason);

  return json({ ok: true, accountId, tier }, 200);
}
