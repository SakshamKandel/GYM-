import { checkIns, syncedSets, syncedWorkouts } from '@gym/db';
import {
  checkWorkoutPlausibility,
  epley1Rm,
  workoutRestoreRequestSchema,
  WORKOUT_RESTORE_PAGE_SIZE,
  type PriorBestE1Rm,
  type RestoredSet,
  type RestoredWorkout,
  type WorkoutRestoreCursor,
  type WorkoutRestorePage,
} from '@gym/shared';
import { and, asc, desc, eq, gte, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { runAwardEngine } from '@/lib/gamification';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Workout backup (mobile → server), append-only apart from the member's own
 * deletions.
 *
 *  - POST {workouts:[...]} → idempotent batch upsert into synced_workouts +
 *    synced_sets, keyed on the CLIENT-generated UUIDs with ON CONFLICT DO
 *    NOTHING — so a replayed batch (retry after a dropped response) is a
 *    harmless no-op. accountId always comes from the bearer token, never the
 *    payload, and sets are only inserted for workouts this account owns: a
 *    batch that replays someone else's workout id can never attach rows to
 *    another user (the foreign id is silently excluded from syncedWorkoutIds).
 *  - Each NEWLY inserted workout then runs the shared plausibility check
 *    (bodyweight from the latest check-in that has one, rolling 90-day best
 *    e1RM per exercise from prior synced sets — ranked and unranked both feed
 *    the baseline per the plausibility spec). A tripped workout is marked
 *    ranked=false + flagReason and excluded from leaderboards/badges/quests/
 *    challenges/PR-XP (query-side join on ranked), but stays in the user's
 *    own log/history/streak (design law 4). Response gains `flaggedWorkoutIds`
 *    (additive — mobile ignores unknown keys today).
 *  - After the batch lands, the gamification award engine runs (XP, weekly
 *    streak cache, badges, quest/challenge completion) — best-effort, wrapped
 *    in after() so it never blocks or fails the sync response.
 *
 * The mobile client marks local workouts synced ONLY for ids echoed back in
 * `syncedWorkoutIds`.
 *
 *  - The same POST also serves the RESTORE half: a client that sends `cursor`
 *    (null to start from the beginning) gets `restoredWorkouts` + `cursor` +
 *    `hasMore` back alongside the push keys — one page of its own workouts,
 *    parent + sets, oldest sync first. Sending no cursor is push-only and does
 *    zero extra work, which is exactly what every already-shipped client does.
 *    Merging is the device's business: the server states what it holds and
 *    never asks a device to drop anything.
 *
 *  - The same POST also carries `deletedWorkoutIds`: workouts the member deleted
 *    on their phone. Those rows are removed here (account-scoped), which is what
 *    stops a deleted session counting toward the public board and what stops
 *    restore handing it back on the next device. Absent = nothing to delete, so
 *    every already-shipped client is unaffected.
 */

const MAX_WORKOUTS = 25;
const MAX_SETS = 500;
/** Deletions carried per request — the device drains any backlog over several. */
const MAX_DELETIONS = 50;

/** ISO-ish timestamp the DB layer can consume; bounded so garbage can't grow rows. */
const isoTimestamp = z
  .string()
  .max(40)
  .refine((s) => !Number.isNaN(Date.parse(s)), 'not a timestamp');

const setSchema = z.object({
  id: z.string().min(1).max(64),
  setNo: z.number().int().min(0).max(1_000),
  exerciseId: z.string().min(1).max(120),
  exerciseName: z.string().min(1).max(200),
  weightKg: z.number().min(0).max(10_000),
  weightUnit: z.enum(['kg', 'lb']).default('kg'),
  reps: z.number().int().min(0).max(10_000),
  rpe: z.number().min(0).max(10).nullish(),
  isPr: z.boolean().optional(),
  loggedAt: isoTimestamp,
});

/**
 * Reject dates more than 2 days in the future of server time — enough slack
 * for any real client timezone, not enough to let a farmed batch (e.g. a
 * '2099-01-01' workout) count toward every future month's leaderboard/quest/
 * challenge window forever (those queries only bound the past side).
 */
function isNotFarFuture(dateIso: string): boolean {
  const maxIso = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  return dateIso <= maxIso;
}

const workoutSchema = z.object({
  id: z.string().min(1).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isNotFarFuture, 'date too far in the future'),
  name: z.string().max(200),
  templateId: z.string().max(64).nullish(),
  templateName: z.string().max(200).nullish(),
  startedAt: isoTimestamp,
  finishedAt: isoTimestamp,
  durationSec: z
    .number()
    .int()
    .min(0)
    .max(7 * 86_400)
    .nullish(),
  // At least one set required — a zero-set workout has nothing for the
  // plausibility layer to inspect (it vacuously passes) and would otherwise
  // let a session-day be farmed onto the leaderboard/streak/quests/challenges
  // with no lifting data behind it at all.
  sets: z.array(setSchema).min(1).max(MAX_SETS),
});

/**
 * Push + pull + delete in one body. `workouts` is optional so a device that only
 * wants its history back can ask for it without inventing an upload; every
 * shipped client still sends it and hits exactly the same validation as before.
 * `cursor` comes from the shared restore contract (absent = push only).
 * `deletedWorkoutIds` is likewise optional — a client that never sends it
 * behaves exactly as it always has.
 */
const bodySchema = workoutRestoreRequestSchema
  .extend({
    workouts: z.array(workoutSchema).min(1).max(MAX_WORKOUTS).optional(),
    deletedWorkoutIds: z.array(z.string().min(1).max(64)).max(MAX_DELETIONS).optional(),
  })
  .refine(
    (b) => (b.workouts ?? []).reduce((n, w) => n + w.sets.length, 0) <= MAX_SETS,
    'too many sets in batch',
  );

/**
 * One page of the account's own workouts, oldest sync first, resumed from the
 * client's cursor. Read-only and account-scoped: the WHERE clause is the only
 * thing standing between two members' histories, so accountId is bound on both
 * the parent and the set query.
 */
async function loadRestorePage(
  accountId: string,
  cursor: WorkoutRestoreCursor | null,
): Promise<WorkoutRestorePage> {
  const db = getDb();
  // Keyset, not OFFSET: rows arriving mid-restore can't shift the window.
  const after = cursor
    ? or(
        sql`${syncedWorkouts.syncedAt} > ${new Date(cursor.serverSyncedAt)}`,
        and(
          sql`${syncedWorkouts.syncedAt} = ${new Date(cursor.serverSyncedAt)}`,
          sql`${syncedWorkouts.id} > ${cursor.workoutId}`,
        ),
      )
    : undefined;

  const rows = await db
    .select()
    .from(syncedWorkouts)
    .where(and(eq(syncedWorkouts.accountId, accountId), after))
    .orderBy(asc(syncedWorkouts.syncedAt), asc(syncedWorkouts.id))
    .limit(WORKOUT_RESTORE_PAGE_SIZE + 1);

  const hasMore = rows.length > WORKOUT_RESTORE_PAGE_SIZE;
  const page = rows.slice(0, WORKOUT_RESTORE_PAGE_SIZE);
  const last = page[page.length - 1];
  // Nothing new: hand the caller's own cursor back so it stays where it is.
  if (!last) return { restoredWorkouts: [], cursor, hasMore: false };

  const setRows = await db
    .select()
    .from(syncedSets)
    .where(
      and(
        eq(syncedSets.accountId, accountId),
        inArray(
          syncedSets.workoutId,
          page.map((w) => w.id),
        ),
      ),
    )
    .orderBy(asc(syncedSets.loggedAt));

  const setsByWorkout = new Map<string, RestoredSet[]>();
  for (const s of setRows) {
    const list = setsByWorkout.get(s.workoutId) ?? [];
    list.push({
      id: s.id,
      setNo: s.setNo,
      exerciseId: s.exerciseId,
      exerciseName: s.exerciseName,
      weightKg: s.weightKg,
      weightUnit: s.weightUnit,
      reps: s.reps,
      rpe: s.rpe,
      isWarmup: s.isWarmup,
      isPr: s.isPr,
      loggedAt: s.loggedAt.toISOString(),
    });
    setsByWorkout.set(s.workoutId, list);
  }

  const restoredWorkouts: RestoredWorkout[] = page.map((w) => ({
    id: w.id,
    date: w.date,
    name: w.name,
    templateId: w.templateId,
    templateName: w.templateName,
    startedAt: w.startedAt.toISOString(),
    finishedAt: w.finishedAt.toISOString(),
    durationSec: w.durationSec,
    ranked: w.ranked,
    flagReason: w.flagReason,
    serverSyncedAt: w.syncedAt.toISOString(),
    sets: setsByWorkout.get(w.id) ?? [],
  }));

  return {
    restoredWorkouts,
    cursor: { serverSyncedAt: last.syncedAt.toISOString(), workoutId: last.id },
    hasMore,
  };
}

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  // Generous ceiling — real sync cadence is a handful of batches per day; this
  // only damps scripted hammering (each batch costs several DB round-trips).
  const limited = rateLimit({
    route: 'sync/workouts',
    limit: 60,
    windowMs: 60 * 60 * 1000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { cursor } = parsed.data;
  const deletedWorkoutIds = [...new Set(parsed.data.deletedWorkoutIds ?? [])];
  const deletedIdSet = new Set(deletedWorkoutIds);
  // A pull-only request carries no workouts; every push path below is a no-op
  // on an empty array, so the halves stay completely independent. A workout named
  // in BOTH halves can only be a stale queue entry, and the delete is the newer
  // intent, so it wins — nothing can push back a workout this request removes.
  const workouts = (parsed.data.workouts ?? []).filter((w) => !deletedIdSet.has(w.id));

  const db = getDb();

  // ── Deletions (device → server) ─────────────────────────────────
  // Removing a workout on the phone used to stop at the phone. The server copy
  // stayed, kept counting toward session-days on the public board, and came
  // straight back the next time the member restored onto a new device — the one
  // thing the member had explicitly said they did not want. Deleting here is
  // what makes it stick: the row is gone, so the board can't count it and
  // restore has nothing to hand back.
  //
  // accountId is bound on both statements, so an id belonging to someone else
  // matches nothing. Sets go first and the workout second, in one transaction:
  // the FK cascades anyway, but a half-applied delete must not be possible.
  if (deletedWorkoutIds.length > 0) {
    await db.batch([
      db
        .delete(syncedSets)
        .where(
          and(
            eq(syncedSets.accountId, user.id),
            inArray(syncedSets.workoutId, deletedWorkoutIds),
          ),
        ),
      db
        .delete(syncedWorkouts)
        .where(
          and(
            eq(syncedWorkouts.accountId, user.id),
            inArray(syncedWorkouts.id, deletedWorkoutIds),
          ),
        ),
    ]);
  }

  const batchIds = workouts.map((w) => w.id);

  // Which of the batch's ids already exist (any owner), resolved BEFORE the
  // insert so the workout rows and their set rows can be written in ONE atomic
  // db.batch() below. neon-http is non-interactive — it has no db.transaction()
  // callback — but db.batch runs its statements inside a single server-side
  // transaction (all commit or none do). A workout is "newly inserted" by this
  // request iff it does not already exist; new rows are always written with
  // accountId = user.id, so newly-inserted ⇒ owned by the caller.
  const existingRows =
    batchIds.length === 0
      ? []
      : await db
          .select({ id: syncedWorkouts.id, accountId: syncedWorkouts.accountId })
          .from(syncedWorkouts)
          .where(inArray(syncedWorkouts.id, batchIds));
  const existingOwnerById = new Map(existingRows.map((r) => [r.id, r.accountId] as const));
  const isNewWorkout = (id: string) => !existingOwnerById.has(id);
  const isOwnedWorkout = (id: string) =>
    existingOwnerById.has(id) ? existingOwnerById.get(id) === user.id : true;

  const workoutValues = workouts.map((w) => ({
    id: w.id,
    accountId: user.id,
    date: w.date,
    name: w.name,
    templateId: w.templateId ?? null,
    templateName: w.templateName ?? null,
    startedAt: new Date(w.startedAt),
    finishedAt: new Date(w.finishedAt),
    durationSec: w.durationSec ?? null,
  }));

  // Sets are only inserted for workouts NEWLY created by THIS request — not
  // merely "owned" — matching the documented append-only contract ("a
  // replayed workout is a full no-op"). Gating on ownership alone would let a
  // client re-POST an existing workout id with an extra set appended: the
  // workout upsert conflicts (do-nothing, so it's not "fresh") but the new
  // set id would still insert and NEVER pass through the plausibility check
  // below (which only iterates fresh workouts), permanently laundering an
  // implausible set into an already-ranked=true workout. A foreign id also
  // fails isNewWorkout (it exists under another account), so its sets are
  // never written. Every new workout carries ≥1 set (schema min(1)), so
  // setValues is non-empty exactly when there is a new workout to insert.
  const setValues = workouts
    .filter((w) => isNewWorkout(w.id))
    .flatMap((w) =>
      w.sets.map((s) => ({
        id: s.id,
        workoutId: w.id,
        accountId: user.id,
        exerciseId: s.exerciseId,
        exerciseName: s.exerciseName,
        setNo: s.setNo,
        weightKg: s.weightKg,
        weightUnit: s.weightUnit,
        reps: s.reps,
        rpe: s.rpe ?? null,
        isPr: s.isPr ?? false,
        loggedAt: new Date(s.loggedAt),
      })),
    );

  // Atomic write: the workout rows and their set rows commit together or not
  // at all. A mid-request failure (Neon connection reset, statement timeout,
  // serverless eviction between the two writes) rolls back the workout rows
  // too, so the idempotent retry re-inserts them as fresh and re-writes their
  // sets — an orphaned zero-set workout can never be echoed back as synced.
  let newlyInsertedIds = new Set<string>();
  if (setValues.length > 0) {
    const [insertedWorkouts] = await db.batch([
      db
        .insert(syncedWorkouts)
        .values(workoutValues)
        .onConflictDoNothing({ target: syncedWorkouts.id })
        .returning({ id: syncedWorkouts.id }),
      db.insert(syncedSets).values(setValues).onConflictDoNothing({ target: syncedSets.id }),
    ]);
    newlyInsertedIds = new Set(insertedWorkouts.map((r) => r.id));
  }

  const syncedWorkoutIds = batchIds.filter((id) => isOwnedWorkout(id));

  // ── Plausibility layer: only NEWLY inserted workouts (a replayed workout
  //    already got its verdict the first time — re-checking a replay against
  //    a baseline that now includes its own sets would be circular). ────────
  const freshWorkouts = workouts.filter((w) => newlyInsertedIds.has(w.id));
  const flaggedWorkoutIds: string[] = [];

  if (freshWorkouts.length > 0) {
    // Latest check-in with a recorded bodyweight, if any.
    const bwRows = await db
      .select({ bodyweightKg: checkIns.bodyweightKg })
      .from(checkIns)
      .where(and(eq(checkIns.accountId, user.id), isNotNull(checkIns.bodyweightKg)))
      .orderBy(desc(checkIns.date))
      .limit(1);
    const bodyweightKg = bwRows[0]?.bodyweightKg ?? null;

    // Rolling 90-day best e1RM + prior session count per exercise, from
    // RANKED prior synced sets ONLY. Unranked (flagged) workouts must NOT
    // feed the baseline: otherwise a flagged implausible number becomes the
    // new "rolling best" immediately, and re-submitting the exact same
    // number in a fresh workout passes the velocity check on the very next
    // sync — laundering the anti-cheat flag in one resubmission. A
    // legitimately-progressed number instead re-earns rank once enough
    // ranked sessions confirm it (VELOCITY_MIN_PRIOR_SESSIONS), same as any
    // other new plateau.
    const cutoff90 = new Date();
    cutoff90.setUTCDate(cutoff90.getUTCDate() - 90);
    const priorSetRows = await db
      .select({
        exerciseId: syncedSets.exerciseId,
        weightKg: syncedSets.weightKg,
        reps: syncedSets.reps,
        workoutId: syncedSets.workoutId,
        loggedAt: syncedSets.loggedAt,
      })
      .from(syncedSets)
      .innerJoin(syncedWorkouts, eq(syncedWorkouts.id, syncedSets.workoutId))
      .where(
        and(
          eq(syncedSets.accountId, user.id),
          gte(syncedSets.loggedAt, cutoff90),
          eq(syncedWorkouts.ranked, true),
        ),
      );

    const perExerciseSessions = new Map<string, Map<string, number>>(); // exerciseId -> workoutId -> bestE1rm
    for (const s of priorSetRows) {
      if (freshWorkouts.some((w) => w.id === s.workoutId)) continue; // exclude the batch's own sets
      const e1rm = epley1Rm(s.weightKg, s.reps);
      let byWorkout = perExerciseSessions.get(s.exerciseId);
      if (!byWorkout) {
        byWorkout = new Map();
        perExerciseSessions.set(s.exerciseId, byWorkout);
      }
      const prevBest = byWorkout.get(s.workoutId) ?? 0;
      if (e1rm > prevBest) byWorkout.set(s.workoutId, e1rm);
    }
    const priorBestE1Rm: Record<string, PriorBestE1Rm> = {};
    for (const [exerciseId, byWorkout] of perExerciseSessions) {
      const sessions = byWorkout.size;
      const best = Math.max(0, ...byWorkout.values());
      priorBestE1Rm[exerciseId] = { best, sessions };
    }

    for (const w of freshWorkouts) {
      const result = checkWorkoutPlausibility({
        sets: w.sets.map((s) => ({
          weightKg: s.weightKg,
          reps: s.reps,
          exerciseId: s.exerciseId,
          exerciseName: s.exerciseName,
        })),
        bodyweightKg,
        priorBestE1Rm,
      });
      if (!result.ranked) {
        flaggedWorkoutIds.push(w.id);
        await db
          .update(syncedWorkouts)
          .set({ ranked: false, flagReason: result.reason })
          .where(and(eq(syncedWorkouts.id, w.id), eq(syncedWorkouts.accountId, user.id)));
      }
    }
  }

  // Best-effort gamification pass (XP, weekly streak cache, badges, quest/
  // challenge completion) — never blocks or fails the sync response. Skipped
  // when the batch inserted nothing new (pure replay): the engine is
  // idempotent, so re-running it over unchanged data only burns DB round-trips.
  if (newlyInsertedIds.size > 0) {
    after(() => runAwardEngine(user.id).then(() => undefined));
  }

  // ── Restore (pull) ─────────────────────────────────────────────
  // Only when the client asked. No cursor key = a pre-restore client, which
  // gets byte-for-byte the response it has always parsed and costs the DB
  // nothing extra.
  // `deletedWorkoutIds` echoes what the caller asked us to remove, not what was
  // found: after this response the server definitely does not hold any of them,
  // including ones it never had, so the device can retire the whole tombstone
  // batch rather than resending ids forever.
  if (cursor === undefined) {
    return json({ ok: true, syncedWorkoutIds, flaggedWorkoutIds, deletedWorkoutIds }, 200);
  }
  const restore = await loadRestorePage(user.id, cursor);
  return json(
    { ok: true, syncedWorkoutIds, flaggedWorkoutIds, deletedWorkoutIds, ...restore },
    200,
  );
}
