import { coachMilestones, coachProfiles } from '@gym/db';
import { desc, eq } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * The signed-in member's coach-logged milestones — their verified progress
 * story ("First 100kg squat"), newest first. Read-only for the member; only
 * their coach writes rows (via /api/coach/clients/[userId]/milestones).
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const rows = await getDb()
    .select({
      id: coachMilestones.id,
      title: coachMilestones.title,
      note: coachMilestones.note,
      achievedAt: coachMilestones.achievedAt,
      coachName: coachProfiles.displayName,
    })
    .from(coachMilestones)
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, coachMilestones.coachId))
    .where(eq(coachMilestones.accountId, user.id))
    .orderBy(desc(coachMilestones.achievedAt), desc(coachMilestones.createdAt))
    .limit(100);

  const milestones = rows.map((m) => ({ ...m, coachName: m.coachName || 'Coach' }));

  return json({ milestones }, 200);
}
