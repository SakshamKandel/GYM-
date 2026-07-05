import { z } from 'zod';
import { BASE_URL } from '../../lib/api/client';

/**
 * Weekly coach check-in API client (distinct from the local GM WeeklyCheckIn
 * feature — this one reaches the coach console).
 *
 * Same philosophy as the sibling clients (features/sync/api.ts, features/
 * progression/api.ts): plain bearer calls against BASE_URL, zod at the
 * boundary, typed error codes, and a hard request timeout. POST is idempotent
 * server-side: the row pk AND the (account, date) unique index both conflict-
 * do-nothing, and a replay returns the EXISTING row — so re-sending after a
 * lost response always converges on one check-in per day.
 *
 *  Error codes:
 *   'unauthorized' → 401 (no/expired session token)
 *   'invalid'      → 400 (validation rejected the request body)
 *   'network'      → offline, timeout, non-JSON, or a malformed response
 */

// ── Error type ────────────────────────────────────────────────

export type CheckInErrorCode = 'unauthorized' | 'invalid' | 'network';

export class CheckInApiError extends Error {
  readonly code: CheckInErrorCode;

  constructor(code: CheckInErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CheckInApiError';
    this.code = code;
  }
}

// ── Wire types (see /api/check-ins contract) ──────────────────

/** Auto-attached week summary computed from local data at submit time. */
export interface CheckInSummary {
  sessions: number;
  /** Canonical kg — convert at the display edge only. */
  volumeKg: number;
  prCount: number;
}

export interface CheckInPayload {
  /** Client-generated UUID — the server's idempotency key. */
  id: string;
  /** Local date, yyyy-mm-dd. One check-in per account per date. */
  date: string;
  /** Canonical kg (already converted from the display unit). */
  bodyweightKg?: number;
  /** 1–5 */
  sleep: number;
  /** 1–5 */
  energy: number;
  /** 1–5 */
  soreness: number;
  note?: string;
  summary: CheckInSummary;
}

const summarySchema = z.object({
  sessions: z.number(),
  volumeKg: z.number(),
  prCount: z.number(),
});

const serverCheckInSchema = z.object({
  id: z.string(),
  date: z.string(),
  bodyweightKg: z.number().nullable().catch(null),
  sleep: z.number(),
  energy: z.number(),
  soreness: z.number(),
  note: z.string().catch(''),
  summary: summarySchema.catch({ sessions: 0, volumeKg: 0, prCount: 0 }),
  /** The coach's reply, when one exists — a coachMessages row id. */
  coachReplyMessageId: z.string().nullable().catch(null),
  createdAt: z.string(),
});
export type ServerCheckIn = z.infer<typeof serverCheckInSchema>;

const postResponseSchema = z.object({ checkIn: serverCheckInSchema });

/** Resilient list: drop unparseable rows rather than failing the fetch. */
const listResponseSchema = z.object({
  checkIns: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): ServerCheckIn[] => {
      const parsed = serverCheckInSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

// ── Fetch plumbing ────────────────────────────────────────────

/** Every call gives up after this long — the card retries on the next focus. */
const REQUEST_TIMEOUT_MS = 10_000;

async function request(opts: {
  method: 'GET' | 'POST';
  path: string;
  token: string;
  body?: Record<string, unknown>;
}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${opts.path}`, {
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
    throw new CheckInApiError('network', "Can't reach the server");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    if (res.status === 401) throw new CheckInApiError('unauthorized');
    if (res.status === 400) throw new CheckInApiError('invalid');
    throw new CheckInApiError('network');
  }

  try {
    return (await res.json()) as unknown;
  } catch {
    throw new CheckInApiError('network', 'Unexpected server response');
  }
}

/** Validate a payload; a malformed body is indistinguishable from a bad server. */
function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new CheckInApiError('network', 'Unexpected server response');
  return parsed.data;
}

// ── Calls ─────────────────────────────────────────────────────

/**
 * POST /api/check-ins → the stored row (201 fresh, 200 when today's check-in
 * already exists — the server returns the existing row either way, so the
 * caller can always adopt the result as "the check-in of record").
 */
export async function postCheckIn(
  token: string,
  payload: CheckInPayload,
): Promise<ServerCheckIn> {
  const data = await request({
    method: 'POST',
    path: '/api/check-ins',
    token,
    body: payload as unknown as Record<string, unknown>,
  });
  return parse(postResponseSchema, data).checkIn;
}

/** GET /api/check-ins?limit=N → newest first (restores due-state on reinstall). */
export async function getCheckIns(token: string, limit = 10): Promise<ServerCheckIn[]> {
  const data = await request({
    method: 'GET',
    path: `/api/check-ins?limit=${limit}`,
    token,
  });
  return parse(listResponseSchema, data).checkIns;
}
