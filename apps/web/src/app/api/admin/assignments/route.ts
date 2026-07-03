import { accounts, admins, coachAssignments } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — assign a coach to a member.
 *
 *  - POST {coachId, userId} → validates coachId is a real coach (admins row,
 *          role='coach') and userId is a real account, then upserts a
 *          coach_assignments row (status='active', assignedBy = caller). The
 *          unique (coachId,userId) index means re-assigning an ended pair
 *          reactivates it (onConflictDoUpdate → status='active').
 *
 * Guarded by requirePermission('coach.assign'); super_admin passes too.
 */

const postSchema = z.object({
  coachId: z.string().min(1),
  userId: z.string().min(1),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'coach.assign');
  if (principal instanceof Response) return principal;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { coachId, userId } = parsed.data;

  const db = getDb();

  // coachId must be an account carrying a role='coach' admins row.
  const coach = await db
    .select({ accountId: admins.accountId })
    .from(admins)
    .where(and(eq(admins.accountId, coachId), eq(admins.role, 'coach')))
    .limit(1);
  if (coach.length === 0) return json({ error: 'not_a_coach' }, 400);

  // userId must be a real account.
  const user = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, userId))
    .limit(1);
  if (user.length === 0) return json({ error: 'user_not_found' }, 404);

  const inserted = await db
    .insert(coachAssignments)
    .values({
      coachId,
      userId,
      status: 'active',
      assignedBy: principal.id,
    })
    .onConflictDoUpdate({
      target: [coachAssignments.coachId, coachAssignments.userId],
      set: { status: 'active', assignedBy: principal.id },
    })
    .returning({
      id: coachAssignments.id,
      coachId: coachAssignments.coachId,
      userId: coachAssignments.userId,
      status: coachAssignments.status,
      assignedBy: coachAssignments.assignedBy,
      createdAt: coachAssignments.createdAt,
    });

  const assignment = inserted[0];
  if (!assignment) return json({ error: 'invalid' }, 400);

  await logAudit(principal, 'coach.assign', 'account', userId, { coachId });

  return json({ assignment }, 201);
}
