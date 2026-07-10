import { z } from 'zod';
import { STAFF_ROLES, type StaffRole } from '@gym/shared';
import { BASE_URL } from '../../lib/api/client';

/**
 * Staff console API client — coach + admin surfaces of the GM Method backend.
 *
 * Every staff/coach/admin web route accepts the mobile `Authorization: Bearer`
 * token (requireStaff / requirePermission read it), so these are plain bearer
 * calls against the SAME host as lib/api/client.ts. Same philosophy as the rest
 * of the app: zod at the boundary, typed error codes, and NOTHING throws a raw
 * error — every failure surfaces as a `StaffApiError` code so screens branch on
 * `.code` instead of string-matching server messages.
 *
 *  Error codes:
 *   'unauthorized' → 401 (no/expired session token)
 *   'forbidden'    → 403 (signed in, but lacks the role/permission, or a coach
 *                    with no active assignment over the target user)
 *   'insufficient_rank' → 403 {error:'insufficient_rank'} (the caller's role
 *                    does not outrank the target role — staff grant/change/
 *                    revoke, or suspending a protected staff account)
 *   'not_found'    → 404 (missing member / assignment / video / profile)
 *   'invalid'      → 400 (validation rejected the request body)
 *   'cannot_target_self' → 400 (grant/change aimed at the caller's OWN row)
 *   'cannot_revoke_self' → 400 (self-lockout guard on revoke)
 *   'full'         → 409 {error:'full'} (accepting a mentorship request would
 *                    exceed the coach's roster capacity)
 *   'conflict'     → 409 (state conflicts etc.)
 *   'not_configured' → 503 (e.g. the video host keys are absent)
 *   'network'      → offline, non-JSON, or a malformed/unexpected response
 */

// ── Error type ────────────────────────────────────────────────

export type StaffErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'insufficient_rank'
  | 'not_found'
  | 'invalid'
  | 'cannot_target_self'
  | 'cannot_revoke_self'
  | 'full'
  | 'conflict'
  | 'not_configured'
  | 'network';

export class StaffApiError extends Error {
  readonly code: StaffErrorCode;

  constructor(code: StaffErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'StaffApiError';
    this.code = code;
  }
}

/** Narrow an unknown thrown value to StaffApiError (anything else = network). */
export function toStaffError(err: unknown): StaffApiError {
  return err instanceof StaffApiError ? err : new StaffApiError('network');
}

// ── Shared enums ──────────────────────────────────────────────

// The 7-role hierarchy (incl. main_admin) lives in @gym/shared — the single
// source of truth also used by the web API guards. Re-exported so existing
// `import { type StaffRole } from features/staff/api` call sites keep working.
export type { StaffRole };

export type Tier = 'starter' | 'silver' | 'gold' | 'elite';
export type MemberStatus = 'active' | 'suspended';
export type VideoStatus = 'processing' | 'ready' | 'removed';
export type AssignmentStatus = 'active' | 'ended';

const staffRoleSchema = z.enum(STAFF_ROLES);
const tierSchema = z.enum(['starter', 'silver', 'gold', 'elite']);
const memberStatusSchema = z.enum(['active', 'suspended']);
const videoStatusSchema = z.enum(['processing', 'ready', 'removed']);
const assignmentStatusSchema = z.enum(['active', 'ended']);

// ── Fetch plumbing ────────────────────────────────────────────

interface StaffRequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  token: string;
  body?: Record<string, unknown>;
}

function statusToCode(status: number): StaffErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 400) return 'invalid';
  if (status === 409) return 'conflict';
  if (status === 503) return 'not_configured';
  return 'network';
}

/**
 * Server error bodies ({error:'…'}) that carry MORE meaning than their HTTP
 * status — the rank/self guards on the staff + member routes. Anything not in
 * this map falls back to the status-derived code.
 */
const BODY_ERROR_CODES: Partial<Record<string, StaffErrorCode>> = {
  insufficient_rank: 'insufficient_rank',
  cannot_target_self: 'cannot_target_self',
  cannot_revoke_self: 'cannot_revoke_self',
  full: 'full',
};

/** Perform the request; resolve with the parsed JSON (or null) of a 2xx body. */
async function staffRequest(opts: StaffRequestOptions): Promise<unknown> {
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
    });
  } catch {
    throw new StaffApiError('network', "Can't reach the server");
  }

  if (res.ok) {
    // Some 2xx routes (rare) may carry no JSON body — tolerate that as null.
    try {
      return (await res.json()) as unknown;
    } catch {
      return null;
    }
  }

  // A recognised {error:'…'} body (rank/self guards) beats the bare status.
  let bodyCode: StaffErrorCode | undefined;
  try {
    const body = (await res.json()) as unknown;
    if (body && typeof body === 'object') {
      const err = (body as { error?: unknown }).error;
      if (typeof err === 'string') bodyCode = BODY_ERROR_CODES[err];
    }
  } catch {
    // Non-JSON error body — the status code is all we have.
  }

  throw new StaffApiError(bodyCode ?? statusToCode(res.status));
}

/** Validate a payload; a malformed body is indistinguishable from a bad server. */
function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new StaffApiError('network', 'Unexpected server response');
  return parsed.data;
}

// ════════════════════════════════════════════════════════════════
// Whoami
// ════════════════════════════════════════════════════════════════

const meStaffSchema = z.object({ role: staffRoleSchema.nullable() });

/**
 * GET /api/me/staff → the caller's staff role, or null for a non-staff account.
 * 401 (no token) surfaces as StaffApiError 'unauthorized'; a valid non-staff
 * token resolves to `null` (NOT an error).
 */
export async function getMeStaff(token: string): Promise<StaffRole | null> {
  const data = await staffRequest({ method: 'GET', path: '/api/me/staff', token });
  return parse(meStaffSchema, data).role;
}

// ════════════════════════════════════════════════════════════════
// Coach console
// ════════════════════════════════════════════════════════════════

const coachInboxRowSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  tier: tierSchema,
  unreadForCoach: z.number(),
});
export type CoachInboxRow = z.infer<typeof coachInboxRowSchema>;

const coachInboxSchema = z.object({ users: z.array(coachInboxRowSchema) });

/** GET /api/coach/users → the caller's active client roster with unread badges. */
export async function getCoachInbox(token: string): Promise<CoachInboxRow[]> {
  const data = await staffRequest({ method: 'GET', path: '/api/coach/users', token });
  return parse(coachInboxSchema, data).users;
}

const coachThreadMessageSchema = z.object({
  id: z.string(),
  kind: z.string(),
  sender: z.enum(['user', 'coach']),
  body: z.string(),
  senderAccountId: z.string().nullable(),
  readByUser: z.boolean(),
  readByCoach: z.boolean(),
  createdAt: z.string(),
});
export type CoachThreadMessage = z.infer<typeof coachThreadMessageSchema>;

/** Resilient: drop unparseable rows rather than blanking the whole thread. */
const coachThreadSchema = z.object({
  messages: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): CoachThreadMessage[] => {
      const parsed = coachThreadMessageSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/**
 * GET /api/coach/threads/[userId] → that client's coach_chat thread
 * (oldest → newest). Server-side this also marks inbound rows read by coach.
 * 'forbidden' when the caller has no active assignment over the user.
 */
export async function getCoachThread(
  userId: string,
  token: string,
): Promise<CoachThreadMessage[]> {
  const data = await staffRequest({
    method: 'GET',
    path: `/api/coach/threads/${encodeURIComponent(userId)}`,
    token,
  });
  return parse(coachThreadSchema, data).messages;
}

const coachReplySchema = z.object({ message: coachThreadMessageSchema });

/**
 * POST /api/coach/threads/[userId]/reply {body} → inserts the human coach's
 * reply and returns the inserted row. 'invalid' for an empty/too-long body,
 * 'forbidden' with no active assignment.
 */
export async function replyToClient(
  userId: string,
  body: string,
  token: string,
): Promise<CoachThreadMessage> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/coach/threads/${encodeURIComponent(userId)}/reply`,
    token,
    body: { body },
  });
  return parse(coachReplySchema, data).message;
}

// One portfolio certification row: {title ≤80, issuer ≤80, year number|null}.
const coachCertificationSchema = z.object({
  title: z.string(),
  issuer: z.string(),
  year: z.number().nullable(),
});
export type CoachCertification = z.infer<typeof coachCertificationSchema>;

const coachProfileSchema = z.object({
  accountId: z.string(),
  displayName: z.string().nullable(),
  bio: z.string().nullable(),
  acceptingClients: z.boolean(),
  replyWindowHours: z.number(),
  isActive: z.boolean(),
  // ── Portfolio fields (mentorship work). `.catch` defaults keep an older
  // server that doesn't return them yet from nuking the whole profile parse.
  headline: z.string().nullable().catch(null),
  specialties: z.array(z.string()).catch([]),
  certifications: z.array(coachCertificationSchema).catch([]),
  achievements: z.array(z.string()).catch([]),
  yearsExperience: z.number().catch(0),
  capacity: z.number().catch(1),
});
export type CoachProfile = z.infer<typeof coachProfileSchema>;

const coachProfileEnvelope = z.object({ profile: coachProfileSchema });

/** GET /api/coach/profile → the signed-in coach's own profile (lazy-created). */
export async function getCoachProfile(token: string): Promise<CoachProfile> {
  const data = await staffRequest({ method: 'GET', path: '/api/coach/profile', token });
  return parse(coachProfileEnvelope, data).profile;
}

export interface CoachProfilePatch {
  displayName?: string;
  bio?: string;
  acceptingClients?: boolean;
  replyWindowHours?: number;
  /** ≤120 chars. */
  headline?: string;
  /** ≤6 entries, each from COACH_SPECIALTIES in @gym/shared. */
  specialties?: string[];
  /** ≤10 rows; title/issuer ≤80 chars each, year numeric or null. */
  certifications?: CoachCertification[];
  /** ≤10 entries, each ≤120 chars. */
  achievements?: string[];
  /** 0..60. */
  yearsExperience?: number;
  /** 1..200 — the roster cap enforced when accepting requests. */
  capacity?: number;
}

/** PATCH /api/coach/profile → update the caller's own profile; returns it fresh. */
export async function updateCoachProfile(
  patch: CoachProfilePatch,
  token: string,
): Promise<CoachProfile> {
  const data = await staffRequest({
    method: 'PATCH',
    path: '/api/coach/profile',
    token,
    body: { ...patch },
  });
  return parse(coachProfileEnvelope, data).profile;
}

// ════════════════════════════════════════════════════════════════
// Coach console — mentorship requests + roster
// ════════════════════════════════════════════════════════════════

const coachRequestSchema = z.object({
  id: z.string(),
  userId: z.string(),
  displayName: z.string(),
  tier: tierSchema,
  message: z.string().catch(''),
  createdAt: z.string(),
});
export type CoachRequest = z.infer<typeof coachRequestSchema>;

/** Resilient: drop unparseable rows rather than blanking the whole queue. */
const coachRequestsSchema = z.object({
  requests: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): CoachRequest[] => {
      const parsed = coachRequestSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/** GET /api/coach/requests → pending mentorship requests, oldest first. */
export async function getCoachRequests(token: string): Promise<CoachRequest[]> {
  const data = await staffRequest({ method: 'GET', path: '/api/coach/requests', token });
  return parse(coachRequestsSchema, data).requests;
}

export type CoachRequestAction = 'accept' | 'decline';

/**
 * POST /api/coach/requests/[id] {action:'accept'|'decline'} → resolve one
 * pending request. 'full' (409 {error:'full'}) when accepting would exceed the
 * coach's roster capacity; 'not_found' when the request is gone.
 */
export async function decideCoachRequest(
  id: string,
  action: CoachRequestAction,
  token: string,
): Promise<void> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/coach/requests/${encodeURIComponent(id)}`,
    token,
    body: { action },
  });
  parse(okSchema, data);
}

/**
 * DELETE /api/coach/users/[userId] → end the caller's OWN coaching assignment
 * over that client (the client keeps their logs; the thread closes for the
 * coach). 'forbidden' when the client isn't actively assigned to the caller.
 */
export async function endCoaching(userId: string, token: string): Promise<void> {
  const data = await staffRequest({
    method: 'DELETE',
    path: `/api/coach/users/${encodeURIComponent(userId)}`,
    token,
  });
  parse(okSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Coach console — client milestones
// ════════════════════════════════════════════════════════════════

const clientMilestoneSchema = z.object({
  id: z.string(),
  title: z.string(),
  note: z.string().nullable().catch(null),
  achievedAt: z.string(),
  createdAt: z.string(),
});
export type ClientMilestone = z.infer<typeof clientMilestoneSchema>;

/** Resilient: drop unparseable rows rather than blanking the whole list. */
const clientMilestonesSchema = z.object({
  milestones: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): ClientMilestone[] => {
      const parsed = clientMilestoneSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/**
 * GET /api/coach/clients/[userId]/milestones → that client's coach-logged
 * milestones. 'forbidden' when the caller has no active assignment.
 */
export async function getClientMilestones(
  userId: string,
  token: string,
): Promise<ClientMilestone[]> {
  const data = await staffRequest({
    method: 'GET',
    path: `/api/coach/clients/${encodeURIComponent(userId)}/milestones`,
    token,
  });
  return parse(clientMilestonesSchema, data).milestones;
}

const clientMilestoneEnvelope = z.object({ milestone: clientMilestoneSchema });

export interface MilestoneInput {
  /** 1..120 chars. */
  title: string;
  /** ≤500 chars. */
  note?: string;
  /** 'YYYY-MM-DD'; the server defaults to today when omitted. */
  achievedAt?: string;
}

/**
 * POST /api/coach/clients/[userId]/milestones {title, note?, achievedAt?} →
 * log a milestone for one of the caller's OWN clients; returns the fresh row.
 */
export async function addClientMilestone(
  userId: string,
  input: MilestoneInput,
  token: string,
): Promise<ClientMilestone> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/coach/clients/${encodeURIComponent(userId)}/milestones`,
    token,
    body: {
      title: input.title,
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.achievedAt !== undefined ? { achievedAt: input.achievedAt } : {}),
    },
  });
  return parse(clientMilestoneEnvelope, data).milestone;
}

/** DELETE /api/coach/milestones/[id] → remove a milestone the caller logged. */
export async function deleteMilestone(id: string, token: string): Promise<void> {
  const data = await staffRequest({
    method: 'DELETE',
    path: `/api/coach/milestones/${encodeURIComponent(id)}`,
    token,
  });
  parse(okSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Coach console — videos (read model)
// ════════════════════════════════════════════════════════════════

// One row of the coach video library. Same shape the web coach console reads:
// the admin row PLUS a playback `views` count and the attached exercise
// (id + name, or null for a standalone / plan-level clip).
const coachVideoRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  tierRequired: tierSchema,
  status: videoStatusSchema,
  position: z.number(),
  thumbnailUrl: z.string().nullable(),
  views: z.number().catch(0),
  exercise: z
    .object({ id: z.string(), name: z.string().nullable() })
    .nullable()
    .catch(null),
  createdAt: z.string(),
});
export type CoachVideoRow = z.infer<typeof coachVideoRowSchema>;

/**
 * Resilient list: a row this build can't parse is dropped, not fatal to the
 * whole library — same defence the audit/staff/thread lists use. Newest first
 * (server-ordered); removed rows are included so the coach sees history.
 */
const coachVideosSchema = z.object({
  videos: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): CoachVideoRow[] => {
      const parsed = coachVideoRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/**
 * GET /api/coach/videos → the plan-video library with view counts + attached
 * exercise (content.video.publish-gated, which coach holds). ADD / RETIER /
 * REMOVE reuse the admin video routes (createVideo / updateVideo / deleteVideo)
 * — those are gated on the same permission, so a coach may call them too.
 */
export async function getCoachVideos(token: string): Promise<CoachVideoRow[]> {
  const data = await staffRequest({ method: 'GET', path: '/api/coach/videos', token });
  return parse(coachVideosSchema, data).videos;
}

// ════════════════════════════════════════════════════════════════
// Coach console — subscriptions (set/extend an OWN client's tier + window)
// ════════════════════════════════════════════════════════════════

/**
 * A dated-subscription window. Mirrors apps/web lib/tier.ts `TierDates`:
 *   - a field ABSENT (undefined)     → leave that column untouched
 *   - a field set to `null`          → clear it (expiresAt null = permanent)
 *   - a field set to an ISO string   → set it (a PAST expiresAt lapses now)
 * We keep ISO strings here (the wire format) rather than Dates; the server
 * coerces them.
 */
export interface SetTierDates {
  startsAt?: string | null;
  expiresAt?: string | null;
}

/** Copy only the date fields that were explicitly provided into the body. */
function dateBody(dates: SetTierDates | undefined): Record<string, string | null> {
  const body: Record<string, string | null> = {};
  if (dates) {
    if ('startsAt' in dates) body.startsAt = dates.startsAt ?? null;
    if ('expiresAt' in dates) body.expiresAt = dates.expiresAt ?? null;
  }
  return body;
}

/**
 * POST /api/coach/subscriptions {userId, tier, reason?, startsAt?, expiresAt?}
 * → set/extend the tier of one of the coach's OWN active clients. Same
 * semantics as the admin route (dated window + Greece auto-assign + audit),
 * but ownership-scoped: 'forbidden' when the client isn't actively assigned to
 * the caller (super_admin / main_admin bypass ownership). 'not_found' for an
 * unknown account.
 */
export async function setCoachTier(
  userId: string,
  tier: Tier,
  reason: string | undefined,
  dates: SetTierDates | undefined,
  token: string,
): Promise<SetTierResult> {
  const data = await staffRequest({
    method: 'POST',
    path: '/api/coach/subscriptions',
    token,
    body: {
      userId,
      tier,
      ...(reason !== undefined ? { reason } : {}),
      ...dateBody(dates),
    },
  });
  return parse(setTierSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Admin console — overview
// ════════════════════════════════════════════════════════════════

const tierBreakdownSchema = z.object({ tier: tierSchema, count: z.number() });

const recentSignupSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  tier: tierSchema,
  status: memberStatusSchema,
  createdAt: z.string(),
});
export type RecentSignup = z.infer<typeof recentSignupSchema>;

const recentActivitySchema = z.object({
  id: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  actorEmail: z.string().nullable(),
  createdAt: z.string(),
});
export type RecentActivity = z.infer<typeof recentActivitySchema>;

const adminOverviewSchema = z.object({
  totalMembers: z.number(),
  activeCoaches: z.number(),
  activeAssignments: z.number(),
  readyVideos: z.number(),
  tierBreakdown: z.array(tierBreakdownSchema),
  recentSignups: z.array(recentSignupSchema),
  recentActivity: z.array(recentActivitySchema),
});
export type AdminOverview = z.infer<typeof adminOverviewSchema>;

/** GET /api/admin/overview → the console dashboard summary. */
export async function getAdminOverview(token: string): Promise<AdminOverview> {
  const data = await staffRequest({ method: 'GET', path: '/api/admin/overview', token });
  return parse(adminOverviewSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Admin console — members
// ════════════════════════════════════════════════════════════════

const memberRowSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  tier: tierSchema,
  status: memberStatusSchema,
  // The account's staff role, or null for a plain member. `.catch(null)` keeps
  // older/partial server responses from nuking the whole directory parse.
  staffRole: staffRoleSchema.nullable().catch(null),
});
export type MemberRow = z.infer<typeof memberRowSchema>;

const membersSchema = z.object({ members: z.array(memberRowSchema) });

/**
 * GET /api/admin/members?q= → the member directory (<=100 rows). `q` is a
 * case-insensitive email substring filter.
 */
export async function getMembers(token: string, q?: string): Promise<MemberRow[]> {
  const query = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  const data = await staffRequest({
    method: 'GET',
    path: `/api/admin/members${query}`,
    token,
  });
  return parse(membersSchema, data).members;
}

const memberDetailAccountSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  tier: tierSchema,
  status: memberStatusSchema,
  createdAt: z.string(),
  // Present on GET detail; the PATCH echo may omit it — tolerate as null.
  staffRole: staffRoleSchema.nullable().catch(null),
});

const memberDetailCoachSchema = z.object({
  assignmentId: z.string(),
  coachId: z.string(),
  email: z.string(),
  displayName: z.string(),
});
export type MemberDetailCoach = z.infer<typeof memberDetailCoachSchema>;

const memberDetailSchema = z.object({
  member: memberDetailAccountSchema,
  // The server profile blob is an opaque jsonb (or null).
  profile: z.record(z.string(), z.unknown()).nullable(),
  coach: memberDetailCoachSchema.nullable(),
});
export type MemberDetail = z.infer<typeof memberDetailSchema>;

/** GET /api/admin/members/[id] → a single member, their profile blob + coach. */
export async function getMemberDetail(id: string, token: string): Promise<MemberDetail> {
  const data = await staffRequest({
    method: 'GET',
    path: `/api/admin/members/${encodeURIComponent(id)}`,
    token,
  });
  return parse(memberDetailSchema, data);
}

const memberUpdateSchema = z.object({ member: memberDetailAccountSchema });

/**
 * PATCH /api/admin/members/[id] → apply { status?, tier? } (+ optional reason).
 * `tier` needs subscription.override, `status` needs members.suspend — checked
 * independently server-side. Returns the fresh account row.
 */
export async function updateMember(
  id: string,
  patch: { status?: MemberStatus; tier?: Tier; reason?: string },
  token: string,
): Promise<z.infer<typeof memberDetailAccountSchema>> {
  const data = await staffRequest({
    method: 'PATCH',
    path: `/api/admin/members/${encodeURIComponent(id)}`,
    token,
    body: { ...patch },
  });
  return parse(memberUpdateSchema, data).member;
}
export type MemberAccount = z.infer<typeof memberDetailAccountSchema>;

// ════════════════════════════════════════════════════════════════
// Admin console — coaches & assignments
// ════════════════════════════════════════════════════════════════

const coachRowSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  coachName: z.string().nullable(),
  acceptingClients: z.boolean().nullable(),
  isActive: z.boolean().nullable(),
  activeClients: z.number(),
});
export type CoachRow = z.infer<typeof coachRowSchema>;

const coachesSchema = z.object({ coaches: z.array(coachRowSchema) });

/** GET /api/admin/coaches → the assignable coach pool with active-client counts. */
export async function getCoaches(token: string): Promise<CoachRow[]> {
  const data = await staffRequest({ method: 'GET', path: '/api/admin/coaches', token });
  return parse(coachesSchema, data).coaches;
}

const assignmentSchema = z.object({
  id: z.string(),
  coachId: z.string(),
  userId: z.string(),
  status: assignmentStatusSchema,
  assignedBy: z.string().nullable(),
  createdAt: z.string(),
});
export type Assignment = z.infer<typeof assignmentSchema>;

const assignmentEnvelope = z.object({ assignment: assignmentSchema });

/**
 * POST /api/admin/assignments {coachId, userId} → assign a coach to a member
 * (upsert reactivates an ended pair). Returns the assignment row.
 * 'invalid' when coachId isn't a coach; 'not_found' when userId is unknown.
 */
export async function assignClient(
  coachId: string,
  userId: string,
  token: string,
): Promise<Assignment> {
  const data = await staffRequest({
    method: 'POST',
    path: '/api/admin/assignments',
    token,
    body: { coachId, userId },
  });
  return parse(assignmentEnvelope, data).assignment;
}

const endedAssignmentSchema = z.object({
  assignment: z.object({
    id: z.string(),
    coachId: z.string(),
    userId: z.string(),
    status: assignmentStatusSchema,
  }),
});
export type EndedAssignment = z.infer<typeof endedAssignmentSchema>['assignment'];

/**
 * DELETE /api/admin/assignments/[id] → soft-end (status='ended') an assignment.
 * 'not_found' for an unknown id.
 */
export async function endAssignment(id: string, token: string): Promise<EndedAssignment> {
  const data = await staffRequest({
    method: 'DELETE',
    path: `/api/admin/assignments/${encodeURIComponent(id)}`,
    token,
  });
  return parse(endedAssignmentSchema, data).assignment;
}

// ════════════════════════════════════════════════════════════════
// Admin console — videos
// ════════════════════════════════════════════════════════════════

const videoRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  tierRequired: tierSchema,
  status: videoStatusSchema,
  position: z.number(),
  thumbnailUrl: z.string().nullable(),
  // Playback count — added to /api/admin/videos alongside the coach-videos
  // work. `.catch(0)` keeps an older server that omits the field from nuking
  // the whole row parse.
  views: z.number().catch(0),
  createdAt: z.string(),
});
export type VideoRow = z.infer<typeof videoRowSchema>;

const videosSchema = z.object({ videos: z.array(videoRowSchema) });

/** GET /api/admin/videos → the plan-video library (newest first). */
export async function getVideos(token: string): Promise<VideoRow[]> {
  const data = await staffRequest({ method: 'GET', path: '/api/admin/videos', token });
  return parse(videosSchema, data).videos;
}

// The single-row PATCH returns the fuller row (with description/exerciseId/…).
const videoDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  exerciseId: z.string().nullable(),
  planId: z.string().nullable(),
  tierRequired: tierSchema,
  status: videoStatusSchema,
  position: z.number(),
  thumbnailUrl: z.string().nullable(),
  durationSec: z.number().nullable(),
  createdAt: z.string(),
});
export type VideoDetail = z.infer<typeof videoDetailSchema>;

// POST returns the full row plus a provider-neutral upload descriptor: the
// endpoint the phone POSTs the file to, and — for hosts that use signed
// browser uploads (Cloudinary) — the signed form fields to attach alongside
// the `file` part. Omitted for self-contained one-time URLs (CF Stream).
const uploadDescriptorSchema = z.object({
  url: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
});

const videoCreateEnvelope = z.object({
  video: videoDetailSchema,
  upload: uploadDescriptorSchema,
});
export type VideoCreateResult = z.infer<typeof videoCreateEnvelope>;

export interface VideoCreateMeta {
  title: string;
  description?: string;
  exerciseId?: string;
  planId?: string;
  tierRequired: Tier;
}

/**
 * POST /api/admin/videos → reserve a direct-creator-upload slot on the video
 * host and insert the row in status='processing'. The caller then POSTs the
 * file bytes STRAIGHT to `upload.url` as multipart/form-data (every
 * `upload.fields` entry first, then the file under `file`) and confirms via
 * updateVideo(id, { status: 'ready' }). 'not_configured' (503) when the host
 * keys are absent — no row is created in that case.
 */
export async function createVideo(
  meta: VideoCreateMeta,
  token: string,
): Promise<VideoCreateResult> {
  const data = await staffRequest({
    method: 'POST',
    path: '/api/admin/videos',
    token,
    body: { ...meta },
  });
  return parse(videoCreateEnvelope, data);
}

const videoUpdateEnvelope = z.object({ video: videoDetailSchema });

export interface VideoPatch {
  title?: string;
  description?: string;
  tierRequired?: Tier;
  position?: number;
  status?: VideoStatus;
}

/** PATCH /api/admin/videos/[id] → edit fields / flip status; returns the row. */
export async function updateVideo(
  id: string,
  patch: VideoPatch,
  token: string,
): Promise<VideoDetail> {
  const data = await staffRequest({
    method: 'PATCH',
    path: `/api/admin/videos/${encodeURIComponent(id)}`,
    token,
    body: { ...patch },
  });
  return parse(videoUpdateEnvelope, data).video;
}

const videoDeleteEnvelope = z.object({
  video: z.object({ id: z.string(), status: videoStatusSchema }),
});
export type DeletedVideo = z.infer<typeof videoDeleteEnvelope>['video'];

/** DELETE /api/admin/videos/[id] → soft-delete (status='removed'). */
export async function deleteVideo(id: string, token: string): Promise<DeletedVideo> {
  const data = await staffRequest({
    method: 'DELETE',
    path: `/api/admin/videos/${encodeURIComponent(id)}`,
    token,
  });
  return parse(videoDeleteEnvelope, data).video;
}

// ════════════════════════════════════════════════════════════════
// Admin console — subscriptions (tier override)
// ════════════════════════════════════════════════════════════════

const setTierSchema = z.object({
  ok: z.literal(true),
  accountId: z.string(),
  tier: tierSchema,
});
export type SetTierResult = z.infer<typeof setTierSchema>;

/**
 * POST /api/admin/subscriptions {accountId, tier, reason?, startsAt?, expiresAt?}
 * → override a member's tier (audited). `dates` carries the optional dated
 * window (see SetTierDates: absent = leave, null = clear/permanent, ISO = set;
 * a past expiresAt lapses the tier immediately). 'not_found' for an unknown
 * account.
 */
export async function setTier(
  accountId: string,
  tier: Tier,
  reason: string | undefined,
  dates: SetTierDates | undefined,
  token: string,
): Promise<SetTierResult> {
  const data = await staffRequest({
    method: 'POST',
    path: '/api/admin/subscriptions',
    token,
    body: {
      accountId,
      tier,
      ...(reason !== undefined ? { reason } : {}),
      ...dateBody(dates),
    },
  });
  return parse(setTierSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Admin console — staff & roles
// ════════════════════════════════════════════════════════════════

const staffRowSchema = z.object({
  accountId: z.string(),
  email: z.string(),
  displayName: z.string(),
  status: memberStatusSchema,
  role: staffRoleSchema,
  coachName: z.string().nullable(),
  createdAt: z.string(),
});
export type StaffRow = z.infer<typeof staffRowSchema>;

/**
 * Resilient roster: a role value this build doesn't know yet must drop that
 * one row, not blank the whole Staff & Roles screen — an already-shipped
 * binary meeting its first unknown role taught us the strict-array version
 * of this parse fails everything at once.
 */
const staffSchema = z.object({
  staff: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): StaffRow[] => {
      const parsed = staffRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/** GET /api/admin/staff → every staff account with its role (super_admin + main_admin). */
export async function getStaff(token: string): Promise<StaffRow[]> {
  const data = await staffRequest({ method: 'GET', path: '/api/admin/staff', token });
  return parse(staffSchema, data).staff;
}

const okSchema = z.object({ ok: z.literal(true) });

/**
 * POST /api/admin/staff {accountId, role} → grant or change a role on an
 * existing account (super_admin + main_admin, rank-checked). 'not_found' for
 * an unknown account, 'invalid' for a bad role name, 'cannot_target_self'
 * when aimed at the caller's own row, 'insufficient_rank' when the caller
 * cannot manage the granted role OR the target's current role.
 */
export async function grantRole(
  accountId: string,
  role: StaffRole,
  token: string,
): Promise<void> {
  const data = await staffRequest({
    method: 'POST',
    path: '/api/admin/staff',
    token,
    body: { accountId, role },
  });
  parse(okSchema, data);
}

/**
 * DELETE /api/admin/staff/[accountId] → revoke all staff access + kill live
 * sessions (super_admin + main_admin, rank-checked). 'cannot_revoke_self'
 * when trying to revoke your OWN role, 'insufficient_rank' when the caller
 * does not outrank the target, 'not_found' when the account wasn't staff.
 */
export async function revokeRole(accountId: string, token: string): Promise<void> {
  const data = await staffRequest({
    method: 'DELETE',
    path: `/api/admin/staff/${encodeURIComponent(accountId)}`,
    token,
  });
  parse(okSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Admin console — audit log
// ════════════════════════════════════════════════════════════════

const auditEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  meta: z.unknown(),
  ip: z.string().nullable(),
  createdAt: z.string(),
  actorId: z.string().nullable(),
  actorEmail: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

/** Resilient: drop unparseable rows rather than failing the whole page. */
const auditSchema = z.object({
  entries: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): AuditEntry[] => {
      const parsed = auditEntrySchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
  nextCursor: z.string().nullable(),
});

export interface AuditFilters {
  action?: string;
  actor?: string;
  cursor?: string;
}

export interface AuditPage {
  entries: AuditEntry[];
  nextCursor: string | null;
}

/**
 * GET /api/admin/audit?action=&actor=&cursor= → a keyset page of the audit
 * trail, newest first (super_admin + main_admin). `nextCursor` is null on the last
 * page.
 */
export async function getAudit(
  token: string,
  filters: AuditFilters = {},
): Promise<AuditPage> {
  const params = new URLSearchParams();
  if (filters.action?.trim()) params.set('action', filters.action.trim());
  if (filters.actor?.trim()) params.set('actor', filters.actor.trim());
  if (filters.cursor?.trim()) params.set('cursor', filters.cursor.trim());
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await staffRequest({
    method: 'GET',
    path: `/api/admin/audit${query}`,
    token,
  });
  return parse(auditSchema, data);
}
