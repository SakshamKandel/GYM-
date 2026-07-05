import { z } from 'zod';
import type { UnitPref } from '@gym/shared';
import { BASE_URL } from '../../lib/api/client';

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
 * POST /api/sync/workouts {workouts} → the workout ids the server accepted
 * (previously-synced ids included — duplicates are a server-side no-op).
 * Throws SyncApiError; callers treat every failure as "retry next trigger".
 */
export async function postWorkoutBatch(
  token: string,
  workouts: SyncWorkoutPayload[],
): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/sync/workouts`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ workouts }),
      signal: controller.signal,
    });
  } catch {
    throw new SyncApiError('network', "Can't reach the server");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    if (res.status === 401) throw new SyncApiError('unauthorized');
    if (res.status === 400) throw new SyncApiError('invalid');
    throw new SyncApiError('network');
  }

  let data: unknown;
  try {
    data = (await res.json()) as unknown;
  } catch {
    throw new SyncApiError('network', 'Unexpected server response');
  }
  const parsed = syncResponseSchema.safeParse(data);
  if (!parsed.success) throw new SyncApiError('network', 'Unexpected server response');
  return parsed.data.syncedWorkoutIds;
}
