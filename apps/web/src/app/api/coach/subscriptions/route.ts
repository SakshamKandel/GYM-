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
 *        1. requirePermission('client.tier_grant') — this key is in NO role
 *           preset (see @gym/shared permissions), so ordinary coaches are
 *           REJECTED here (fixes critical A1: a coach can no longer grant an
 *           assigned client a permanent Elite tier). Only super_admin/main_admin
 *           reach this route today (they bypass the matrix); a future per-account
 *           override can re-enable it for trusted in-house coaches.
 *        2. requireCoachOwnsUser(principal, userId) — an ACTIVE assignment to
 *           THIS coach (super_admin/main_admin pass without a row). → 403
 *           { error:'forbidden' } if not owned.
 *      Dates are ISO-8601 strings (or null). For PAID tiers expiresAt is
 *      REQUIRED, must be in the future, and at most 90 days out (A1 cap —
 *      400 { error:'expiry_out_of_range' } otherwise); permanent/unbounded
 *      grants are admin-only. Starter (a downgrade) is exempt from the cap.
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
  // Base gate: coach-initiated client tier grants require 'client.tier_grant',
  // which is deliberately absent from EVERY role preset (incl. 'coach') — only
  // super_admin/main_admin pass via the matrix bypass. This closes the A1
  // bypass where any coach could POST here directly and grant an assigned
  // client a permanent Elite tier with no payment.
  const principal = await requirePermission(req, 'client.tier_grant');
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

  // Coach comps are time-boxed (A1): a PAID tier granted through THIS route must
  // carry a non-null expiry no more than 90 days out — never permanent, never a
  // past date. Unrestricted or permanent grants are an admin-only capability
  // (POST /api/admin/subscriptions). Starter (a downgrade) is exempt.
  if (tier !== 'starter') {
    const now = Date.now();
    const MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
    if (
      !(expiresAt instanceof Date) ||
      expiresAt.getTime() <= now ||
      expiresAt.getTime() > now + MAX_WINDOW_MS
    ) {
      return json({ error: 'expiry_out_of_range' }, 400);
    }
  }

  // source 'coach' stamps provenance so the RevenueCat webhook won't clobber
  // this comp while its window is still in force (B4).
  await setAccountTier(userId, tier, principal, reason, { startsAt, expiresAt }, 'coach');

  return json({ ok: true, accountId: userId, tier }, 200);
}
