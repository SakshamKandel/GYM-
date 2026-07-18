import { accounts, coachMilestones } from '@gym/db';
import { desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — coach_milestones moderation (ADMIN-MASTER-PLAN §3 P1-9).
 * Member-visible coach-authored content (the client's "verified progress
 * story") is otherwise unmoderated — a coach can only delete their OWN rows
 * (DELETE /api/coach/milestones/[id]). This gives moderation.manage holders
 * read access across every coach + a removal path for any row.
 *
 *  - GET → the most recent 200 milestones, newest first, joined to both the
 *    authoring coach's and the target member's identity. Title/note are
 *    already maskPii'd at write time (coach/clients/[userId]/milestones POST),
 *    so nothing further to redact here.
 *
 * Guarded by requirePermission('moderation.manage').
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'moderation.manage');
  if (principal instanceof Response) return principal;

  const db = getDb();
  const member = alias(accounts, 'member');
  const coach = alias(accounts, 'coach');

  const rows = await db
    .select({
      id: coachMilestones.id,
      title: coachMilestones.title,
      note: coachMilestones.note,
      achievedAt: coachMilestones.achievedAt,
      createdAt: coachMilestones.createdAt,
      member: { id: member.id, email: member.email, displayName: member.displayName },
      coach: { id: coach.id, email: coach.email, displayName: coach.displayName },
    })
    .from(coachMilestones)
    .innerJoin(member, eq(member.id, coachMilestones.accountId))
    .innerJoin(coach, eq(coach.id, coachMilestones.coachId))
    .orderBy(desc(coachMilestones.createdAt))
    .limit(200);

  const milestones = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }));

  return json({ milestones }, 200);
}
