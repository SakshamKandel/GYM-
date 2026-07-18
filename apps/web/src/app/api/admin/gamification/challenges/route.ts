import { accounts, challengeMembers, coachChallenges } from '@gym/db';
import { count, desc, eq, inArray } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin gamification oversight — coach challenge moderation list (gap build
 * P2-17). Every coach may run ONE active challenge per calendar month
 * (coach_challenges unique(coachId, monthKey)); this surface lets an admin
 * see every challenge across every coach and remove one that's abusive or
 * miscalibrated (e.g. an impossible target_days, or copy that violates
 * content policy) — moderation, not creation (coaches create their own via
 * the coach console).
 *
 *  - GET → every challenge, newest month first, with the owning coach's
 *    identity and a live member count.
 *
 * Removal lives in [id]/route.ts (DELETE). Guarded by
 * requirePermission('gamification.manage').
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'gamification.manage');
  if (principal instanceof Response) return principal;

  const db = getDb();
  const rows = await db
    .select({
      id: coachChallenges.id,
      coachId: coachChallenges.coachId,
      coachEmail: accounts.email,
      coachName: accounts.displayName,
      title: coachChallenges.title,
      monthKey: coachChallenges.monthKey,
      targetDays: coachChallenges.targetDays,
      createdAt: coachChallenges.createdAt,
    })
    .from(coachChallenges)
    .innerJoin(accounts, eq(accounts.id, coachChallenges.coachId))
    .orderBy(desc(coachChallenges.monthKey), desc(coachChallenges.createdAt));

  const ids = rows.map((r) => r.id);
  const memberCountMap = new Map<string, number>();
  if (ids.length > 0) {
    const memberRows = await db
      .select({ challengeId: challengeMembers.challengeId, n: count() })
      .from(challengeMembers)
      .where(inArray(challengeMembers.challengeId, ids))
      .groupBy(challengeMembers.challengeId);
    for (const r of memberRows) memberCountMap.set(r.challengeId, Number(r.n));
  }

  return json(
    { challenges: rows.map((r) => ({ ...r, memberCount: memberCountMap.get(r.id) ?? 0 })) },
    200,
  );
}
