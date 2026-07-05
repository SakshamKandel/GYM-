import { syncedSets, syncedWorkouts } from '@gym/db';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * One-way, append-only workout backup (mobile → server).
 *
 *  - POST {workouts:[...]} → idempotent batch upsert into synced_workouts +
 *    synced_sets, keyed on the CLIENT-generated UUIDs with ON CONFLICT DO
 *    NOTHING — so a replayed batch (retry after a dropped response) is a
 *    harmless no-op. accountId always comes from the bearer token, never the
 *    payload, and sets are only inserted for workouts this account owns: a
 *    batch that replays someone else's workout id can never attach rows to
 *    another user (the foreign id is silently excluded from syncedWorkoutIds).
 *
 * The mobile client marks local workouts synced ONLY for ids echoed back in
 * `syncedWorkoutIds`. No download, no merge — v1 is backup only.
 */

const MAX_WORKOUTS = 25;
const MAX_SETS = 500;

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

const workoutSchema = z.object({
  id: z.string().min(1).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
  sets: z.array(setSchema).max(MAX_SETS),
});

const bodySchema = z
  .object({
    workouts: z.array(workoutSchema).min(1).max(MAX_WORKOUTS),
  })
  .refine(
    (b) => b.workouts.reduce((n, w) => n + w.sets.length, 0) <= MAX_SETS,
    'too many sets in batch',
  );

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { workouts } = parsed.data;

  const db = getDb();

  await db
    .insert(syncedWorkouts)
    .values(
      workouts.map((w) => ({
        id: w.id,
        accountId: user.id,
        date: w.date,
        name: w.name,
        templateId: w.templateId ?? null,
        templateName: w.templateName ?? null,
        startedAt: new Date(w.startedAt),
        finishedAt: new Date(w.finishedAt),
        durationSec: w.durationSec ?? null,
      })),
    )
    .onConflictDoNothing({ target: syncedWorkouts.id });

  // Ownership gate for the set rows: only workouts that now exist AND belong
  // to the caller accept sets. A replayed foreign workout id conflicts above
  // (do-nothing) and is filtered out here, so its sets are never written.
  const batchIds = workouts.map((w) => w.id);
  const ownedRows = await db
    .select({ id: syncedWorkouts.id })
    .from(syncedWorkouts)
    .where(and(eq(syncedWorkouts.accountId, user.id), inArray(syncedWorkouts.id, batchIds)));
  const ownedIds = new Set(ownedRows.map((r) => r.id));

  const setValues = workouts
    .filter((w) => ownedIds.has(w.id))
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

  if (setValues.length > 0) {
    await db.insert(syncedSets).values(setValues).onConflictDoNothing({ target: syncedSets.id });
  }

  const syncedWorkoutIds = batchIds.filter((id) => ownedIds.has(id));
  return json({ ok: true, syncedWorkoutIds }, 200);
}
