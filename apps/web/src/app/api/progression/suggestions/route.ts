import { progressionSuggestions, syncedWorkouts } from '@gym/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Client-computed progression suggestions (mobile → server → coach review).
 *
 *  - POST {suggestions:[...]} → idempotent insert. accountId always comes from
 *    the bearer token. ON CONFLICT DO NOTHING with no target so BOTH replays
 *    are harmless: same client UUID (pk) and a recomputed suggestion with a
 *    fresh UUID for the same (account, exercise, source workout) — the unique
 *    index keeps the first row and its coach review intact.
 *  - GET → the latest suggestion per exerciseId for the caller (by createdAt),
 *    including coach review state, capped at 100. The mobile app fetches this
 *    on workout start and falls back to the local engine when absent.
 */

const suggestionSchema = z.object({
  id: z.string().min(1).max(64),
  exerciseId: z.string().min(1).max(120),
  exerciseName: z.string().min(1).max(200),
  sourceWorkoutId: z.string().min(1).max(64),
  action: z.enum(['increase', 'hold', 'deload']),
  targetWeightKg: z.number().min(0).max(10_000),
  targetRepsMin: z.number().int().min(1).max(100),
  targetRepsMax: z.number().int().min(1).max(100),
  reason: z.string().min(1).max(300),
});

const postSchema = z.object({
  suggestions: z.array(suggestionSchema).min(1).max(50),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();

  // Ownership gate, mirroring the sync route's re-select: a suggestion must
  // reference a synced workout THIS account owns. Without it, sourceWorkoutId
  // is free text and the (account, exercise, source workout) unique index
  // bounds nothing — a scripted client could flood the coach review queue
  // with unlimited pending rows. Unowned rows are silently dropped.
  const sourceIds = [...new Set(parsed.data.suggestions.map((s) => s.sourceWorkoutId))];
  const ownedRows = await db
    .select({ id: syncedWorkouts.id })
    .from(syncedWorkouts)
    .where(and(eq(syncedWorkouts.accountId, user.id), inArray(syncedWorkouts.id, sourceIds)));
  const ownedIds = new Set(ownedRows.map((r) => r.id));
  const accepted = parsed.data.suggestions.filter((s) => ownedIds.has(s.sourceWorkoutId));
  if (accepted.length === 0) return json({ ok: true }, 200);

  await db
    .insert(progressionSuggestions)
    .values(
      accepted.map((s) => ({
        id: s.id,
        accountId: user.id,
        exerciseId: s.exerciseId,
        exerciseName: s.exerciseName,
        sourceWorkoutId: s.sourceWorkoutId,
        action: s.action,
        targetWeightKg: s.targetWeightKg,
        targetRepsMin: s.targetRepsMin,
        targetRepsMax: s.targetRepsMax,
        reason: s.reason,
      })),
    )
    .onConflictDoNothing();

  return json({ ok: true }, 200);
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  // DISTINCT ON (exercise_id) with createdAt DESC = the newest suggestion per
  // exercise, whatever its review state.
  const rows = await getDb()
    .selectDistinctOn([progressionSuggestions.exerciseId])
    .from(progressionSuggestions)
    .where(eq(progressionSuggestions.accountId, user.id))
    .orderBy(progressionSuggestions.exerciseId, desc(progressionSuggestions.createdAt))
    .limit(100);

  return json({ suggestions: rows }, 200);
}
