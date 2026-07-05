import { accounts } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { adminRoleOf, requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { setAccountTier } from '@/lib/tier';

export const runtime = 'nodejs';

/**
 * Coach console — set/extend a subscription for one of the coach's OWN active
 * clients. This is the coach-scoped sibling of /api/admin/subscriptions: it
 * runs the SAME setAccountTier writer (tier + dated window + jsonb mirror +
 * Greece auto-assign sync + audit) but scopes the target to the caller's
 * roster instead of the admin-only 'subscription.override' permission.
 *
 *  - POST {userId, tier, reason?, startsAt?, expiresAt?}
 *      Guards (both, fail closed):
 *        1. requirePermission('coach.user.read') — coach/main_admin/super_admin.
 *        2. requireCoachOwnsUser(principal, userId) — an ACTIVE assignment to
 *           THIS coach (super_admin/main_admin pass without a row). → 403
 *           { error:'forbidden' } if not owned.
 *      Dates are ISO-8601 strings (or null). expiresAt null = permanent; a past
 *      expiresAt lapses the tier immediately (effectiveTier collapses it at the
 *      auth choke point). Omitting a date field leaves that column untouched.
 *
 * The audit row is attributed to the coach (setAccountTier logs
 * 'subscription.override' with the actor = caller), so the change log shows the
 * coach as the operator.
 */

const dateField = z.coerce.date().nullable().optional();

const postSchema = z.object({
  userId: z.string().trim().min(1),
  tier: z.enum(['starter', 'silver', 'gold', 'elite']),
  reason: z.string().trim().max(500).optional(),
  startsAt: dateField,
  expiresAt: dateField,
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  // Base gate: the caller must be able to read coach users (coach/main/super).
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { userId, tier, reason, startsAt, expiresAt } = parsed.data;

  // Ownership: an ACTIVE assignment from this coach to the target. super_admin
  // and main_admin pass without a row (see requireCoachOwnsUser).
  if (!(await requireCoachOwnsUser(principal, userId))) {
    return json({ error: 'forbidden' }, 403);
  }

  const db = getDb();

  // Target must be a real account.
  const account = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, userId))
    .limit(1);
  if (account.length === 0) return json({ error: 'account_not_found' }, 404);

  // A coach may only manage TRUE members — never a staff/admin account, even if
  // an assignment row somehow exists over one. Without this, an admin-created
  // assignment could let a coach rewrite a staff (incl. super_admin) tier.
  if ((await adminRoleOf(userId)) !== null) {
    return json({ error: 'forbidden' }, 403);
  }

  await setAccountTier(userId, tier, principal, reason, { startsAt, expiresAt });

  return json({ ok: true, accountId: userId, tier }, 200);
}
