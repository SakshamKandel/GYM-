import { z } from 'zod';
import {
  workoutRestorePageSchema,
  type UnitPref,
  type WorkoutRestoreCursor,
  type WorkoutRestorePage,
} from '@gym/shared';
import { BASE_URL, fetchWithTimeout, httpStatusToCode } from '../../lib/api/client';

/**
 * Workout sync API client — one-way, append-only backup of finished workouts.
 *
 * Same philosophy as the sibling clients (lib/api/client.ts, features/staff/
 * api.ts): plain bearer calls against BASE_URL, zod at the boundary, typed
 * error codes, and a hard request timeout so a hung connection can never
 * stall the caller. The server upserts by client UUID (onConflictDoNothing),
 * so re-sending the same batch is harmless by design.
 *
 *  Error codes:
 *   'unauthorized' → 401 (no/expired session token)
 *   'invalid'      → 400 (validation rejected the request body)
 *   'network'      → offline, timeout, non-JSON, or a malformed response
 */

// ── Error type ────────────────────────────────────────────────

export type SyncErrorCode = 'unauthorized' | 'invalid' | 'network';

export class SyncApiError extends Error {
  readonly code: SyncErrorCode;

  constructor(code: SyncErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SyncApiError';
    this.code = code;
  }
}

// ── Wire types (see /api/sync/workouts contract) ──────────────

export interface SyncSetPayload {
  /** Client-generated UUID — the server's idempotency key. */
  id: string;
  setNo: number;
  exerciseId: string;
  exerciseName: string;
  /** Canonical kg always; weightUnit is only the user's display preference. */
  weightKg: number;
  weightUnit: UnitPref;
  reps: number;
  rpe?: number;
  isPr?: boolean;
  loggedAt: string;
}

export interface SyncWorkoutPayload {
  /** Client-generated UUID — the server's idempotency key. */
  id: string;
  date: string;
  name: string;
  templateId?: string;
  templateName?: string;
  startedAt: string;
  finishedAt: string;
  durationSec?: number;
  sets: SyncSetPayload[];
}

/** Server-side batch caps — the client must never exceed them. */
export const MAX_WORKOUTS_PER_BATCH = 25;
export const MAX_SETS_PER_BATCH = 500;

const syncResponseSchema = z.object({
  ok: z.literal(true),
  syncedWorkoutIds: z.array(z.string()),
});

// ── Fetch plumbing ────────────────────────────────────────────

/** Every call gives up after this long — sync retries on the next trigger. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The shared status table narrowed to this client's union: sync has no separate
 * copy for 403/404/409/429/503, so those keep reading as a plain failure and
 * the batch simply goes out again on the next trigger. Exported to the sibling
 * member-data client, which speaks the same SyncApiError.
 */
export function syncStatusToCode(status: number): SyncErrorCode {
  const code = httpStatusToCode(status);
  return code === 'unauthorized' || code === 'invalid' ? code : 'network';
}

/** What a call may carry. Both halves are optional and independent. */
interface WorkoutSyncBody {
  workouts?: SyncWorkoutPayload[];
  /** Omit for push-only. Null asks for the restore stream from its start. */
  cursor?: WorkoutRestoreCursor | null;
}

interface WorkoutSyncResult {
  syncedWorkoutIds: string[];
  /** Null when no cursor was sent, or the server is older than restore. */
  restore: WorkoutRestorePage | null;
}

/**
 * POST /api/sync/workouts — push a batch, pull a restore page, or both.
 *
 * JSON.stringify drops undefined-valued keys, so a push-only call puts exactly
 * `{"workouts":[…]}` on the wire, the same bytes as before restore existed.
 */
async function postWorkoutSync(token: string, body: WorkoutSyncBody): Promise<WorkoutSyncResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${BASE_URL}/api/sync/workouts`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ workouts: body.workouts, cursor: body.cursor }),
      },
      REQUEST_TIMEOUT_MS,
    );
  } catch {
    throw new SyncApiError('network', "We couldn't connect. Check your connection and try again");
  }

  if (!res.ok) throw new SyncApiError(syncStatusToCode(res.status));

  let data: unknown;
  try {
    data = (await res.json()) as unknown;
  } catch {
    throw new SyncApiError('network', 'Unexpected server response');
  }
  const parsed = syncResponseSchema.safeParse(data);
  if (!parsed.success) throw new SyncApiError('network', 'Unexpected server response');
  // The restore keys are read separately and never required: a server that
  // predates restore (a hosted deploy lagging the app build) simply omits
  // them, and the push half of this call must still succeed.
  const restore = workoutRestorePageSchema.safeParse(data);
  return {
    syncedWorkoutIds: parsed.data.syncedWorkoutIds,
    restore: restore.success ? restore.data : null,
  };
}

/**
 * POST /api/sync/workouts {workouts} → the workout ids the server accepted
 * (previously-synced ids included — duplicates are a server-side no-op).
 * Throws SyncApiError; callers treat every failure as "retry next trigger".
 */
export async function postWorkoutBatch(
  token: string,
  workouts: SyncWorkoutPayload[],
): Promise<string[]> {
  const result = await postWorkoutSync(token, { workouts });
  return result.syncedWorkoutIds;
}

/**
 * One page of this account's server-held workouts, resumed from `cursor`
 * (null = from the beginning). Null result = this server can't restore; the
 * caller stops asking for the rest of the run. Throws SyncApiError like its
 * sibling, so offline is just "try again next trigger".
 */
export async function fetchWorkoutRestorePage(
  token: string,
  cursor: WorkoutRestoreCursor | null,
): Promise<WorkoutRestorePage | null> {
  const result = await postWorkoutSync(token, { cursor });
  return result.restore;
}
