import { accounts, challengeMembers, coachAssignments, coachChallenges, syncedWorkouts } from '@gym/db';
import { and, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — the coach's own monthly challenge (ONE active per coach
 * per month — enforced by the coachChallenges unique(coachId, monthKey)
 * index, surfaced here as a 409).
 *
 *  - GET → the current month's challenge (if any), with a per-assigned-client
 *    progress list: joined?, session-days this month (ranked only), complete?
 *  - POST {title, targetDays, monthKey} → creates it; 201, or 409
 *    {error:'exists'} if the coach already has one this month.
 */

const postSchema = z.object({
  title: z.string().trim().min(1).max(80),
  targetDays: z.number().int().min(4).max(31),
  monthKey: z.string().regex(/^\d{4}-\d{2}$/),
});

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const db = getDb();
  const monthKey = currentMonthKey();

  const challengeRows = await db
    .select({
      id: coachChallenges.id,
      title: coachChallenges.title,
      monthKey: coachChallenges.monthKey,
      targetDays: coachChallenges.targetDays,
    })
    .from(coachChallenges)
    .where(and(eq(coachChallenges.coachId, principal.id), eq(coachChallenges.monthKey, monthKey)))
    .limit(1);
  const challenge = challengeRows[0];
  if (!challenge) return json({ challenge: null }, 200);

  const clientRows = await db
    .select({ userId: coachAssignments.userId, displayName: accounts.displayName })
    .from(coachAssignments)
    .innerJoin(accounts, eq(coachAssignments.userId, accounts.id))
    .where(and(eq(coachAssignments.coachId, principal.id), eq(coachAssignments.status, 'active')));

  const memberRows = await db
    .select({ accountId: challengeMembers.accountId })
    .from(challengeMembers)
    .where(eq(challengeMembers.challengeId, challenge.id));
  const joinedSet = new Set(memberRows.map((m) => m.accountId));

  const monthStart = `${monthKey}-01`;
  const members = [];
  for (const client of clientRows) {
    const joined = joinedSet.has(client.userId);
    let days = 0;
    if (joined) {
      const workoutRows = await db
        .select({ date: syncedWorkouts.date })
        .from(syncedWorkouts)
        .where(
          and(
            eq(syncedWorkouts.accountId, client.userId),
            eq(syncedWorkouts.ranked, true),
            gte(syncedWorkouts.date, monthStart),
          ),
        );
      days = new Set(workoutRows.map((r) => r.date)).size;
    }
    members.push({
      userId: client.userId,
      displayName: client.displayName,
      joined,
      days,
      complete: joined && days >= challenge.targetDays,
    });
  }

  return json(
    {
      challenge: {
        id: challenge.id,
        title: challenge.title,
        monthKey: challenge.monthKey,
        targetDays: challenge.targetDays,
        members,
      },
    },
    200,
  );
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { title, targetDays, monthKey } = parsed.data;

  if (monthKey !== currentMonthKey()) return json({ error: 'wrong_month' }, 409);

  const db = getDb();
  const inserted = await db
    .insert(coachChallenges)
    .values({ coachId: principal.id, title, targetDays, monthKey })
    .onConflictDoNothing({ target: [coachChallenges.coachId, coachChallenges.monthKey] })
    .returning();

  const challenge = inserted[0];
  if (!challenge) return json({ error: 'exists' }, 409);

  await logAudit(principal, 'coach.challenge.create', 'coach_challenge', challenge.id, {
    title,
    targetDays,
    monthKey,
  });

  return json({ challenge }, 201);
}
