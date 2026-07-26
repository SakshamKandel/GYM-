import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SetLog, WorkoutLog } from '@gym/shared';
import { z } from 'zod';
import { BASE_URL } from '../../lib/api/client';
import { nowIso } from '../../lib/dates';
import { getRepoForAccount } from '../../lib/repo';
import { useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';
import {
  fetchWorkoutRestorePage,
  MAX_SETS_PER_BATCH,
  MAX_WORKOUTS_PER_BATCH,
  postWorkoutBatch,
  SyncApiError,
  type SyncWorkoutPayload,
} from './api';
import { decideInvalidWorkoutBatch } from './queuePolicy';

/**
 * Workout backup: finished workouts flow from the local repo to the server, the
 * server can hand back workouts this device is missing (new phone, reinstall),
 * and a workout the member deletes here is deleted there too. A restore only
 * ever ADDS: nothing local is rewritten or removed by one, so this is still not
 * a merge engine.
 *
 * Retry safety, in order:
 *  1. Local workouts are marked synced ONLY after the server confirms the
 *     batch (`ok:true` + the id echoed in syncedWorkoutIds).
 *  2. The server upserts by client UUID, so a batch that was persisted but
 *     whose response was lost is harmlessly re-sent on the next trigger.
 *  3. Every failure is swallowed — sync is invisible to the workout UI and
 *     simply retries on the next trigger (finish() / app start).
 *  4. A workout the server's validator will never accept (400) is quarantined
 *     after being isolated. It stays local and is explicitly marked failed,
 *     never falsely marked as backed up, so it cannot wedge later rows.
 *  5. A deletion is retried until the server confirms it, and until then the
 *     restore half refuses to bring that workout back (see the ledger below).
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

// ── Deletions (device → server) ───────────────────────────────
// Deleting a workout used to be a local-only act: the server kept its copy, so
// the session went on counting toward the public board and walked straight back
// onto the next phone the member restored to.
//
// There is no delete hook to listen to — the repo simply drops the row — so the
// signal is absence. This ledger is the memory that makes absence readable: the
// ids the SERVER is known to hold, plus the ones that have since vanished from
// the local store and are waiting to be deleted upstream. A vanished id is a
// deletion, because the only other way a synced row leaves the local store is
// the store itself being cleared, which is what EMPTY_STORE_GUARD is for.

const SERVER_LEDGER_KEY_PREFIX = 'gym-tracker-workout-server-ledger-v1';

/** Bounds for the local scan — dates no real workout can fall outside. */
const EARLIEST_DATE = '0000-01-01';
const FAR_FUTURE_DATE = '9999-12-31';

/** Ids tracked per account. Older ids fall off; deletions of ancient workouts
 * are the rarest case and this keeps the stored blob small. */
const LEDGER_MAX_KNOWN = 1_000;

/** Tombstones held while the server is unreachable (or too old to delete). */
const LEDGER_MAX_PENDING = 200;

/** Server-side per-request cap (see /api/sync/workouts MAX_DELETIONS). */
const MAX_DELETIONS_PER_REQUEST = 50;

/**
 * When the local store comes back completely empty while the ledger believes
 * this device holds more than a handful of workouts, that reads as the store
 * having been cleared rather than the member having curated it, and propagating
 * it would erase their whole backed-up history for good. Skip the run instead:
 * the tombstones simply wait, and the moment there is any local workout again
 * the real deletions go through. A member who genuinely deletes their last
 * couple of sessions stays under the bar and propagates normally.
 */
const EMPTY_STORE_GUARD = 3;

interface ServerLedger {
  /** Workout ids the server holds, as far as this device knows. */
  known: string[];
  /** Earliest date among `known` — the lower bound of the local scan. */
  from: string;
  /** Deleted locally, not yet confirmed gone on the server. */
  pending: string[];
}

const EMPTY_LEDGER: ServerLedger = { known: [], from: FAR_FUTURE_DATE, pending: [] };

const ledgerSchema = z.object({
  known: z.array(z.string()),
  from: z.string(),
  pending: z.array(z.string()),
});

function ledgerKey(accountId: string): string {
  return `${SERVER_LEDGER_KEY_PREFIX}:${encodeURIComponent(accountId)}`;
}

/** The stored ledger, or null when this account has never had one written. */
async function loadLedger(accountId: string): Promise<ServerLedger | null> {
  try {
    const raw = await AsyncStorage.getItem(ledgerKey(accountId));
    if (!raw) return null;
    const parsed = ledgerSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : EMPTY_LEDGER;
  } catch {
    // Unreadable ledger degrades to "we know nothing", which only ever means
    // deletions from here on are tracked and older ones are not propagated.
    return EMPTY_LEDGER;
  }
}

/**
 * First run on this account: adopt everything the phone already holds as
 * "the server has it too".
 *
 * Without this, deletion only ever worked for workouts logged after the feature
 * shipped — every install already out there would keep silently orphaning its
 * server copies. Over-claiming is the safe direction: a tombstone for an id the
 * server never had (a workout still queued, or one permanently quarantined) is
 * matched by nothing and deletes nothing. Under-claiming is what loses the
 * member's intent.
 *
 * It also re-seeds after the ledger alone is lost, which is exactly right: the
 * phone's own history becomes the truth again, and nothing reads as deleted.
 */
async function ensureLedgerSeeded(accountId: string): Promise<void> {
  if ((await loadLedger(accountId)) !== null) return;
  const repo = await getRepoForAccount(accountId);
  const local = await repo.getWorkoutsBetween(EARLIEST_DATE, FAR_FUTURE_DATE);
  let from = FAR_FUTURE_DATE;
  for (const workout of local) if (workout.date < from) from = workout.date;
  await saveLedger(accountId, { known: local.map((w) => w.id), from, pending: [] });
}

async function saveLedger(accountId: string, ledger: ServerLedger): Promise<void> {
  try {
    await AsyncStorage.setItem(
      ledgerKey(accountId),
      JSON.stringify({
        known: ledger.known.slice(-LEDGER_MAX_KNOWN),
        from: ledger.from,
        pending: ledger.pending.slice(-LEDGER_MAX_PENDING),
      } satisfies ServerLedger),
    );
  } catch {
    // Best-effort: a failed write costs deletion tracking, never data.
  }
}

/** Record workouts the server now holds (confirmed upload, or restored page). */
async function rememberServerWorkouts(
  accountId: string,
  entries: readonly { id: string; date: string }[],
): Promise<void> {
  if (entries.length === 0) return;
  const ledger = (await loadLedger(accountId)) ?? EMPTY_LEDGER;
  const known = new Set(ledger.known);
  // A tombstone still in flight must not be re-adopted as "the server holds it";
  // the deletion is the newer intent and stays queued until it is confirmed.
  const tombstoned = new Set(ledger.pending);
  let from = ledger.from;
  let added = false;
  for (const entry of entries) {
    if (tombstoned.has(entry.id) || known.has(entry.id)) continue;
    known.add(entry.id);
    added = true;
    if (entry.date < from) from = entry.date;
  }
  if (!added && from === ledger.from) return;
  await saveLedger(accountId, { known: [...known], from, pending: ledger.pending });
}

const deletionResponseSchema = z.object({
  ok: z.literal(true),
  // Required on purpose: a server that predates deletion support answers without
  // it, and the tombstones must stay queued rather than be dropped unsent.
  deletedWorkoutIds: z.array(z.string()),
});

/** Every call gives up after this long — deletions retry on the next trigger. */
const DELETE_REQUEST_TIMEOUT_MS = 10_000;

/**
 * POST the tombstone batch. Returns the ids the server confirmed it no longer
 * holds, or null when this server cannot delete (or could not be reached), in
 * which case the caller keeps them queued.
 */
async function postWorkoutDeletions(token: string, ids: string[]): Promise<string[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELETE_REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/sync/workouts`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ deletedWorkoutIds: ids }),
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return null;
  try {
    const parsed = deletionResponseSchema.safeParse((await res.json()) as unknown);
    return parsed.success ? parsed.data.deletedWorkoutIds : null;
  } catch {
    return null;
  }
}

/**
 * Turn "the ledger says the server holds it, the phone no longer does" into
 * tombstones, then send one batch of them. Silent on every failure, like the
 * rest of sync: whatever is left over goes out on the next trigger.
 */
async function pushDeletions(accountId: string): Promise<void> {
  const auth = useAuth.getState();
  if (auth.status !== 'signedIn' || !auth.token || auth.user?.id !== accountId) return;

  const repo = await getRepoForAccount(accountId);
  const ledger = await loadLedger(accountId);
  // Never seeded (a failed seed write) — absence means nothing yet, so infer
  // nothing. The next run seeds and normal service resumes.
  if (!ledger) return;

  let known = ledger.known;
  let pending = ledger.pending;

  if (known.length > 0) {
    const local = await repo.getWorkoutsBetween(ledger.from, FAR_FUTURE_DATE);
    // The store looks cleared, not curated — leave everything alone (see
    // EMPTY_STORE_GUARD). The tombstones are not lost, only deferred.
    if (local.length === 0 && known.length > EMPTY_STORE_GUARD) return;

    const localIds = new Set(local.map((w) => w.id));
    const gone = known.filter((id) => !localIds.has(id));
    if (gone.length > 0) {
      known = known.filter((id) => localIds.has(id));
      pending = [...new Set([...pending, ...gone])];
      await saveLedger(accountId, { known, from: ledger.from, pending });
    }
  }

  if (pending.length === 0) return;
  const batch = pending.slice(0, MAX_DELETIONS_PER_REQUEST);
  const confirmed = await postWorkoutDeletions(auth.token, batch);
  if (confirmed === null || confirmed.length === 0) return;

  // Re-read: the drain/restore running alongside may have touched the ledger.
  const latest = (await loadLedger(accountId)) ?? { known, from: ledger.from, pending };
  const done = new Set(confirmed);
  await saveLedger(accountId, {
    known: latest.known.filter((id) => !done.has(id)),
    from: latest.from,
    pending: latest.pending.filter((id) => !done.has(id)),
  });
}

// Local ownership is enforced by the repository. Sync asks for an immutable
// account-scoped view, so a later auth transition cannot retarget or discard
// this member's pending rows.

// Overlapping triggers (finish() while the app-start drain is running) must
// not double-send a batch — the module-level guard makes the second call a
// no-op; whatever it would have sent is picked up by the next trigger anyway.
let inFlight = false;

/**
 * Drain the unsynced-workout backlog to the server, then pull back anything
 * this device is missing. Fire-and-forget: no-ops when signed out or already
 * running, never throws, never blocks the caller — always `void syncWorkouts()`.
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
    // First, make sure this account's deletion ledger exists — everything below
    // reads "the phone no longer has it" as intent, which is only true once the
    // ledger knows what the phone had. Ledger work is fenced off on its own: the
    // backup is the job, and losing deletion tracking for one run must never
    // cost the member an upload or a restore.
    try {
      await ensureLedgerSeeded(accountId);
    } catch {
      // Seeds again on the next trigger.
    }
    await drainWorkouts(accountId);
    // Deletions go before the pull for the same reason the upload does: they
    // only exist on this phone, and sending them first means the restore below
    // is already reading a server that agrees with what the member deleted.
    try {
      await pushDeletions(accountId);
    } catch {
      // Tombstones stay queued for the next trigger.
    }
    // Upload first, restore second: the backlog is the part that only exists
    // on this phone, so it can never be delayed behind a long download.
    await restoreWorkouts(accountId);
  } catch {
    // Offline / server hiccup / expired session — silent by design. The
    // backlog stays local and the next trigger retries it.
  } finally {
    inFlight = false;
  }
}

/** The upload half. Returns when there is nothing more it can safely send. */
async function drainWorkouts(accountId: string): Promise<void> {
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
    // after it. Isolate the oldest workout; if it 400s alone, quarantine it
    // locally (the row stays on-device and is NOT recorded as synced).
    let toSend = batch;
    let syncedIds: string[] | null = null;
    while (syncedIds === null) {
      try {
        syncedIds = await postWorkoutBatch(auth.token, toSend);
      } catch (err) {
        if (!(err instanceof SyncApiError) || err.code !== 'invalid') throw err;
        const decision = decideInvalidWorkoutBatch(toSend.map((workout) => workout.id));
        if (decision.kind === 'isolate') {
          toSend = toSend.filter((workout) => workout.id === decision.retryWorkoutId);
          continue;
        }
        if (decision.kind === 'stop') return;
        await repo.markWorkoutSyncFailed({
          workoutId: decision.workoutId,
          code: 'invalid_payload',
          failedAt: nowIso(),
        });
        break;
      }
    }
    if (syncedIds === null) continue; // poison quarantined — drain the rest

    // Trust the intersection only: mark local rows synced when the server
    // explicitly confirmed THAT id (rule 11 — never assume, never delete).
    const sent = new Set(toSend.map((w) => w.id));
    const confirmed = syncedIds.filter((id) => sent.has(id));
    if (confirmed.length === 0) return; // nothing landed — retry next trigger
    await repo.markWorkoutsSynced(confirmed, nowIso());
    // The server now holds these, so their later disappearance from the local
    // store is a deletion this device has to pass on.
    const confirmedSet = new Set(confirmed);
    await rememberServerWorkouts(
      accountId,
      pending
        .filter((row) => confirmedSet.has(row.workout.id))
        .map((row) => ({ id: row.workout.id, date: row.workout.date })),
    );
    await notifyProgression(accountId, confirmed);

    // Keep draining only after a fully-confirmed batch AND when more may
    // remain (full page, or the caps trimmed this one). A partial
    // confirmation stops here so we never spin on the same failing rows.
    const morePending =
      pending.length === MAX_WORKOUTS_PER_BATCH || toSend.length < pending.length;
    if (confirmed.length < toSend.length || !morePending) return;
  }
}

// ── Restore (server → device) ─────────────────────────────────
// Accounts whose restore stream is fully caught up in THIS app run. The
// cursor itself is durable; this only stops a finished restore from asking
// again after every workout the member logs.
const restoredAccounts = new Set<string>();

/** Bounded per run so a huge history can never monopolise a session. */
const MAX_RESTORE_PAGES_PER_RUN = 10;

/**
 * Pull back workouts this device doesn't have, oldest first, resuming from the
 * stored cursor. Everything it can do is additive (see the repo's
 * applyWorkoutRestorePage), so an interrupted or repeated run is harmless:
 * pages already applied simply find every row present and skip it.
 *
 * Silent on failure like the rest of sync — an old server, an offline phone or
 * a rate limit just means the remaining pages arrive on a later trigger.
 */
async function restoreWorkouts(accountId: string): Promise<void> {
  if (restoredAccounts.has(accountId)) return;
  const repo = await getRepoForAccount(accountId);
  for (let page = 0; page < MAX_RESTORE_PAGES_PER_RUN; page += 1) {
    // Same per-page auth re-read as the drain: a sign-out or account switch
    // must not write one member's history into another's namespace.
    const auth = useAuth.getState();
    if (auth.status !== 'signedIn' || !auth.token || auth.user?.id !== accountId) return;

    const cursor = await repo.getWorkoutRestoreCursor();
    const restored = await fetchWorkoutRestorePage(auth.token, cursor);
    // Server too old to restore — stop asking for the rest of this run.
    if (restored === null) return;

    const current = useAuth.getState();
    if (current.status !== 'signedIn' || current.user?.id !== accountId) return;

    // A workout the member deleted must not walk back in while its deletion is
    // still queued (offline, or a server that can't delete yet). Dropping it
    // from the page only — the cursor still advances, so the rest of the page
    // lands and the stream keeps moving.
    const ledger = await loadLedger(accountId);
    const tombstoned = new Set(ledger?.pending ?? []);
    const page =
      tombstoned.size === 0
        ? restored
        : {
            ...restored,
            restoredWorkouts: restored.restoredWorkouts.filter((w) => !tombstoned.has(w.id)),
          };
    await repo.applyWorkoutRestorePage(page);
    // Everything in this page exists on the server, deleted-and-queued rows
    // aside — remember it so a later local delete propagates.
    await rememberServerWorkouts(
      accountId,
      page.restoredWorkouts.map((w) => ({ id: w.id, date: w.date })),
    );

    if (!restored.hasMore) {
      restoredAccounts.add(accountId);
      return;
    }
  }
}
