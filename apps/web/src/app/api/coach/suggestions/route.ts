import { accounts, coachAssignments, progressionSuggestions } from '@gym/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — the progression review queue.
 *
 *  - GET ?status=pending|approved|adjusted (default pending) → suggestions for
 *    the caller's ASSIGNED clients only (active coach_assignments rows where
 *    coachId = me), each joined to accounts for identity. super_admin and
 *    main_admin see every client's suggestions. Oldest first so the queue is
 *    reviewed FIFO.
 *
 * Guarded by requirePermission('coach.user.read'); the per-row write guard
 * (requireCoachOwnsUser) lives on the review route.
 */

const STATUSES = ['pending', 'approved', 'adjusted'] as const;
type Status = (typeof STATUSES)[number];

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const raw = new URL(req.url).searchParams.get('status') ?? 'pending';
  if (!(STATUSES as readonly string[]).includes(raw)) return json({ error: 'invalid' }, 400);
  const status = raw as Status;

  const db = getDb();
  const seesAll = principal.role === 'super_admin' || principal.role === 'main_admin';

  const conditions = [eq(progressionSuggestions.status, status)];
  if (!seesAll) {
    // Assignment scope as a correlated EXISTS so the roster check stays in the
    // same round-trip (mirrors the coach/users unread subquery idiom).
    conditions.push(
      sql`exists (
        select 1 from ${coachAssignments}
        where ${coachAssignments.userId} = ${progressionSuggestions.accountId}
          and ${coachAssignments.coachId} = ${principal.id}
          and ${coachAssignments.status} = 'active'
      )`,
    );
  }

  const rows = await db
    .select({
      id: progressionSuggestions.id,
      accountId: progressionSuggestions.accountId,
      exerciseId: progressionSuggestions.exerciseId,
      exerciseName: progressionSuggestions.exerciseName,
      sourceWorkoutId: progressionSuggestions.sourceWorkoutId,
      action: progressionSuggestions.action,
      targetWeightKg: progressionSuggestions.targetWeightKg,
      targetRepsMin: progressionSuggestions.targetRepsMin,
      targetRepsMax: progressionSuggestions.targetRepsMax,
      reason: progressionSuggestions.reason,
      status: progressionSuggestions.status,
      coachId: progressionSuggestions.coachId,
      adjustedWeightKg: progressionSuggestions.adjustedWeightKg,
      coachNote: progressionSuggestions.coachNote,
      reviewedAt: progressionSuggestions.reviewedAt,
      createdAt: progressionSuggestions.createdAt,
      user: {
        id: accounts.id,
        displayName: accounts.displayName,
        email: accounts.email,
      },
    })
    .from(progressionSuggestions)
    .innerJoin(accounts, eq(progressionSuggestions.accountId, accounts.id))
    .where(and(...conditions))
    .orderBy(asc(progressionSuggestions.createdAt))
    .limit(200);

  return json({ suggestions: rows }, 200);
}
