import { z } from 'zod';
import { BASE_URL } from '../../lib/api/client';

/**
 * Mentorship API client — the MEMBER side of the coach-trainee system:
 * browse the coach directory, request coaching, see your assigned coach
 * and the milestones they've logged for you.
 *
 * Same philosophy as lib/api/client.ts / features/staff/api.ts: plain
 * bearer calls against the SAME host, zod at the boundary (CLAUDE.md
 * rule 8), and every failure surfaces as a typed `MentorshipApiError`
 * code so screens branch on `.code` instead of string-matching messages.
 *
 *  Error codes:
 *   'already_pending'  → POST /api/coach-requests while one is pending
 *   'already_assigned' → POST /api/coach-requests while assigned a coach
 *   'not_accepting'    → the coach isn't taking clients / is at capacity
 *   'not_found'        → unknown coach / request id
 *   'invalid'          → validation rejected the request body
 *   'unauthorized'     → 401 (no/expired session token)
 *   'network'          → offline, non-JSON, or a malformed response
 */

// ── Error type ────────────────────────────────────────────────

export type MentorshipErrorCode =
  | 'already_pending'
  | 'already_assigned'
  | 'not_accepting'
  | 'not_found'
  | 'invalid'
  | 'unauthorized'
  | 'network';

export class MentorshipApiError extends Error {
  readonly code: MentorshipErrorCode;

  constructor(code: MentorshipErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'MentorshipApiError';
    this.code = code;
  }
}

/** Narrow an unknown thrown value to MentorshipApiError (anything else = network). */
export function toMentorshipError(err: unknown): MentorshipApiError {
  return err instanceof MentorshipApiError ? err : new MentorshipApiError('network');
}

// ── Schemas ───────────────────────────────────────────────────

const coachCardSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  headline: z.string(),
  avatarUrl: z.string().nullable(),
  specialties: z.array(z.string()),
  yearsExperience: z.number(),
  acceptingClients: z.boolean(),
  hasCapacity: z.boolean(),
  activeClients: z.number(),
});
export type CoachCardData = z.infer<typeof coachCardSchema>;

/**
 * Resilient directory: one row a build can't parse is dropped, not fatal to
 * the whole hub — same defence the buddy feed / staff roster lists use.
 */
const coachDirectorySchema = z.object({
  coaches: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): CoachCardData[] => {
      const parsed = coachCardSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

const certificationSchema = z.object({
  title: z.string(),
  issuer: z.string(),
  year: z.number().nullable(),
});
export type CoachCertification = z.infer<typeof certificationSchema>;

const coachDetailSchema = coachCardSchema.extend({
  bio: z.string(),
  certifications: z.array(certificationSchema),
  achievements: z.array(z.string()),
  replyWindowHours: z.number(),
  capacity: z.number(),
});
export type CoachDetail = z.infer<typeof coachDetailSchema>;

const coachDetailEnvelope = z.object({ coach: coachDetailSchema });

const assignedCoachSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  headline: z.string(),
  avatarUrl: z.string().nullable(),
});
export type AssignedCoach = z.infer<typeof assignedCoachSchema>;

const pendingRequestSchema = z.object({
  id: z.string(),
  coachId: z.string(),
  coachName: z.string(),
  status: z.literal('pending'),
  createdAt: z.string(),
});
export type PendingCoachRequest = z.infer<typeof pendingRequestSchema>;

const myCoachSchema = z.object({
  coach: assignedCoachSchema.nullable(),
  request: pendingRequestSchema.nullable(),
});
export type MyCoachState = z.infer<typeof myCoachSchema>;

const createdRequestSchema = z.object({
  request: z.object({
    id: z.string(),
    coachId: z.string(),
    status: z.string(),
    createdAt: z.string(),
  }),
});
export type CreatedCoachRequest = z.infer<typeof createdRequestSchema>['request'];

const requestRowSchema = z.object({
  id: z.string(),
  coachId: z.string(),
  coachName: z.string(),
  status: z.string(),
  message: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type CoachRequestRow = z.infer<typeof requestRowSchema>;

/** Resilient list — drop unparseable rows rather than blanking the history. */
const requestListSchema = z.object({
  requests: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): CoachRequestRow[] => {
      const parsed = requestRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

const milestoneSchema = z.object({
  id: z.string(),
  title: z.string(),
  note: z.string().nullable(),
  achievedAt: z.string(),
  coachName: z.string(),
});
export type CoachMilestone = z.infer<typeof milestoneSchema>;

/** Resilient list — one bad row must not hide every milestone. */
const milestoneListSchema = z.object({
  milestones: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): CoachMilestone[] => {
      const parsed = milestoneSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

const okSchema = z.object({ ok: z.literal(true) });
const errorBodySchema = z.object({ error: z.string() });

// ── Fetch plumbing (same shape as lib/api/client.ts) ──────────

/** Every call gives up after this long — a hung connection must not freeze screens. */
const REQUEST_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** {error:'…'} bodies that carry MORE meaning than their HTTP status. */
function bodyErrorCode(raw: string): MentorshipErrorCode | null {
  return raw === 'already_pending' ||
    raw === 'already_assigned' ||
    raw === 'not_accepting' ||
    raw === 'not_found' ||
    raw === 'invalid'
    ? raw
    : null;
}

function statusToCode(status: number): MentorshipErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 400) return 'invalid';
  return 'network';
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  token: string;
  body?: Record<string, unknown>;
}

/** Perform the request; resolve with the parsed JSON of a 2xx response. */
async function mentorshipRequest(opts: RequestOptions): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE_URL}${opts.path}`, {
      method: opts.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${opts.token}`,
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : null),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new MentorshipApiError('network', "Can't reach the server");
  }

  if (res.ok) {
    try {
      return (await res.json()) as unknown;
    } catch {
      throw new MentorshipApiError('network', 'Unexpected server response');
    }
  }

  // A recognised {error:'…'} body beats the bare status.
  let code = statusToCode(res.status);
  try {
    const parsed = errorBodySchema.safeParse(await res.json());
    if (parsed.success) code = bodyErrorCode(parsed.data.error) ?? code;
  } catch {
    // Body wasn't JSON — keep the status-derived code.
  }
  throw new MentorshipApiError(code);
}

/** Validate a payload; a malformed body is indistinguishable from a bad server. */
function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new MentorshipApiError('network', 'Unexpected server response');
  return parsed.data;
}

// ── Endpoints (see MENTORSHIP API CONTRACT) ───────────────────

/** GET /api/coaches → the browsable coach directory. */
export async function getCoachDirectory(token: string): Promise<CoachCardData[]> {
  const data = await mentorshipRequest({ method: 'GET', path: '/api/coaches', token });
  return parse(coachDirectorySchema, data).coaches;
}

/** GET /api/coaches/[id] → one coach's full profile. 'not_found' for a bad id. */
export async function getCoachDetail(id: string, token: string): Promise<CoachDetail> {
  const data = await mentorshipRequest({
    method: 'GET',
    path: `/api/coaches/${encodeURIComponent(id)}`,
    token,
  });
  return parse(coachDetailEnvelope, data).coach;
}

/**
 * GET /api/me/coach → the caller's assigned coach AND/OR their one pending
 * request (each null when absent). The single source of truth for every
 * member coach surface (home entry, chat unlock, profile CTA).
 */
export async function getMyCoach(token: string): Promise<MyCoachState> {
  const data = await mentorshipRequest({ method: 'GET', path: '/api/me/coach', token });
  return parse(myCoachSchema, data);
}

/**
 * POST /api/coach-requests {coachId, message?} → ask a coach to take you on.
 * Typed failures: 'already_pending' | 'already_assigned' | 'not_accepting'
 * | 'not_found'.
 */
export async function createCoachRequest(
  coachId: string,
  message: string | undefined,
  token: string,
): Promise<CreatedCoachRequest> {
  const data = await mentorshipRequest({
    method: 'POST',
    path: '/api/coach-requests',
    token,
    body: message !== undefined ? { coachId, message } : { coachId },
  });
  return parse(createdRequestSchema, data).request;
}

/** GET /api/coach-requests → the caller's request history (all statuses). */
export async function listCoachRequests(token: string): Promise<CoachRequestRow[]> {
  const data = await mentorshipRequest({ method: 'GET', path: '/api/coach-requests', token });
  return parse(requestListSchema, data).requests;
}

/** DELETE /api/coach-requests/[id] → withdraw a pending request. */
export async function cancelCoachRequest(id: string, token: string): Promise<void> {
  const data = await mentorshipRequest({
    method: 'DELETE',
    path: `/api/coach-requests/${encodeURIComponent(id)}`,
    token,
  });
  parse(okSchema, data);
}

/** GET /api/me/milestones → milestones the member's coach logged for them. */
export async function getMyMilestones(token: string): Promise<CoachMilestone[]> {
  const data = await mentorshipRequest({ method: 'GET', path: '/api/me/milestones', token });
  return parse(milestoneListSchema, data).milestones;
}
