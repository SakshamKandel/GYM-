import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SetLog, WorkoutLog } from '@gym/shared';
import { nowIso } from '../../lib/dates';
import { getRepoForAccount } from '../../lib/repo';
import { useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';
import {
  MAX_SETS_PER_BATCH,
  MAX_WORKOUTS_PER_BATCH,
  postWorkoutBatch,
  SyncApiError,
  type SyncWorkoutPayload,
} from './api';

/**
 * One-way, append-only workout backup: finished workouts flow from the local
 * repo to the server and NOTHING flows back (no download, no merge — v1 is
 * deliberately not a sync engine).
 *
 * Retry safety, in order:
 *  1. Local workouts are marked synced ONLY after the server confirms the
 *     batch (`ok:true` + the id echoed in syncedWorkoutIds).
 *  2. The server upserts by client UUID, so a batch that was persisted but
 *     whose response was lost is harmlessly re-sent on the next trigger.
 *  3. Every failure is swallowed — sync is invisible to the workout UI and
 *     simply retries on the next trigger (finish() / app start).
 *  4. A workout the server's validator will never accept (400) is skipped
 *     after being isolated into its own batch, so one poisoned row can never
 *     wedge the queue for everything logged after it.
 */

// Server-side per-field caps (see /api/sync/workouts zod schema). Payloads are
// clamped to these client-side so a pathological local row (week-long
// abandoned session, corrupted weight) degrades gracefully instead of 400-ing
// the batch it rides in.
const MAX_DURATION_SEC = 7 * 86_400;
const MAX_WEIGHT_KG = 10_000;
const MAX_REPS = 10_000;

/** Local → wire mapping. Local rows never carry a warmup flag yet — omitted. */
function toPayload(
  workout: WorkoutLog,
  sets: SetLog[],
  unitPref: 'kg' | 'lb',
): SyncWorkoutPayload {
  return {
    id: workout.id,
    date: workout.date,
    name: workout.name,
    // Plan-based workouts carry the template id, and their name IS the
    // template's name. Freestyle/custom sessions send neither.
    ...(workout.planWorkoutId !== null
      ? { templateId: workout.planWorkoutId, templateName: workout.name }
      : {}),
    startedAt: workout.startedAt,
    // Callers only hand us finished workouts; the fallback never fires but
    // keeps the payload total (the wire contract requires finishedAt).
    finishedAt: workout.finishedAt ?? workout.startedAt,
    ...(workout.durationSec !== null
      ? { durationSec: Math.max(0, Math.min(workout.durationSec, MAX_DURATION_SEC)) }
      : {}),
    // A single workout above the batch set cap would be rejected whole by the
    // server — back up the first 500 sets rather than none forever.
    sets: sets.slice(0, MAX_SETS_PER_BATCH).map((s) => ({
      id: s.id,
      setNo: s.setNo,
      exerciseId: s.exerciseId,
      exerciseName: s.exerciseName,
      weightKg: Math.max(0, Math.min(s.weightKg, MAX_WEIGHT_KG)),
      weightUnit: unitPref,
      reps: Math.max(0, Math.min(s.reps, MAX_REPS)),
      ...(s.rpe !== null ? { rpe: s.rpe } : {}),
      isPr: s.isPr,
      loggedAt: s.loggedAt,
    })),
  };
}

/**
 * Trim a page of pending workouts down to the server's batch caps. Workouts
 * stay whole (a workout's sets are never split across batches); the first
 * workout is always included — its set payload is already truncated to the
 * batch cap by toPayload, so it can't wedge the queue.
 */
function buildBatch(
  pending: { workout: WorkoutLog; sets: SetLog[] }[],
  unitPref: 'kg' | 'lb',
): SyncWorkoutPayload[] {
  const batch: SyncWorkoutPayload[] = [];
  let setCount = 0;
  for (const { workout, sets } of pending) {
    const payload = toPayload(workout, sets, unitPref);
    if (batch.length > 0 && setCount + payload.sets.length > MAX_SETS_PER_BATCH) break;
    batch.push(payload);
    setCount += payload.sets.length;
    if (batch.length >= MAX_WORKOUTS_PER_BATCH) break;
  }
  return batch;
}

// ── Progression hand-off retry backlog ────────────────────────
// Workouts are marked synced BEFORE their suggestions POST, so a network drop
// in between would otherwise lose that batch's suggestions forever (the drain
// only sees unsynced rows). Persist the ids whose suggestions haven't been
// confirmed and fold them into the next hand-off.

const SUGGESTION_RETRY_KEY_PREFIX = 'gym-tracker-suggestion-retry-v2';
/** Bound the backlog — replays are idempotent server-side, staleness is fine. */
const SUGGESTION_RETRY_MAX = 50;

function suggestionRetryKey(accountId: string): string {
  return `${SUGGESTION_RETRY_KEY_PREFIX}:${encodeURIComponent(accountId)}`;
}

async function loadSuggestionRetry(accountId: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(suggestionRetryKey(accountId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function saveSuggestionRetry(accountId: string, ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(
      suggestionRetryKey(accountId),
      JSON.stringify(ids.slice(-SUGGESTION_RETRY_MAX)),
    );
  } catch {
    // Best-effort — losing the retry list degrades to the old behavior.
  }
}

/** Progression hand-off (contracted export) — best-effort, never fatal. */
async function notifyProgression(accountId: string, syncedIds: string[]): Promise<void> {
  const backlog = await loadSuggestionRetry(accountId);
  const ids = [...new Set([...backlog, ...syncedIds])];
  if (ids.length === 0) return;
  let posted = false;
  try {
    const { submitSuggestionsForWorkouts } = await import('../progression/submit');
    posted = await submitSuggestionsForWorkouts(ids, accountId);
  } catch {
    // Progression is a bonus on top of sync — the backup already succeeded.
  }
  await saveSuggestionRetry(accountId, posted ? [] : ids);
}

// Local ownership is enforced by the repository. Sync asks for an immutable
// account-scoped view, so a later auth transition cannot retarget or discard
// this member's pending rows.

// Overlapping triggers (finish() while the app-start drain is running) must
// not double-send a batch — the module-level guard makes the second call a
// no-op; whatever it would have sent is picked up by the next trigger anyway.
let inFlight = false;

/**
 * Drain the unsynced-workout backlog to the server. Fire-and-forget:
 * no-ops when signed out or already running, never throws, never blocks
 * the caller — always `void syncWorkouts()`.
 */
export async function syncWorkouts(): Promise<void> {
  if (inFlight) return;
  const initialAuth = useAuth.getState();
  if (initialAuth.status !== 'signedIn' || !initialAuth.user) return;
  inFlight = true;
  // Pin the whole drain to the account whose backlog ownership we verify
  // below. A mid-drain account switch (sign out + a different member signs
  // in on a shared device) must NOT upload this account's still-unsynced
  // rows under the new member's token.
  const accountId = initialAuth.user.id;
  try {
    const repo = await getRepoForAccount(accountId);
    for (;;) {
      // Re-read per batch so a mid-drain sign-out — or a switch to a
      // different account — stops the upload cleanly.
      const auth = useAuth.getState();
      if (auth.status !== 'signedIn' || !auth.token || auth.user?.id !== accountId) return;
      const unitPref = useProfile.getState().unitPref;

      const pending = await repo.getUnsyncedFinishedWorkouts(MAX_WORKOUTS_PER_BATCH);
      if (pending.length === 0) {
        // Nothing to upload, but a previous drain may have synced workouts
        // whose suggestion POST was lost — flush that backlog on its own.
        await notifyProgression(accountId, []);
        return;
      }
      const batch = buildBatch(pending, unitPref);
      if (batch.length === 0) return;

      // Poison-pill escape: a 400 means the validator will never accept this
      // body, so retrying it forever would silently block every workout logged
      // after it. Isolate the oldest workout; if it 400s alone, mark it synced
      // locally (skipped — the row stays on-device) and move on.
      let toSend = batch;
      let syncedIds: string[] | null = null;
      while (syncedIds === null) {
        try {
          syncedIds = await postWorkoutBatch(auth.token, toSend);
        } catch (err) {
          if (!(err instanceof SyncApiError) || err.code !== 'invalid') throw err;
          if (toSend.length > 1) {
            toSend = toSend.slice(0, 1);
            continue;
          }
          await repo.markWorkoutsSynced([toSend[0]!.id], nowIso());
          break;
        }
      }
      if (syncedIds === null) continue; // poison skipped — drain the rest

      // Trust the intersection only: mark local rows synced when the server
      // explicitly confirmed THAT id (rule 11 — never assume, never delete).
      const sent = new Set(toSend.map((w) => w.id));
      const confirmed = syncedIds.filter((id) => sent.has(id));
      if (confirmed.length === 0) return; // nothing landed — retry next trigger
      await repo.markWorkoutsSynced(confirmed, nowIso());
      await notifyProgression(accountId, confirmed);

      // Keep draining only after a fully-confirmed batch AND when more may
      // remain (full page, or the caps trimmed this one). A partial
      // confirmation stops here so we never spin on the same failing rows.
      const morePending =
        pending.length === MAX_WORKOUTS_PER_BATCH || toSend.length < pending.length;
      if (confirmed.length < toSend.length || !morePending) return;
    }
  } catch {
    // Offline / server hiccup / expired session — silent by design. The
    // backlog stays local and the next trigger retries it.
  } finally {
    inFlight = false;
  }
}
