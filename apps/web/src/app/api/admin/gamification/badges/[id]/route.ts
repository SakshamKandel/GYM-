import { awardedBadges } from '@gym/db';
import { eq } from 'drizzle-orm';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { clientIp } from '@/lib/rateLimit';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin gamification oversight — badge revoke (gap build P2-17).
 *
 *  - DELETE → removes ONE awarded_badges row by its own id (not by
 *    accountId+badgeId, so the console never needs to guess the composite
 *    key). The row's underlying `badge` xp_events award (+50, sourceKey =
 *    the catalog badgeId) is intentionally left in place — XP and badges are
 *    separate ledgers here; an admin who wants the XP clawed back too uses
 *    the xp-corrections endpoint with a negative delta and its own reason.
 *    Deleting the awarded_badges row also means the award engine will
 *    RE-AWARD the badge on the account's next sync/GET if the account still
 *    meets the catalog threshold (computeEarnedBadgeIds is a pure re-check,
 *    not itself idempotent against revocation) — this route is for
 *    correcting a wrongly-awarded badge (e.g. a mis-verified strength club),
 *    not for permanently blocking a legitimately-earned one.
 *
 * Guarded by requirePermission('gamification.manage').
 */

export function OPTIONS() {
  return preflight();
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'gamification.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const db = getDb();

  const deleted = await db
    .delete(awardedBadges)
    .where(eq(awardedBadges.id, id))
    .returning({ id: awardedBadges.id, accountId: awardedBadges.accountId, badgeId: awardedBadges.badgeId });

  const row = deleted[0];
  if (!row) return json({ error: 'not_found' }, 404);

  await logAudit(
    principal,
    'gamification.badge_revoke',
    'awarded_badge',
    row.id,
    { accountId: row.accountId, badgeId: row.badgeId },
    clientIp(req),
  );

  return json({ id: row.id }, 200);
}
