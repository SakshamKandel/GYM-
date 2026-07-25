import { z } from 'zod';

/**
 * Cross-device workout restore — the PULL half of POST /api/sync/workouts.
 *
 * The push half (the `workouts` array) keeps its own validation next to the
 * route: it is the ingest contract, tuned to reject implausible client data,
 * and it must not drift. This file describes only what the two sides need to
 * agree on to hand a workout BACK to a device that no longer has it (new
 * phone, reinstall, second device).
 *
 * Two rules shape everything here:
 *
 *  1. **Back-compat is mandatory.** Shipped clients post `{ workouts }` with no
 *     cursor and parse the response non-strictly. So `cursor` is optional, and
 *     its ABSENCE is meaningful — no cursor key means "push only", and the
 *     server does no restore work at all. `null` means "start from this
 *     account's first workout".
 *
 *  2. **This describes rows the database already holds**, not rows the ingest
 *     schema would accept today. Bounds are therefore generous and minimums are
 *     absent: a legacy row with an empty name or zero sets must still come
 *     home, not wedge the restore behind a validation error forever.
 *
 * A workout is a parent + its sets, so it is deliberately NOT modelled as a
 * member-data record (those are flat, independently versioned rows). Only the
 * cursor shape mirrors memberDataSync: a (server timestamp, id) keyset point.
 */

const isoTimestampSchema = z.string().datetime({ offset: true });
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idSchema = z.string().min(1).max(64);

/**
 * Keyset position in the account's restore stream, ordered by
 * (server sync time, workout id). Same two-part shape as the member-data
 * cursor point, so ties on identical timestamps stay deterministic and no row
 * can be skipped or repeated forever.
 */
export const workoutRestoreCursorSchema = z
  .object({
    serverSyncedAt: isoTimestampSchema,
    workoutId: idSchema,
  })
  .strict();

export type WorkoutRestoreCursor = z.infer<typeof workoutRestoreCursorSchema>;

/**
 * Request half. Intentionally not strict: the route extends it with the push
 * payload, and older/newer clients may carry keys the other side ignores.
 */
export const workoutRestoreRequestSchema = z.object({
  /** Omitted = push only (pre-restore clients). Null = start from the beginning. */
  cursor: workoutRestoreCursorSchema.nullish(),
});

export type WorkoutRestoreRequest = z.infer<typeof workoutRestoreRequestSchema>;

/** A stored set coming home. Server-side units/warmup ride along unused today. */
export const restoredSetSchema = z.object({
  id: idSchema,
  setNo: z.number().int(),
  exerciseId: z.string().max(120),
  exerciseName: z.string().max(200),
  weightKg: z.number().finite(),
  weightUnit: z.enum(['kg', 'lb']),
  reps: z.number().int(),
  rpe: z.number().finite().nullable(),
  isWarmup: z.boolean(),
  isPr: z.boolean(),
  loggedAt: isoTimestampSchema,
});

export type RestoredSet = z.infer<typeof restoredSetSchema>;

/** Parent + sets aggregate, plus the server-owned fields a device cannot derive. */
export const restoredWorkoutSchema = z.object({
  id: idSchema,
  date: isoDateSchema,
  name: z.string().max(200),
  templateId: z.string().max(64).nullable(),
  templateName: z.string().max(200).nullable(),
  startedAt: isoTimestampSchema,
  finishedAt: isoTimestampSchema,
  durationSec: z.number().int().nullable(),
  /** Anti-cheat verdict. False only excludes the row from public standings. */
  ranked: z.boolean(),
  flagReason: z.string().max(120).nullable(),
  /** This row's cursor time — the restore's ordering key. */
  serverSyncedAt: isoTimestampSchema,
  sets: z.array(restoredSetSchema).max(1_000),
});

export type RestoredWorkout = z.infer<typeof restoredWorkoutSchema>;

/** How many workouts one page carries. Server-side only — see the note below. */
export const WORKOUT_RESTORE_PAGE_SIZE = 20;

/**
 * The page bound the CLIENT enforces, deliberately looser than the server's
 * page size. Tying it to WORKOUT_RESTORE_PAGE_SIZE would mean that raising the
 * page size later silently breaks every already-shipped app (a larger page
 * would fail to parse and restore would quietly stop), so the two numbers move
 * independently.
 */
const MAX_WORKOUTS_PER_RESTORE_PAGE = 100;

/**
 * Response half. NOT strict on purpose — it is parsed out of the full sync
 * response, which also carries the push keys (`ok`, `syncedWorkoutIds`,
 * `flaggedWorkoutIds`). A server too old to know about restore simply omits
 * these three keys, the parse fails, and the client treats restore as
 * unavailable instead of erroring.
 */
export const workoutRestorePageSchema = z.object({
  restoredWorkouts: z.array(restoredWorkoutSchema).max(MAX_WORKOUTS_PER_RESTORE_PAGE),
  /** Null only when the account has no workouts at all. */
  cursor: workoutRestoreCursorSchema.nullable(),
  hasMore: z.boolean(),
});

export type WorkoutRestorePage = z.infer<typeof workoutRestorePageSchema>;
