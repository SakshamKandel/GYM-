import { z } from 'zod';
import { STAFF_ROLES, isPermission, type Permission, type StaffRole } from '@gym/shared';
import { BASE_URL, fetchWithTimeout } from '../../lib/api/client';

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
 *   'confirm_required' → 409 {error:'confirm_required', preview} (payment
 *                    approval would shorten a permanent tier or downgrade a
 *                    higher active one — re-POST decidePaymentRequest with
 *                    confirm:true to proceed)
 *   'already_refunded' → 409 {error:'already_refunded'} (refund raced/retried
 *                    against an already-refunded request)
 *   'not_approved' → 409 {error:'not_approved'} (refund attempted on a request
 *                    that was never approved, or already rejected)
 *   'insufficient_balance' → 409 {error:'insufficient_balance', balanceMinor,
 *                    currency} (a wallet payout would drive the coach's
 *                    tracked balance negative — resend with override:true to
 *                    record it anyway)
 *   'conflict'     → 409 (state conflicts etc.)
 *   'not_configured' → 503 (e.g. the video host keys are absent)
 *   'rate_limited' → 429 (too many requests — distinct from a bare network
 *                    failure so the UI can show "slow down" copy)
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
  | 'confirm_required'
  | 'already_refunded'
  | 'not_approved'
  | 'insufficient_balance'
  | 'conflict'
  | 'already_pending'
  | 'not_an_upgrade'
  | 'not_configured'
  | 'rate_limited'
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
// Coach seniority badge (SCALE-UP-PLAN §1.4) — NOT a billing tier. Never
// includes 'starter'; every coach profile carries one of these three.
export type CoachTier = 'silver' | 'gold' | 'elite';
// Paid tiers a payment request / catalog can target — 'starter' is free and
// never appears in a purchase flow.
export type PayTier = 'silver' | 'gold' | 'elite';
export type ApplicationStatus = 'pending' | 'approved' | 'rejected';
export type TierRequestStatus = 'pending' | 'approved' | 'rejected';
export type PaymentMethod = 'esewa' | 'khalti' | 'bank' | 'other';
export type PaymentStatus = 'pending' | 'approved' | 'rejected' | 'refunded';
export type DecideAction = 'approve' | 'reject';

const staffRoleSchema = z.enum(STAFF_ROLES);
const tierSchema = z.enum(['starter', 'silver', 'gold', 'elite']);
const coachTierSchema = z.enum(['silver', 'gold', 'elite']);
const payTierSchema = z.enum(['silver', 'gold', 'elite']);
const memberStatusSchema = z.enum(['active', 'suspended']);
const videoStatusSchema = z.enum(['processing', 'ready', 'removed']);
const assignmentStatusSchema = z.enum(['active', 'ended']);
const applicationStatusSchema = z.enum(['pending', 'approved', 'rejected']);
const tierRequestStatusSchema = z.enum(['pending', 'approved', 'rejected']);
const paymentMethodSchema = z.enum(['esewa', 'khalti', 'bank', 'other']);
const paymentStatusSchema = z.enum(['pending', 'approved', 'rejected', 'refunded']);

// ── Fetch plumbing ────────────────────────────────────────────

interface StaffRequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  token: string;
  body?: Record<string, unknown>;
  /** Override for endpoints that legitimately run longer than the default
   * (e.g. a server-side host round trip). */
  timeoutMs?: number;
}

/** Every admin/coach mutation gives up after this long (defect H1: staffRequest
 * used to be a bare `fetch` with no bound, so a hung connection could freeze
 * any console screen forever). */
const STAFF_REQUEST_TIMEOUT_MS = 15_000;

function statusToCode(status: number): StaffErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 400) return 'invalid';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
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
  already_pending: 'already_pending',
  not_an_upgrade: 'not_an_upgrade',
  confirm_required: 'confirm_required',
  already_refunded: 'already_refunded',
  not_approved: 'not_approved',
  insufficient_balance: 'insufficient_balance',
};

/** Perform the request; resolve with the parsed JSON (or null) of a 2xx body. */
async function staffRequest(opts: StaffRequestOptions): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${BASE_URL}${opts.path}`,
      {
        method: opts.method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${opts.token}`,
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : null),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      },
      opts.timeoutMs ?? STAFF_REQUEST_TIMEOUT_MS,
    );
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

/**
 * `permissions` is additive (RBAC contract §4.3) — an older server that omits
 * it, or any unrecognised string it does send, must not blank the whole
 * response. Unknown array shape → [] via `.catch`; unrecognised entries are
 * filtered out (never trust a permission string the client doesn't know).
 */
const meStaffSchema = z.object({
  role: staffRoleSchema.nullable(),
  permissions: z
    .array(z.unknown())
    .transform((arr): Permission[] => arr.filter(isPermission)),
});

export type StaffIdentity = z.infer<typeof meStaffSchema>;

/**
 * GET /api/me/staff → the caller's staff role (or null for a non-staff
 * account) PLUS the exact permission set the server derived for that role
 * (contract §4.3 — clients gate on permissions, never role names). 401 (no
 * token) surfaces as StaffApiError 'unauthorized'; a valid non-staff token
 * resolves to `{ role: null, permissions: [] }` (NOT an error).
 */
export async function getMeStaff(token: string): Promise<StaffIdentity> {
  const data = await staffRequest({ method: 'GET', path: '/api/me/staff', token });
  return parse(meStaffSchema, data);
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
 * (oldest → newest). Read-only (F2) — marking the thread read is a separate
 * call, see markCoachThreadRead.
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

/**
 * POST /api/coach/threads/[userId]/read (no body) → marks every inbound
 * message on this thread readByCoach=true, clearing the client's
 * `unreadForCoach` badge in the coach roster (F2: mark-read was split out of
 * GET into its own POST so a GET-CSRF can't silently clear the work queue).
 * Callers should invoke this after successfully loading a thread;
 * best-effort — a failure here shouldn't block the thread from displaying.
 */
export async function markCoachThreadRead(userId: string, token: string): Promise<void> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/coach/threads/${encodeURIComponent(userId)}/read`,
    token,
  });
  parse(okSchema, data);
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
  // Seniority badge + public photo (promo-economy work). `.catch` defaults
  // keep an older server response from nuking the whole profile parse.
  coachTier: coachTierSchema.catch('silver'),
  avatarUrl: z.string().nullable().catch(null),
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
  /** A Cloudinary https URL string (max 500 chars) from POST
   * /api/uploads/image (kind 'coach_avatar')'s `deliveryUrl`, or null to
   * remove the current photo. */
  avatarUrl?: string | null;
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
// Coach console — client-assigned workouts (SCALE-UP-PLAN §4.3)
// ════════════════════════════════════════════════════════════════

// Shared by both the assigned-workout and diet-plan rows — 'archived' hides
// the row from the client's Train/Food tab while keeping it in the console.
const planStatusSchema = z.enum(['active', 'archived']);
export type PlanStatus = z.infer<typeof planStatusSchema>;

const assignedWorkoutItemSchema = z.object({
  // null for a free-text/custom entry with no local-library match.
  exerciseId: z.string().nullable(),
  name: z.string(),
  sets: z.number(),
  repRange: z.string(),
  restSec: z.number(),
  note: z.string().optional(),
  imageUrl: z.string().optional(),
});
export type AssignedWorkoutItem = z.infer<typeof assignedWorkoutItemSchema>;

const clientWorkoutSchema = z.object({
  id: z.string(),
  title: z.string(),
  notes: z.string().catch(''),
  position: z.number(),
  status: planStatusSchema,
  items: z.array(assignedWorkoutItemSchema).catch([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ClientWorkout = z.infer<typeof clientWorkoutSchema>;

/** Resilient: drop unparseable rows rather than blanking the whole list. */
const clientWorkoutsSchema = z.object({
  workouts: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): ClientWorkout[] => {
      const parsed = clientWorkoutSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/**
 * GET /api/coach/clients/[userId]/workouts → every workout the caller has
 * assigned this client (active AND archived), position asc. 'forbidden' when
 * the caller has no active assignment over the client.
 */
export async function getClientWorkouts(
  userId: string,
  token: string,
): Promise<ClientWorkout[]> {
  const data = await staffRequest({
    method: 'GET',
    path: `/api/coach/clients/${encodeURIComponent(userId)}/workouts`,
    token,
  });
  return parse(clientWorkoutsSchema, data).workouts;
}

export interface WorkoutItemInput {
  /** 1..60 chars, or null for a free-text entry. */
  exerciseId: string | null;
  /** 1..80 chars. */
  name: string;
  /** 1..10. */
  sets: number;
  /** e.g. '5' or '8-12'. */
  repRange: string;
  /** 15..600. */
  restSec: number;
  /** ≤200 chars. */
  note?: string;
  /** https URL, ≤500 chars — from a library exercise's stock photo, or from
   * POST /api/uploads/image {kind:'custom_exercise'}'s `deliveryUrl`. */
  imageUrl?: string;
}

export interface WorkoutInput {
  /** 1..120 chars. */
  title: string;
  /** ≤1000 chars. */
  notes?: string;
  /** ≤15 entries. */
  items: WorkoutItemInput[];
}

const clientWorkoutEnvelope = z.object({ workout: clientWorkoutSchema });

/**
 * POST /api/coach/clients/[userId]/workouts → assigns a new workout to one of
 * the caller's OWN clients; returns the fresh row. The client gets a
 * best-effort push.
 */
export async function createClientWorkout(
  userId: string,
  input: WorkoutInput,
  token: string,
): Promise<ClientWorkout> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/coach/clients/${encodeURIComponent(userId)}/workouts`,
    token,
    body: {
      title: input.title,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      items: input.items,
    },
  });
  return parse(clientWorkoutEnvelope, data).workout;
}

export interface WorkoutPatch {
  title?: string;
  notes?: string;
  status?: PlanStatus;
  /** Ordering among this client's workouts — lower shows first. */
  position?: number;
  items?: WorkoutItemInput[];
}

/**
 * PATCH /api/coach/workouts/[id] → partial update; only the sent fields
 * change. 'forbidden' when the row's client isn't currently assigned to the
 * caller (ownership comes from the ROW, not the request).
 */
export async function updateClientWorkout(
  id: string,
  patch: WorkoutPatch,
  token: string,
): Promise<ClientWorkout> {
  const data = await staffRequest({
    method: 'PATCH',
    path: `/api/coach/workouts/${encodeURIComponent(id)}`,
    token,
    body: { ...patch },
  });
  return parse(clientWorkoutEnvelope, data).workout;
}

/** DELETE /api/coach/workouts/[id] → hard-removes the row. */
export async function deleteClientWorkout(id: string, token: string): Promise<void> {
  const data = await staffRequest({
    method: 'DELETE',
    path: `/api/coach/workouts/${encodeURIComponent(id)}`,
    token,
  });
  parse(okSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Coach console — client diet plans (SCALE-UP-PLAN §4.3)
// ════════════════════════════════════════════════════════════════

const mealKindSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snacks']);
export type MealKind = z.infer<typeof mealKindSchema>;
export const MEAL_KINDS: MealKind[] = ['breakfast', 'lunch', 'dinner', 'snacks'];

const dietPlanItemSchema = z.object({
  name: z.string(),
  qty: z.string(),
  kcal: z.number().optional(),
  protein: z.number().optional(),
  carbs: z.number().optional(),
  fat: z.number().optional(),
  note: z.string().optional(),
});
export type DietPlanItem = z.infer<typeof dietPlanItemSchema>;

const dietPlanMealSchema = z.object({
  meal: mealKindSchema,
  items: z.array(dietPlanItemSchema).catch([]),
});
export type DietPlanMeal = z.infer<typeof dietPlanMealSchema>;

const clientDietPlanSchema = z.object({
  id: z.string(),
  title: z.string(),
  notes: z.string().catch(''),
  status: planStatusSchema,
  meals: z.array(dietPlanMealSchema).catch([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ClientDietPlan = z.infer<typeof clientDietPlanSchema>;

/** Resilient: drop unparseable rows rather than blanking the whole list. */
const clientDietPlansSchema = z.object({
  plans: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): ClientDietPlan[] => {
      const parsed = clientDietPlanSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/**
 * GET /api/coach/clients/[userId]/diet-plans → every diet plan the caller has
 * assigned this client (active AND archived), newest first. 'forbidden' when
 * the caller has no active assignment over the client.
 */
export async function getClientDietPlans(
  userId: string,
  token: string,
): Promise<ClientDietPlan[]> {
  const data = await staffRequest({
    method: 'GET',
    path: `/api/coach/clients/${encodeURIComponent(userId)}/diet-plans`,
    token,
  });
  return parse(clientDietPlansSchema, data).plans;
}

export interface DietPlanMealInput {
  meal: MealKind;
  /** ≤12 entries. */
  items: DietPlanItem[];
}

export interface DietPlanInput {
  /** 1..120 chars. */
  title: string;
  /** ≤1000 chars. */
  notes?: string;
  /** ≤6 entries. */
  meals: DietPlanMealInput[];
}

const clientDietPlanEnvelope = z.object({ plan: clientDietPlanSchema });

/**
 * POST /api/coach/clients/[userId]/diet-plans → assigns a new diet plan to
 * one of the caller's OWN clients; returns the fresh row. The client gets a
 * best-effort push.
 */
export async function createClientDietPlan(
  userId: string,
  input: DietPlanInput,
  token: string,
): Promise<ClientDietPlan> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/coach/clients/${encodeURIComponent(userId)}/diet-plans`,
    token,
    body: {
      title: input.title,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      meals: input.meals,
    },
  });
  return parse(clientDietPlanEnvelope, data).plan;
}

export interface DietPlanPatch {
  title?: string;
  notes?: string;
  status?: PlanStatus;
  meals?: DietPlanMealInput[];
}

/**
 * PATCH /api/coach/diet-plans/[id] → partial update; only the sent fields
 * change. 'forbidden' when the row's client isn't currently assigned to the
 * caller (ownership comes from the ROW, not the request).
 */
export async function updateClientDietPlan(
  id: string,
  patch: DietPlanPatch,
  token: string,
): Promise<ClientDietPlan> {
  const data = await staffRequest({
    method: 'PATCH',
    path: `/api/coach/diet-plans/${encodeURIComponent(id)}`,
    token,
    body: { ...patch },
  });
  return parse(clientDietPlanEnvelope, data).plan;
}

/** DELETE /api/coach/diet-plans/[id] → hard-removes the row. */
export async function deleteClientDietPlan(id: string, token: string): Promise<void> {
  const data = await staffRequest({
    method: 'DELETE',
    path: `/api/coach/diet-plans/${encodeURIComponent(id)}`,
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
  // ISO instant or null (permanent / no paid tier). Additive per contract
  // §4.7 — lets the directory show a 'lapsed' badge instead of displaying a
  // past-expiry paid tier as if it were still active. `.catch(null)` keeps an
  // older server that omits the field from nuking the whole row.
  tierExpiresAt: z.string().nullable().catch(null),
  status: memberStatusSchema,
  // The account's staff role, or null for a plain member. `.catch(null)` keeps
  // older/partial server responses from nuking the whole directory parse.
  staffRole: staffRoleSchema.nullable().catch(null),
});
export type MemberRow = z.infer<typeof memberRowSchema>;

/** Resilient: drop unparseable rows rather than blanking the whole directory. */
const membersSchema = z.object({
  members: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): MemberRow[] => {
      const parsed = memberRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
  // Additive keyset cursor (contract §4.7) — null on the last page. `.catch`
  // keeps an older server that omits it from nuking the whole page parse.
  nextCursor: z.string().nullable().catch(null),
});

export interface MembersPage {
  members: MemberRow[];
  nextCursor: string | null;
}

/**
 * GET /api/admin/members?q=&cursor= → a keyset page of the member directory.
 * `q` is a case-insensitive email substring filter; pass a previous page's
 * `nextCursor` to continue ("Load more") — null means there is no next page.
 */
export async function getMembers(
  token: string,
  q?: string,
  cursor?: string,
): Promise<MembersPage> {
  const params = new URLSearchParams();
  if (q?.trim()) params.set('q', q.trim());
  if (cursor?.trim()) params.set('cursor', cursor.trim());
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await staffRequest({
    method: 'GET',
    path: `/api/admin/members${query}`,
    token,
  });
  return parse(membersSchema, data);
}

const memberDetailAccountSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  tier: tierSchema,
  // ISO instant or null — see memberRowSchema's tierExpiresAt (contract §4.7).
  tierExpiresAt: z.string().nullable().catch(null),
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

/** Resilient: drop unparseable rows rather than blanking the whole roster. */
const coachesSchema = z.object({
  coaches: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): CoachRow[] => {
      const parsed = coachRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

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

/** Resilient: drop unparseable rows rather than blanking the whole library. */
const videosSchema = z.object({
  videos: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): VideoRow[] => {
      const parsed = videoRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

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

// ════════════════════════════════════════════════════════════════
// Coach console — wallet (promo commission + code)
// ════════════════════════════════════════════════════════════════

const walletBalanceSchema = z.object({ currency: z.string(), amountMinor: z.number() });
export type WalletBalance = z.infer<typeof walletBalanceSchema>;

const walletEntrySchema = z.object({
  id: z.string(),
  type: z.enum(['commission', 'adjustment', 'payout']),
  amountMinor: z.number(),
  currency: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type WalletEntry = z.infer<typeof walletEntrySchema>;

const walletCodeSchema = z.object({
  code: z.string(),
  discountPct: z.number(),
  commissionPct: z.number(),
  redemptionCount: z.number(),
});
export type WalletCode = z.infer<typeof walletCodeSchema>;

/** Resilient: an entry row this build can't parse is dropped, not fatal. */
const coachWalletSchema = z.object({
  balances: z.array(walletBalanceSchema).catch([]),
  code: walletCodeSchema.nullable(),
  entries: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): WalletEntry[] => {
      const parsed = walletEntrySchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});
export interface CoachWallet {
  balances: WalletBalance[];
  code: WalletCode | null;
  entries: WalletEntry[];
}

/**
 * GET /api/coach/wallet → the caller's own commission balances (per currency),
 * their auto-generated promo code + redemption count, and the 50 newest
 * ledger entries. `code` is null only for a coach whose code hasn't been
 * generated yet (shouldn't happen post-approval, but tolerated defensively).
 */
export async function getCoachWallet(token: string): Promise<CoachWallet> {
  const data = await staffRequest({ method: 'GET', path: '/api/coach/wallet', token });
  return parse(coachWalletSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Coach console — tier upgrade requests
// ════════════════════════════════════════════════════════════════

/** A coach may only ever request UP from their current badge — never silver. */
export type RequestableCoachTier = 'gold' | 'elite';

const coachTierRequestSchema = z.object({
  id: z.string(),
  requestedTier: coachTierSchema,
  note: z.string().catch(''),
  status: tierRequestStatusSchema,
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type CoachTierRequest = z.infer<typeof coachTierRequestSchema>;

/** Resilient: drop unparseable rows rather than blanking the whole history. */
const coachTierRequestsSchema = z.object({
  requests: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): CoachTierRequest[] => {
      const parsed = coachTierRequestSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/**
 * GET /api/coach/tier-requests → the caller's own upgrade-request history,
 * newest first.
 */
export async function getCoachTierRequests(token: string): Promise<CoachTierRequest[]> {
  const data = await staffRequest({ method: 'GET', path: '/api/coach/tier-requests', token });
  return parse(coachTierRequestsSchema, data).requests;
}

const tierRequestCreateSchema = z.object({ id: z.string() });

/**
 * POST /api/coach/tier-requests {requestedTier, note?} → file a new seniority
 * upgrade request (silver→gold/elite; gold→elite). 'already_pending' (409)
 * when the caller already has one pending; 'not_an_upgrade' (400) when the
 * requested tier is at or below the coach's current badge.
 */
export async function createCoachTierRequest(
  requestedTier: RequestableCoachTier,
  note: string | undefined,
  token: string,
): Promise<string> {
  const data = await staffRequest({
    method: 'POST',
    path: '/api/coach/tier-requests',
    token,
    body: { requestedTier, ...(note !== undefined ? { note } : {}) },
  });
  return parse(tierRequestCreateSchema, data).id;
}

// ════════════════════════════════════════════════════════════════
// Admin console — coach applications
// ════════════════════════════════════════════════════════════════

const applicationAccountSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string(),
});

const coachApplicationRowSchema = z.object({
  id: z.string(),
  account: applicationAccountSchema,
  displayName: z.string(),
  headline: z.string().catch(''),
  bio: z.string().catch(''),
  yearsExperience: z.number().catch(0),
  specialties: z.array(z.string()).catch([]),
  certifications: z.array(coachCertificationSchema).catch([]),
  achievements: z.array(z.string()).catch([]),
  avatarUrl: z.string().nullable().catch(null),
  status: applicationStatusSchema,
  reviewNote: z.string().nullable(),
  createdAt: z.string(),
});
export type CoachApplicationRow = z.infer<typeof coachApplicationRowSchema>;

/** Resilient: drop unparseable rows rather than blanking the whole queue. */
const coachApplicationsSchema = z.object({
  applications: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): CoachApplicationRow[] => {
      const parsed = coachApplicationRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/**
 * GET /api/admin/coach-applications?status= → the application queue, newest
 * first. Omitting `status` does NOT return every status — the server
 * defaults to 'pending' (same trap as the tier-request queue below); pass an
 * explicit `status` to see decided rows.
 */
export async function getAdminCoachApplications(
  token: string,
  status?: ApplicationStatus,
): Promise<CoachApplicationRow[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const data = await staffRequest({
    method: 'GET',
    path: `/api/admin/coach-applications${query}`,
    token,
  });
  return parse(coachApplicationsSchema, data).applications;
}

/**
 * POST /api/admin/coach-applications/[id] {action, coachTier?, reviewNote?} →
 * approve (grants coach role, upserts coach_profiles, generates the promo
 * code — coachTier defaults to 'silver' server-side when omitted) or reject
 * (records reviewNote). 'not_found' for an unknown/already-decided id.
 */
export async function decideCoachApplication(
  id: string,
  action: DecideAction,
  options: { coachTier?: CoachTier; reviewNote?: string } | undefined,
  token: string,
): Promise<void> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/admin/coach-applications/${encodeURIComponent(id)}`,
    token,
    body: {
      action,
      ...(options?.coachTier !== undefined ? { coachTier: options.coachTier } : {}),
      ...(options?.reviewNote !== undefined ? { reviewNote: options.reviewNote } : {}),
    },
  });
  parse(okSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Admin console — coach tier-upgrade requests
// ════════════════════════════════════════════════════════════════

const tierRequestCoachSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  coachTier: coachTierSchema,
});

const adminCoachTierRequestSchema = z.object({
  id: z.string(),
  coach: tierRequestCoachSchema,
  requestedTier: coachTierSchema,
  note: z.string().catch(''),
  status: tierRequestStatusSchema,
  createdAt: z.string(),
});
export type AdminCoachTierRequest = z.infer<typeof adminCoachTierRequestSchema>;

/** Resilient: drop unparseable rows rather than blanking the whole queue. */
const adminCoachTierRequestsSchema = z.object({
  requests: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): AdminCoachTierRequest[] => {
      const parsed = adminCoachTierRequestSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/**
 * GET /api/admin/coach-tier-requests?status= → the upgrade-request queue.
 * Omitting `status` defaults to 'pending' server-side (same trap as the coach
 * applications queue above) — pass an explicit `status` for decided rows.
 */
export async function getAdminCoachTierRequests(
  token: string,
  status?: TierRequestStatus,
): Promise<AdminCoachTierRequest[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const data = await staffRequest({
    method: 'GET',
    path: `/api/admin/coach-tier-requests${query}`,
    token,
  });
  return parse(adminCoachTierRequestsSchema, data).requests;
}

/**
 * POST /api/admin/coach-tier-requests/[id] {action, note?} → approve (writes
 * coach_profiles.coachTier) or reject. 'not_found' for an unknown/already-
 * decided id.
 */
export async function decideCoachTierRequest(
  id: string,
  action: DecideAction,
  note: string | undefined,
  token: string,
): Promise<void> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/admin/coach-tier-requests/${encodeURIComponent(id)}`,
    token,
    body: { action, ...(note !== undefined ? { note } : {}) },
  });
  parse(okSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Admin console — promo codes
// ════════════════════════════════════════════════════════════════

const promoOwnerCoachSchema = z.object({ id: z.string(), displayName: z.string() });

const promoCodeRowSchema = z.object({
  id: z.string(),
  code: z.string(),
  ownerCoach: promoOwnerCoachSchema.nullable(),
  discountPct: z.number(),
  commissionPct: z.number(),
  active: z.boolean(),
  redemptionCount: z.number(),
  maxRedemptions: z.number().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});
export type PromoCodeRow = z.infer<typeof promoCodeRowSchema>;

/** Resilient: drop unparseable rows rather than blanking the whole list. */
const promoCodesSchema = z.object({
  codes: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): PromoCodeRow[] => {
      const parsed = promoCodeRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/** GET /api/admin/promo-codes → every code with its redemption stats. */
export async function getAdminPromoCodes(token: string): Promise<PromoCodeRow[]> {
  const data = await staffRequest({ method: 'GET', path: '/api/admin/promo-codes', token });
  return parse(promoCodesSchema, data).codes;
}

export interface PromoCodeCreateInput {
  /** Omit to let the server auto-generate one (COACH-style pattern). */
  code?: string;
  /** Attach the code to a coach (their commission wallet). Omit for a house code. */
  ownerCoachId?: string;
  /** 5..90. */
  discountPct: number;
  /** 0..50. */
  commissionPct?: number;
  maxRedemptions?: number;
  /** ISO instant. */
  expiresAt?: string;
}

const promoCodeCreateSchema = z.object({ id: z.string(), code: z.string() });

/**
 * POST /api/admin/promo-codes → mint a house or coach code. 'conflict' (409)
 * on a duplicate explicit `code`; 'invalid' (400) for an out-of-range pct.
 */
export async function createPromoCode(
  input: PromoCodeCreateInput,
  token: string,
): Promise<{ id: string; code: string }> {
  const data = await staffRequest({
    method: 'POST',
    path: '/api/admin/promo-codes',
    token,
    body: {
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.ownerCoachId !== undefined ? { ownerCoachId: input.ownerCoachId } : {}),
      discountPct: input.discountPct,
      ...(input.commissionPct !== undefined ? { commissionPct: input.commissionPct } : {}),
      ...(input.maxRedemptions !== undefined ? { maxRedemptions: input.maxRedemptions } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    },
  });
  return parse(promoCodeCreateSchema, data);
}

export interface PromoCodePatch {
  active?: boolean;
  maxRedemptions?: number | null;
  expiresAt?: string | null;
}

/** PATCH /api/admin/promo-codes/[id] → toggle active / adjust limits. */
export async function updatePromoCode(
  id: string,
  patch: PromoCodePatch,
  token: string,
): Promise<void> {
  const data = await staffRequest({
    method: 'PATCH',
    path: `/api/admin/promo-codes/${encodeURIComponent(id)}`,
    token,
    body: { ...patch },
  });
  // The route returns {code:{...}} (the updated row), never {ok:true}.
  parse(z.object({ code: promoCodeRowSchema }), data);
}

// ════════════════════════════════════════════════════════════════
// Admin console — payment requests (Nepal manual payments)
// ════════════════════════════════════════════════════════════════

const paymentAccountSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  tier: tierSchema,
});

const paymentRequestRowSchema = z.object({
  id: z.string(),
  account: paymentAccountSchema,
  tier: payTierSchema,
  months: z.number(),
  amountMinor: z.number(),
  currency: z.string(),
  method: paymentMethodSchema,
  // A signed URL minted per-request — never cache/store beyond this screen's
  // lifetime (it expires; the row is refetched each visit).
  receiptUrl: z.string(),
  note: z.string().nullable(),
  status: paymentStatusSchema,
  reviewNote: z.string().nullable(),
  createdAt: z.string(),
  // B11 fraud signal: true when the request claims NP region without a
  // verified NP country/rail. Server computes this (route.ts:95) specifically
  // so a reviewer can spot someone self-reporting the cheaper NPR catalog —
  // must be declared here or zod silently strips it on parse.
  selfReportedRegion: z.boolean().catch(false),
});
export type PaymentRequestRow = z.infer<typeof paymentRequestRowSchema>;

/** Resilient: drop unparseable rows rather than blanking the whole queue. */
const paymentRequestsSchema = z.object({
  requests: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): PaymentRequestRow[] => {
      const parsed = paymentRequestRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/** GET /api/admin/payment-requests?status= → the manual-payment queue. */
export async function getAdminPaymentRequests(
  token: string,
  status?: PaymentStatus,
): Promise<PaymentRequestRow[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const data = await staffRequest({
    method: 'GET',
    path: `/api/admin/payment-requests${query}`,
    token,
  });
  return parse(paymentRequestsSchema, data).requests;
}

/**
 * POST /api/admin/payment-requests/[id] {action, note?, confirm?} → approve
 * grants the dated tier window + settles any promo commission; reject records
 * reviewNote. 'not_found' for an unknown/already-decided id.
 *
 * `confirm` must be passed true to complete an approval that would shorten a
 * permanent current tier or downgrade a higher active one (B1/P0-2) — the
 * server otherwise returns 409 'confirm_required' and applies nothing. Omit
 * (or pass false) on the first attempt; retry with confirm:true only after
 * that specific error (never pass it speculatively).
 */
export async function decidePaymentRequest(
  id: string,
  action: DecideAction,
  note: string | undefined,
  token: string,
  confirm?: boolean,
): Promise<void> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/admin/payment-requests/${encodeURIComponent(id)}`,
    token,
    body: { action, ...(note !== undefined ? { note } : {}), ...(confirm ? { confirm: true } : {}) },
  });
  parse(okSchema, data);
}

/**
 * POST /api/admin/payment-requests/[id]/refund {reason} → reverse a
 * previously-approved request (gap build P0-1): CAS approved→refunded, tier
 * rollback, negative wallet adjustment, promo redemption reversal, all
 * audited with `reason`. 'not_found' for an unknown/non-approved id (map this
 * to "already decided / not refundable" — mirrors the B13 404 remap, never
 * "try again").
 */
export async function refundPaymentRequest(
  id: string,
  reason: string,
  token: string,
): Promise<void> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/admin/payment-requests/${encodeURIComponent(id)}/refund`,
    token,
    body: { reason },
  });
  parse(okSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Admin console — coach wallets
// ════════════════════════════════════════════════════════════════

// Extends tierRequestCoachSchema with the offboarding-cascade flag (E10/C2):
// GET /api/admin/wallets includes coaches who no longer hold the coach role
// but still carry an outstanding ledger balance, flagged `revoked` so the UI
// can tell them apart from an active coach with the same balance shape.
const walletCoachSchema = tierRequestCoachSchema.extend({
  revoked: z.boolean().catch(false),
});

const adminWalletRowSchema = z.object({
  coach: walletCoachSchema,
  balances: z.array(walletBalanceSchema).catch([]),
});
export type AdminWalletRow = z.infer<typeof adminWalletRowSchema>;

/** Resilient: drop unparseable rows rather than blanking the whole page. */
const adminWalletsSchema = z.object({
  wallets: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): AdminWalletRow[] => {
      const parsed = adminWalletRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/** GET /api/admin/wallets → every coach's balances per currency. */
export async function getAdminWallets(token: string): Promise<AdminWalletRow[]> {
  const data = await staffRequest({ method: 'GET', path: '/api/admin/wallets', token });
  return parse(adminWalletsSchema, data).wallets;
}

export interface WalletEntryInput {
  type: 'adjustment' | 'payout';
  /** Payouts must be negative; adjustments may be either sign. */
  amountMinor: number;
  currency: string;
  note?: string;
  /** Escape hatch (E7): record a payout that exceeds the tracked balance (e.g.
   * reconciling a pre-app disbursement). Only meaningful for payouts; send it
   * only after a prior attempt returned 'insufficient_balance', never
   * speculatively. */
  override?: boolean;
}

/**
 * POST /api/admin/wallets/[coachId]/entries → append a manual ledger entry
 * (a positive correction, or a negative payout record — payouts are recorded
 * here, not disbursed; see SCALE-UP-PLAN §9). 'invalid' when a payout amount
 * isn't negative. 'insufficient_balance' when a payout would drive the
 * coach's balance in that currency negative and `override` wasn't set.
 */
export async function addWalletEntry(
  coachId: string,
  input: WalletEntryInput,
  token: string,
): Promise<void> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/admin/wallets/${encodeURIComponent(coachId)}/entries`,
    token,
    body: {
      type: input.type,
      amountMinor: input.amountMinor,
      currency: input.currency,
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.override ? { override: true } : {}),
    },
  });
  // The route returns 201 {entry:{...}}, never {ok:true}.
  parse(z.object({ entry: walletEntrySchema }), data);
}

const adminWalletDetailSchema = z.object({
  coach: tierRequestCoachSchema,
  balances: z.array(walletBalanceSchema).catch([]),
  // Resilient: drop unparseable rows rather than blanking the whole ledger.
  entries: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): WalletEntry[] => {
      const parsed = walletEntrySchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});
export type AdminWalletDetail = z.infer<typeof adminWalletDetailSchema>;

/**
 * GET /api/admin/wallets/[coachId] → one coach's per-currency balances plus
 * their newest ≤100 ledger entries (contract §4.8) — the per-coach detail the
 * global roster in getAdminWallets can't provide (E9: the old drawer read off
 * a global newest-500 feed and silently showed 'No entries yet' for an older
 * coach). Requires `wallet.manage`.
 */
export async function getAdminWalletDetail(
  coachId: string,
  token: string,
): Promise<AdminWalletDetail> {
  const data = await staffRequest({
    method: 'GET',
    path: `/api/admin/wallets/${encodeURIComponent(coachId)}`,
    token,
  });
  return parse(adminWalletDetailSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Admin console — regional pricing
// ════════════════════════════════════════════════════════════════

const priceRegionSchema = z.enum(['NP', 'INTL']);
export type PriceRegion = z.infer<typeof priceRegionSchema>;

const priceRowSchema = z.object({
  region: priceRegionSchema,
  tier: tierSchema,
  amountMinor: z.number(),
  currency: z.string(),
  active: z.boolean(),
});
export type PriceRow = z.infer<typeof priceRowSchema>;

/** Resilient: drop unparseable rows rather than blanking the whole grid. */
const pricesSchema = z.object({
  prices: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): PriceRow[] => {
      const parsed = priceRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/** GET /api/admin/pricing → every (region, tier) price row. */
export async function getAdminPricing(token: string): Promise<PriceRow[]> {
  const data = await staffRequest({ method: 'GET', path: '/api/admin/pricing', token });
  return parse(pricesSchema, data).prices;
}

export interface PricePatch {
  region: PriceRegion;
  tier: Tier;
  /** New price in minor units; currency is derived server-side from region. */
  amountMinor: number;
}

/**
 * PUT /api/admin/pricing {prices} → upsert one or more (region, tier) rows.
 * Currency is derived server-side (NP→NPR, INTL→USD) — never sent from here.
 */
export async function putAdminPricing(prices: PricePatch[], token: string): Promise<PriceRow[]> {
  const data = await staffRequest({
    method: 'PUT',
    path: '/api/admin/pricing',
    token,
    body: { prices },
  });
  return parse(pricesSchema, data).prices;
}

// ════════════════════════════════════════════════════════════════
// Admin console — coach overrides (isActive / coachTier / capacity)
// ════════════════════════════════════════════════════════════════

export interface AdminCoachPatch {
  isActive?: boolean;
  coachTier?: CoachTier;
  capacity?: number;
}

/**
 * PATCH /api/admin/coaches/[id] {isActive?, coachTier?, capacity?} → override
 * fields the coach can't otherwise change (or admin-only edits). Requires
 * `coach.application.review`. 'not_found' for an unknown coach id.
 */
export async function updateAdminCoach(
  id: string,
  patch: AdminCoachPatch,
  token: string,
): Promise<void> {
  const data = await staffRequest({
    method: 'PATCH',
    path: `/api/admin/coaches/${encodeURIComponent(id)}`,
    token,
    body: { ...patch },
  });
  parse(okSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Admin console — broadcast / announcements (gap build P0-4)
// ════════════════════════════════════════════════════════════════

export interface BroadcastInput {
  /** 1..120 chars. */
  title: string;
  /** 1..500 chars. */
  body: string;
  /** Restrict the fan-out to accounts at this billing tier. */
  tier?: Tier;
  /** Restrict the fan-out to accounts with this ISO-3166 alpha-2 country. */
  country?: string;
}

// Server response is `{ ok: true, recipients, devices, delivered, failed }`
// (apps/web/src/app/api/admin/broadcast/route.ts) — the field is `recipients`,
// not `recipientCount`. Keep this in sync with that route's response shape.
const broadcastResultSchema = z.object({ ok: z.literal(true), recipients: z.number() });

/**
 * POST /api/admin/broadcast {title, body, tier?, country?} → fan out a push
 * announcement over registered device tokens (super_admin + main_admin only,
 * gated `broadcast.send`). Returns the recipient count for the confirmation
 * UI; the server audits the send with that same count.
 */
export async function sendBroadcast(input: BroadcastInput, token: string): Promise<number> {
  const data = await staffRequest({
    method: 'POST',
    path: '/api/admin/broadcast',
    token,
    body: {
      title: input.title,
      body: input.body,
      ...(input.tier !== undefined ? { tier: input.tier } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
    },
  });
  return parse(broadcastResultSchema, data).recipients;
}
