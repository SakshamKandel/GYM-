import { z } from 'zod';
import type { ProgressionAction } from '@gym/shared';
import { BASE_URL } from '../../lib/api/client';

/**
 * Progression suggestions API client — client-computed targets flowing up for
 * coach review, and the reviewed state flowing back down.
 *
 * Same philosophy as the sibling clients (features/sync/api.ts, features/
 * staff/api.ts): plain bearer calls against BASE_URL, zod at the boundary,
 * typed error codes, and a hard request timeout so a hung connection can
 * never stall the logging flow. POST is idempotent server-side: the row pk
 * AND the (account, exercise, source workout) unique index both conflict-do-
 * nothing, so re-sending after a lost response is harmless.
 *
 *  Error codes:
 *   'unauthorized' → 401 (no/expired session token)
 *   'invalid'      → 400 (validation rejected the request body)
 *   'network'      → offline, timeout, non-JSON, or a malformed response
 */

// ── Error type ────────────────────────────────────────────────

export type ProgressionErrorCode = 'unauthorized' | 'invalid' | 'network';

export class ProgressionApiError extends Error {
  readonly code: ProgressionErrorCode;

  constructor(code: ProgressionErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ProgressionApiError';
    this.code = code;
  }
}

// ── Wire types (see /api/progression/suggestions contract) ────

export interface SuggestionPayload {
  /** Client-generated UUID — the server's idempotency key. */
  id: string;
  exerciseId: string;
  exerciseName: string;
  /** The synced workout the suggestion was computed after. */
  sourceWorkoutId: string;
  action: ProgressionAction;
  /** Canonical kg always — convert at the display edge only. */
  targetWeightKg: number;
  targetRepsMin: number;
  targetRepsMax: number;
  reason: string;
}

/** Server-side POST cap — the client must never exceed it. */
export const MAX_SUGGESTIONS_PER_POST = 50;

export type SuggestionStatus = 'pending' | 'approved' | 'adjusted';

const serverSuggestionSchema = z.object({
  id: z.string(),
  exerciseId: z.string(),
  exerciseName: z.string(),
  sourceWorkoutId: z.string(),
  action: z.enum(['increase', 'hold', 'deload']),
  targetWeightKg: z.number(),
  targetRepsMin: z.number(),
  targetRepsMax: z.number(),
  reason: z.string(),
  status: z.enum(['pending', 'approved', 'adjusted']),
  /** Coach-adjusted weight (kg) — only meaningful when status='adjusted'. */
  adjustedWeightKg: z.number().nullable().catch(null),
  coachNote: z.string().nullable().catch(null),
  reviewedAt: z.string().nullable().catch(null),
  createdAt: z.string(),
});
export type ServerSuggestion = z.infer<typeof serverSuggestionSchema>;

/** Resilient list: drop unparseable rows rather than blanking every exercise. */
const suggestionsListSchema = z.object({
  suggestions: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): ServerSuggestion[] => {
      const parsed = serverSuggestionSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

const okSchema = z.object({ ok: z.literal(true) });

// ── Fetch plumbing ────────────────────────────────────────────

/** Every call gives up after this long — suggestions never block logging. */
const REQUEST_TIMEOUT_MS = 10_000;

async function request(opts: {
  method: 'GET' | 'POST';
  token: string;
  body?: Record<string, unknown>;
}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/progression/suggestions`, {
      method: opts.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${opts.token}`,
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : null),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ProgressionApiError('network', "Can't reach the server");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    if (res.status === 401) throw new ProgressionApiError('unauthorized');
    if (res.status === 400) throw new ProgressionApiError('invalid');
    throw new ProgressionApiError('network');
  }

  try {
    return (await res.json()) as unknown;
  } catch {
    throw new ProgressionApiError('network', 'Unexpected server response');
  }
}

/** Validate a payload; a malformed body is indistinguishable from a bad server. */
function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ProgressionApiError('network', 'Unexpected server response');
  return parsed.data;
}

// ── Calls ─────────────────────────────────────────────────────

/**
 * POST /api/progression/suggestions {suggestions} → idempotent insert for
 * coach review. Throws ProgressionApiError; callers treat every failure as
 * "retry on the next sync trigger".
 */
export async function postSuggestions(
  token: string,
  suggestions: SuggestionPayload[],
): Promise<void> {
  if (suggestions.length === 0) return;
  const data = await request({ method: 'POST', token, body: { suggestions } });
  parse(okSchema, data);
}

/**
 * GET /api/progression/suggestions → the caller's latest suggestion per
 * exercise (any review state), newest first per exercise, capped server-side.
 */
export async function getSuggestions(token: string): Promise<ServerSuggestion[]> {
  const data = await request({ method: 'GET', token });
  return parse(suggestionsListSchema, data).suggestions;
}
