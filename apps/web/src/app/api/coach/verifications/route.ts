import { accounts, awardedBadges, coachAssignments } from '@gym/db';
import { STRENGTH_BADGE_IDS } from '@gym/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — the badge verification queue.
 *
 *  - GET → status='logged' STRENGTH-CLUB badges (filtered against the shared
 *    catalog's STRENGTH_BADGE_IDS) belonging to the caller's ASSIGNED clients
 *    only (active coach_assignments rows where coachId = me). super_admin and
 *    main_admin see every client's queue. Oldest first so the queue clears
 *    FIFO, mirroring the progression-suggestions queue idiom.
 *
 * Guarded by requirePermission('coach.user.read'); the per-row write guard
 * (requireCoachOwnsUser) lives on the verify route.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const db = getDb();
  const seesAll = principal.role === 'super_admin' || principal.role === 'main_admin';

  const conditions = [
    eq(awardedBadges.status, 'logged'),
    inArray(awardedBadges.badgeId, [...STRENGTH_BADGE_IDS]),
  ];
  if (!seesAll) {
    conditions.push(
      sql`exists (
        select 1 from ${coachAssignments}
        where ${coachAssignments.userId} = ${awardedBadges.accountId}
          and ${coachAssignments.coachId} = ${principal.id}
          and ${coachAssignments.status} = 'active'
      )`,
    );
  }

  const rows = await db
    .select({
      awardId: awardedBadges.id,
      userId: awardedBadges.accountId,
      badgeId: awardedBadges.badgeId,
      earnedAt: awardedBadges.earnedAt,
      displayName: accounts.displayName,
    })
    .from(awardedBadges)
    .innerJoin(accounts, eq(awardedBadges.accountId, accounts.id))
    .where(and(...conditions))
    .orderBy(asc(awardedBadges.earnedAt))
    .limit(200);

  return json({ items: rows }, 200);
}
