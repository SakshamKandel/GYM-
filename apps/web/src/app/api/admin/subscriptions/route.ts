import { accounts } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { adminRoleOf, requireOutranks, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { setAccountTier } from '@/lib/tier';

export const runtime = 'nodejs';

/**
 * Admin console — override a member's subscription tier.
 *
 *  - POST {accountId, tier, reason?, startsAt?, expiresAt?} → confirms the
 *          account exists, then hands off to setAccountTier() which updates
 *          accounts.tier (source of truth) + the optional dated window
 *          (tierStartedAt / tierExpiresAt), mirrors the tier onto
 *          account_profiles.data (jsonb merge, skipped if no profile row),
 *          syncs the Greece auto-assignment off the new EFFECTIVE tier, and
 *          writes a 'subscription.override' audit row. No-ops that set the same
 *          tier are still audited so the change log reflects every deliberate
 *          override.
 *
 *          Dates are ISO-8601 strings (or null to clear). `expiresAt` null =
 *          permanent/no expiry; a PAST `expiresAt` immediately lapses the tier
 *          (effectiveTier collapses it to 'starter' at the auth choke point).
 *          Omitting a date field leaves that column untouched.
 *
 * Guarded by requirePermission('subscription.override'); super_admin passes
 * too. The legacy 'subscriptions' table is intentionally NOT touched.
 */

// Accept an ISO datetime string or null; `undefined` (absent) leaves the column
// as-is. z.coerce.date turns the string into a Date for setAccountTier.
const dateField = z.coerce.date().nullable().optional();

const postSchema = z.object({
  accountId: z.string().trim().min(1),
  tier: z.enum(['starter', 'silver', 'gold', 'elite']),
  reason: z.string().trim().max(500).optional(),
  startsAt: dateField,
  expiresAt: dateField,
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'subscription.override');
  if (principal instanceof Response) return principal;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { accountId, tier, reason, startsAt, expiresAt } = parsed.data;

  const db = getDb();

  // accountId must be a real account before we mutate / audit anything.
  const account = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (account.length === 0) return json({ error: 'account_not_found' }, 404);

  // Rank guard: a tier write over a STAFF account is only allowed when the actor
  // outranks that staff role (mirrors the members-suspend path), so a member_admin
  // can neither tier a super_admin nor self-serve their own tier. A non-staff
  // target (adminRoleOf → null) always passes.
  const rankBlock = requireOutranks(principal, await adminRoleOf(accountId));
  if (rankBlock) return rankBlock;

  // setAccountTier gates nothing itself — we've already enforced the permission
  // above. It updates accounts.tier (+ optional dates), mirrors account_profiles,
  // syncs the Greece auto-assignment, and audits.
  await setAccountTier(accountId, tier, principal, reason, {
    startsAt,
    expiresAt,
  });

  return json({ ok: true, accountId, tier }, 200);
}
