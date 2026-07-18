import { accounts, trialUsage } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { loadAbuseDashboard } from '@/app/admin/abuse/_lib';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { clientIp } from '@/lib/rateLimit';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — referral/trial abuse dashboard + trial reset (gap build
 * P2-18). `referrals` and `trial_usage` (packages/db/src/schema.ts) had no
 * admin surface before this route.
 *
 * Permission: gated on `subscription.override` rather than a new key — the
 * ALL_PERMISSIONS union is a frozen cross-package contract (RBAC design
 * §1.2/§4.x) this package does not own, and reviewing/resetting trial abuse
 * is squarely subscription-adjacent work member_admin already does
 * (payments.review, subscription.override sit in the same preset). super/
 * main bypass as usual.
 *
 *  - GET  → the same aggregates `admin/abuse/page.tsx` renders server-side
 *    (see `@/app/admin/abuse/_lib`'s loadAbuseDashboard — one implementation
 *    for both the initial page render and this client-refreshable route, so
 *    they can never drift). Includes an explicit `limitations` note: no
 *    device/IP fingerprint is captured anywhere in the schema today, so
 *    same-device multi-account detection is NOT computable (flagged rather
 *    than fabricated).
 *  - POST {accountId, tier?} → trial reset. Deletes the trial_usage row(s)
 *    for the account — one tier if `tier` is supplied, every tier otherwise
 *    — so the account can start a fresh trial for a tier it previously used
 *    (support gesture for a glitched trial, or a conscious "let this one
 *    back in" call after review). Audited with the tiers actually removed;
 *    a no-op (account had no trial rows) still returns 200 with an empty
 *    `reset` list rather than 404, since "already clean" is a valid state.
 */

const TRIAL_TIERS = ['silver', 'gold', 'elite'] as const;

const postSchema = z.object({
  accountId: z.string().trim().min(1),
  tier: z.enum(TRIAL_TIERS).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'subscription.override');
  if (principal instanceof Response) return principal;

  const dashboard = await loadAbuseDashboard();
  return json(dashboard, 200);
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'subscription.override');
  if (principal instanceof Response) return principal;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { accountId, tier } = parsed.data;

  const db = getDb();
  const accountRows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (accountRows.length === 0) return json({ error: 'not_found' }, 404);

  const where = tier
    ? and(eq(trialUsage.accountId, accountId), eq(trialUsage.tier, tier))!
    : eq(trialUsage.accountId, accountId);

  const deleted = await db.delete(trialUsage).where(where).returning({ tier: trialUsage.tier });

  const reset = deleted.map((d) => d.tier);

  await logAudit(
    principal,
    'abuse.trial_reset',
    'account',
    accountId,
    { reset, tierFilter: tier ?? null },
    clientIp(req),
  );

  return json({ accountId, reset }, 200);
}
