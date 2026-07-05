import { syncedWorkouts, workoutFlagAcks } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { runAwardEngine } from '@/lib/gamification';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — acknowledge OR restore a flagged (unranked) workout.
 *
 *  - POST {action:'acknowledge'} → inserts a workoutFlagAcks row
 *    (onConflictDoNothing — idempotent, no error on a repeat ack). The
 *    owning member comes from the workout ROW, guarded by
 *    requireCoachOwnsUser so a coach can only ack flags for their own
 *    assigned clients.
 *  - POST {action:'restore'} → sets ranked=true + clears flagReason, so a
 *    coach can clear a false positive after eyeballing it with the member.
 *    This is the ONLY path that can ever un-flag a workout (mobile's "fix
 *    this entry?" prompt has no client-side mutation — sync is append-only
 *    and never re-checks plausibility) — without it a false-positive
 *    velocity/absolute-bounds flag permanently excludes that session from
 *    badges/leaderboards/PR credit with no remediation. Audit-logged like
 *    acknowledge.
 */

const bodySchema = z.object({ action: z.enum(['acknowledge', 'restore']) });

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ workoutId: string }> }) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const { workoutId } = await params;

  const db = getDb();
  const rows = await db
    .select({ id: syncedWorkouts.id, accountId: syncedWorkouts.accountId, ranked: syncedWorkouts.ranked })
    .from(syncedWorkouts)
    .where(eq(syncedWorkouts.id, workoutId))
    .limit(1);
  const row = rows[0];
  if (!row) return json({ error: 'not_found' }, 404);

  if (!(await requireCoachOwnsUser(principal, row.accountId))) {
    return json({ error: 'forbidden' }, 403);
  }

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  if (parsed.data.action === 'restore') {
    if (row.ranked) return json({ ok: true }, 200); // already ranked — no-op

    await db
      .update(syncedWorkouts)
      .set({ ranked: true, flagReason: null })
      .where(and(eq(syncedWorkouts.id, workoutId), eq(syncedWorkouts.accountId, row.accountId)));

    await logAudit(principal, 'coach.flag.restore', 'synced_workout', workoutId, {
      userId: row.accountId,
    });

    // Best-effort re-run so the member's badges/streak/rank reflect the
    // restored workout promptly instead of waiting for their next sync.
    after(() => runAwardEngine(row.accountId).then(() => undefined));

    return json({ ok: true }, 200);
  }

  await db
    .insert(workoutFlagAcks)
    .values({ workoutId, coachId: principal.id })
    .onConflictDoNothing({ target: workoutFlagAcks.workoutId });

  await logAudit(principal, 'coach.flag.acknowledge', 'synced_workout', workoutId, {
    userId: row.accountId,
  });

  return json({ ok: true }, 200);
}
