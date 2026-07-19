import * as FileSystem from 'expo-file-system/legacy';
import { z } from 'zod';
import {
  ORDER_STATUSES,
  STAFF_ROLES,
  isPermission,
  type OrderStatus,
  type Permission,
  type StaffRole,
} from '@gym/shared';
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
 *   'non_refundable' → 409 {error:'non_refundable'} (meal-payment refund only:
 *                    the target order is already in production/past cutoff,
 *                    or the cycle's billed week has already begun)
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
  | 'non_refundable'
  | 'insufficient_balance'
  | 'conflict'
  | 'already_pending'
  | 'not_an_upgrade'
  | 'account_deletion_blocked'
  | 'private_asset_cleanup_pending'
  | 'account_deletion_conflict'
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
  non_refundable: 'non_refundable',
  insufficient_balance: 'insufficient_balance',
  account_deletion_blocked: 'account_deletion_blocked',
  private_asset_cleanup_pending: 'private_asset_cleanup_pending',
  account_deletion_conflict: 'account_deletion_conflict',
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

/**
 * P0-2: the server response is NESTED and every top-level section is
 * PERMISSION-GATED (`apps/web/src/app/api/admin/overview/route.ts` — `{
 * membership?: {...}, recentActivity?: [...], ops: {...} }`). A role that
 * lacks `members.read` (most sub-roles — e.g. support_admin, content_admin)
 * gets a 200 with NO `membership` key at all, and one lacking `audit.read`
 * gets no `recentActivity`. The previous FLAT, all-required schema here threw
 * on every such response, so every admin-home load failed for every role
 * except one holding both permissions — the mobile admin console's home
 * screen was effectively dead. Every section below is optional/resilient to
 * match.
 */
const adminOverviewMembershipSchema = z.object({
  totalMembers: z.number(),
  activeCoaches: z.number(),
  activeAssignments: z.number(),
  readyVideos: z.number(),
  tierBreakdown: z.array(tierBreakdownSchema).catch([]),
  // Resilient: drop unparseable rows rather than failing the whole section.
  recentSignups: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): RecentSignup[] => {
      const parsed = recentSignupSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});
export type AdminOverviewMembership = z.infer<typeof adminOverviewMembershipSchema>;

const revenueByCurrencySchema = z.object({ currency: z.string(), amountMinor: z.number() });

/** Every ops tile is independently permission-gated server-side — each field
 * may simply be absent rather than zero, so callers must branch on
 * `undefined`, not treat a missing tile as "0". */
const adminOverviewOpsSchema = z
  .object({
    pendingApplications: z.number().optional(),
    pendingTierRequests: z.number().optional(),
    pendingPayments: z.number().optional(),
    pendingMealPayments: z.number().optional(),
    revenueThisMonth: z.array(revenueByCurrencySchema).catch([]).optional(),
    unreadSupport: z.number().optional(),
  })
  .catch({});
export type AdminOverviewOps = z.infer<typeof adminOverviewOpsSchema>;

const adminOverviewSchema = z.object({
  membership: adminOverviewMembershipSchema.optional(),
  recentActivity: z
    .array(z.unknown())
    .transform((arr) =>
      arr.flatMap((raw): RecentActivity[] => {
        const parsed = recentActivitySchema.safeParse(raw);
        return parsed.success ? [parsed.data] : [];
      }),
    )
    .optional(),
  ops: adminOverviewOpsSchema,
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
 * POST /api/admin/assignments {coachId, userId, force?} → assign a coach to a
 * member (upsert reactivates an ended pair). Returns the assignment row.
 * 'invalid' when coachId isn't a coach; 'not_found' when userId is unknown;
 * 'full' (409 {error:'full', activeClients, capacity}) when the coach is at
 * their roster capacity — pass `force: true` on a retry to knowingly assign
 * over the limit (never speculatively on the first attempt, mirroring the
 * wallet payout `override` escape hatch).
 */
export async function assignClient(
  coachId: string,
  userId: string,
  token: string,
  force?: boolean,
): Promise<Assignment> {
  const data = await staffRequest({
    method: 'POST',
    path: '/api/admin/assignments',
    token,
    body: { coachId, userId, ...(force ? { force: true } : {}) },
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
 * Offboarding-impact preview (P0-3) — shape mirrors the server's
 * `OffboardCounts` (apps/web/src/lib/coachOffboard.ts).
 */
export interface StaffOffboardCounts {
  activeClients: number;
  pendingRequests: number;
  pendingTierRequests: number;
  activeWorkoutPlans: number;
  activeDietPlans: number;
  walletBalances: { currency: string; amountMinor: number }[];
}

export interface RevokeDryRunResult {
  dryRun: true;
  targetRole: StaffRole;
  counts: StaffOffboardCounts | null;
}

const revokeDryRunSchema = z.object({
  dryRun: z.literal(true),
  targetRole: staffRoleSchema,
  counts: z
    .object({
      activeClients: z.number(),
      pendingRequests: z.number(),
      pendingTierRequests: z.number(),
      activeWorkoutPlans: z.number(),
      activeDietPlans: z.number(),
      walletBalances: z.array(z.object({ currency: z.string(), amountMinor: z.number() })),
    })
    .nullable(),
});

/**
 * DELETE /api/admin/staff/[accountId] → revoke all staff access + kill live
 * sessions (super_admin + main_admin, rank-checked). 'cannot_revoke_self'
 * when trying to revoke your OWN role, 'insufficient_rank' when the caller
 * does not outrank the target, 'not_found' when the account wasn't staff.
 *
 * Pass `{ dryRun: true }` for a READ-ONLY preflight (`?dryRun=1`) that
 * returns the offboarding blast radius WITHOUT mutating anything. The two
 * overloads keep the destructive and read-only paths from ever being
 * confused at a call site: only passing the literal `{ dryRun: true }`
 * option appends the query param the server requires to skip the mutation.
 */
export async function revokeRole(accountId: string, token: string): Promise<void>;
export async function revokeRole(
  accountId: string,
  token: string,
  options: { dryRun: true },
): Promise<RevokeDryRunResult>;
export async function revokeRole(
  accountId: string,
  token: string,
  options?: { dryRun?: boolean },
): Promise<void | RevokeDryRunResult> {
  const dryRun = options?.dryRun === true;
  const data = await staffRequest({
    method: 'DELETE',
    path: `/api/admin/staff/${encodeURIComponent(accountId)}${dryRun ? '?dryRun=1' : ''}`,
    token,
  });
  if (dryRun) return parse(revokeDryRunSchema, data);
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
// C-D (WP-4): GET /api/admin/payment-requests now returns
// `{ rows, counts: { pending } }` (pending unbounded ++ decided capped).
// Read `rows`, tolerating the legacy `requests` key so a lagging deploy on
// either side degrades gracefully instead of blanking the whole queue.
const paymentRequestsSchema = z
  .object({
    rows: z.array(z.unknown()).optional(),
    requests: z.array(z.unknown()).optional(),
    counts: z.object({ pending: z.number() }).partial().optional(),
  })
  .transform((data) => ({
    requests: (data.rows ?? data.requests ?? []).flatMap((raw): PaymentRequestRow[] => {
      const parsed = paymentRequestRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
    pendingCount: data.counts?.pending ?? null,
  }));

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

// ════════════════════════════════════════════════════════════════
// Admin console — member lifecycle (P1-7: reset link, sign-out, identity, GDPR)
// ════════════════════════════════════════════════════════════════

const resetLinkSchema = z.object({ resetUrl: z.string(), expiresAt: z.string() });
export type ResetLinkResult = z.infer<typeof resetLinkSchema>;

/**
 * POST /api/admin/members/[id]/credentials (no body) → mints a single-use,
 * 1-hour password-reset token and returns the full redemption LINK for the
 * admin to hand the member out of band (no email infra exists — nothing is
 * sent automatically; the caller's UI is responsible for surfacing/sharing
 * the link). Requires `members.manage_credentials`. 'insufficient_rank' when
 * the target is a staff account the caller doesn't outrank.
 */
export async function generateResetLink(
  accountId: string,
  token: string,
): Promise<ResetLinkResult> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/admin/members/${encodeURIComponent(accountId)}/credentials`,
    token,
  });
  return parse(resetLinkSchema, data);
}

/**
 * DELETE /api/admin/members/[id]/sessions → deletes every live session for
 * the account (force sign-out everywhere) WITHOUT suspending it. Requires
 * `members.manage_credentials`.
 */
export async function forceSignOutMember(accountId: string, token: string): Promise<void> {
  const data = await staffRequest({
    method: 'DELETE',
    path: `/api/admin/members/${encodeURIComponent(accountId)}/sessions`,
    token,
  });
  parse(okSchema, data);
}

// The identity-update route lives at .../credentials (shared with the
// reset-link POST above, PATCH is the identity verb there) and echoes back
// only {id,email,displayName} — NOT the full member row, so this gets its
// own minimal schema rather than reusing memberUpdateSchema.
const identityUpdateSchema = z.object({
  member: z.object({ id: z.string(), email: z.string(), displayName: z.string() }),
});

/**
 * PATCH /api/admin/members/[id]/credentials {email?, displayName?} → corrects
 * the account's login identity (email lowercased + uniqueness-checked
 * server-side; each changed field is audited old→new). 'conflict' when the
 * new email is already taken. Requires `members.manage_credentials`.
 */
export async function updateMemberIdentity(
  id: string,
  patch: { email?: string; displayName?: string },
  token: string,
): Promise<{ id: string; email: string; displayName: string }> {
  const data = await staffRequest({
    method: 'PATCH',
    path: `/api/admin/members/${encodeURIComponent(id)}/credentials`,
    token,
    body: { ...patch },
  });
  return parse(identityUpdateSchema, data).member;
}

/**
 * POST /api/admin/members/[id]/gdpr {confirm} → hard-deletes only an eligible
 * account. Active/offboarding/retention blockers return a typed conflict and
 * nothing is deleted. This endpoint does not claim to anonymize retained data.
 * The server requires `confirm` to exactly equal the account's current email.
 * The caller must pass the value the admin actually typed; do not refetch and
 * substitute a newer email, because that would bypass the human confirmation
 * when the member changes concurrently. `cannot_target_self` is returned when
 * aimed at the caller's own account (self-erasure only via DELETE /api/me).
 * Requires `members.manage_credentials`.
 */
export async function deleteMemberAccount(
  accountId: string,
  confirmationEmail: string,
  token: string,
): Promise<void> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/admin/members/${encodeURIComponent(accountId)}/gdpr`,
    token,
    body: { confirm: confirmationEmail },
  });
  parse(okSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Admin console — coach_requests oversight (P1-8)
// ════════════════════════════════════════════════════════════════

// Server shape: nested member/coach identity objects + ageDays (computed
// server-side). Adapted below to the FLAT shape
// apps/mobile/src/app/staff/admin/coaches.tsx's PendingRequestsOversight (the
// sole consumer) expects — one row = one pending coach_requests entry.
const oversightIdentitySchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
});
const coachRequestOversightRawSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'accepted', 'declined', 'canceled']),
  message: z.string().catch(''),
  createdAt: z.string(),
  member: oversightIdentitySchema,
  coach: oversightIdentitySchema,
  ageDays: z.number().catch(0),
});

export interface CoachRequestOversightRow {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  coachId: string;
  coachDisplayName: string;
  ageDays: number;
  createdAt: string;
}

/** Resilient: drop unparseable rows rather than blanking the whole queue. */
const coachRequestsOversightSchema = z.object({
  requests: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): CoachRequestOversightRow[] => {
      const parsed = coachRequestOversightRawSchema.safeParse(raw);
      if (!parsed.success) return [];
      const r = parsed.data;
      return [
        {
          id: r.id,
          userId: r.member.id,
          displayName: r.member.displayName.trim() || r.member.email,
          email: r.member.email,
          coachId: r.coach.id,
          coachDisplayName: r.coach.displayName.trim() || r.coach.email,
          ageDays: r.ageDays,
          createdAt: r.createdAt,
        },
      ];
    }),
  ),
});

/**
 * GET /api/admin/oversight/coach-requests?status=pending → pending mentorship
 * requests platform-wide, newest first. Every call server-side sweeps any
 * pending row older than 14 days to 'canceled' first (no cron exists), so a
 * row surviving in this list is still genuinely open. Requires
 * `moderation.manage`.
 */
export async function getCoachRequestsOversight(
  token: string,
): Promise<CoachRequestOversightRow[]> {
  const data = await staffRequest({
    method: 'GET',
    path: '/api/admin/oversight/coach-requests?status=pending',
    token,
  });
  return parse(coachRequestsOversightSchema, data).requests;
}

/**
 * POST /api/admin/oversight/coach-requests/[id] (no body) → force-cancels a
 * pending request, freeing the member to request a different coach.
 * 'not_found' for an unknown/already-decided id. Requires `moderation.manage`.
 */
export async function cancelCoachRequest(id: string, token: string): Promise<void> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/admin/oversight/coach-requests/${encodeURIComponent(id)}`,
    token,
  });
  parse(okSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Admin console — moderation queues (P1-9)
// ════════════════════════════════════════════════════════════════

// Matches apps/mobile/src/app/staff/admin/content.tsx's ModerationTabs (the
// sole consumer) exactly — plural/hyphenated tab keys, flat row shape. The
// SERVER exposes milestones and progress-photos as two differently-shaped
// resources (no unified /api/admin/moderation?kind= endpoint, and no
// custom-foods route at all yet) — adapted to one flat shape below.
export type ModerationItemType = 'milestones' | 'custom-foods' | 'progress-photos';

export interface ModerationItem {
  id: string;
  accountId: string;
  accountDisplayName: string;
  /** Milestone title / food name / photo caption — the item's headline. */
  title: string;
  /** Secondary line — milestone note / food brand-macros / photo date. */
  detail: string;
  /** Populated only for progress-photos. */
  imageUrl?: string | null;
  createdAt: string;
}

const milestoneModerationRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
  member: oversightIdentitySchema,
  coach: oversightIdentitySchema,
});
/** Resilient: drop unparseable rows rather than blanking the whole queue. */
const milestonesModerationSchema = z.object({
  milestones: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): ModerationItem[] => {
      const parsed = milestoneModerationRowSchema.safeParse(raw);
      if (!parsed.success) return [];
      const r = parsed.data;
      const coachLabel = r.coach.displayName.trim() || r.coach.email;
      return [
        {
          id: r.id,
          accountId: r.member.id,
          accountDisplayName: r.member.displayName.trim() || r.member.email,
          title: r.title,
          detail: r.note ? `${r.note} · by ${coachLabel}` : `by ${coachLabel}`,
          imageUrl: null,
          createdAt: r.createdAt,
        },
      ];
    }),
  ),
});

const photoModerationRowSchema = z.object({
  id: z.string(),
  takenOn: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
  account: oversightIdentitySchema,
  url: z.string(),
});
/** Resilient: drop unparseable rows rather than blanking the whole queue. */
const photosModerationSchema = z.object({
  photos: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): ModerationItem[] => {
      const parsed = photoModerationRowSchema.safeParse(raw);
      if (!parsed.success) return [];
      const r = parsed.data;
      return [
        {
          id: r.id,
          accountId: r.account.id,
          accountDisplayName: r.account.displayName.trim() || r.account.email,
          title: r.takenOn,
          detail: r.note ?? '',
          imageUrl: r.url,
          createdAt: r.createdAt,
        },
      ];
    }),
  ),
});

/**
 * GET the moderation queue for one tab, adapted to a flat `ModerationItem[]`:
 *   'milestones'      → GET /api/admin/moderation/milestones
 *   'progress-photos' → GET /api/admin/moderation/progress-photos
 *   'custom-foods'    → no server route exists yet — throws 'not_configured'
 *                        rather than silently returning an empty list (the
 *                        backend package deferred this sub-feature).
 * Requires `moderation.manage`.
 */
export async function getModerationQueue(
  kind: ModerationItemType,
  token: string,
): Promise<ModerationItem[]> {
  if (kind === 'custom-foods') {
    throw new StaffApiError('not_configured', 'Custom-food moderation is not available yet.');
  }
  if (kind === 'milestones') {
    const data = await staffRequest({
      method: 'GET',
      path: '/api/admin/moderation/milestones',
      token,
    });
    return parse(milestonesModerationSchema, data).milestones;
  }
  const data = await staffRequest({
    method: 'GET',
    path: '/api/admin/moderation/progress-photos',
    token,
  });
  return parse(photosModerationSchema, data).photos;
}

/**
 * DELETE /api/admin/moderation/[kind]/[id] → removes one item from the
 * member-visible surface (audit-logged, hard delete). 'not_found' for an
 * already-gone id. Requires `moderation.manage`. Throws 'not_configured' for
 * 'custom-foods' (no server route exists yet).
 */
export async function removeModerationItem(
  kind: ModerationItemType,
  id: string,
  token: string,
): Promise<void> {
  if (kind === 'custom-foods') {
    throw new StaffApiError('not_configured', 'Custom-food moderation is not available yet.');
  }
  const data = await staffRequest({
    method: 'DELETE',
    path: `/api/admin/moderation/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
    token,
  });
  parse(okSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Admin console — CSV exports (P1-10)
// ════════════════════════════════════════════════════════════════

export type CsvExportKind = 'members' | 'payment-requests' | 'wallet-ledger' | 'audit';

/** GET /api/admin/exports/[kind] gives up after this long — CSV generation
 * streams potentially thousands of rows, well past the usual 15s budget. */
const CSV_EXPORT_TIMEOUT_MS = 45_000;

/**
 * GET /api/admin/exports/[kind] → the server streams a CSV file directly
 * (Content-Type text/csv), potentially thousands of rows. This downloads it
 * straight to local disk with `FileSystem.downloadAsync` — the native layer
 * streams bytes to the file as they arrive, so the CSV body is NEVER
 * buffered into a single JS string (the previous `res.text()` approach
 * defeated the server's streaming design and risked an OOM/UI-freeze on
 * large exports; the resulting string, handed whole to `Share.share`, could
 * also blow past Android's ~1MB Binder transaction limit and crash the
 * app). Returns a local `file://` URI: a short, constant-size string that's
 * safe to pass to `Share.share({url})` or render directly, unlike the CSV
 * content itself. Embedding the bearer token in a URL isn't a concern here
 * — the header goes over the request, never into the resulting file path.
 * Gated server-side on the permission matching the underlying data
 * (members→members.read, payment-requests→payments.review,
 * wallet-ledger→wallet.manage, audit→audit.read).
 */
export async function exportCsvToFile(kind: CsvExportKind, token: string): Promise<string> {
  const fileUri = `${FileSystem.cacheDirectory}gym-export-${kind}-${Date.now()}.csv`;

  let result: FileSystem.FileSystemDownloadResult;
  try {
    result = await Promise.race([
      FileSystem.downloadAsync(`${BASE_URL}/api/admin/exports/${encodeURIComponent(kind)}`, fileUri, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), CSV_EXPORT_TIMEOUT_MS);
      }),
    ]);
  } catch {
    await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
    throw new StaffApiError('network', "Can't reach the server");
  }

  if (result.status < 200 || result.status >= 300) {
    let bodyCode: StaffErrorCode | undefined;
    try {
      const body = JSON.parse(await FileSystem.readAsStringAsync(result.uri)) as unknown;
      if (body && typeof body === 'object') {
        const err = (body as { error?: unknown }).error;
        if (typeof err === 'string') bodyCode = BODY_ERROR_CODES[err];
      }
    } catch {
      // Non-JSON error body — the status code is all we have.
    }
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
    throw new StaffApiError(bodyCode ?? statusToCode(result.status));
  }

  return result.uri;
}

// ════════════════════════════════════════════════════════════════
// Coach console — payout requests (P1-12/13)
// ════════════════════════════════════════════════════════════════

/**
 * Minimum withdrawal per currency (minor units) — mirrors the server-side
 * floor (NPR Rs 1,000 / USD $10); used here only for client-side UX hinting
 * (disable the submit button, show a hint). The server recomputes and
 * enforces this authoritatively regardless.
 */
export const MIN_PAYOUT_MINOR: Record<'NPR' | 'USD', number> = {
  NPR: 100_000,
  USD: 1_000,
};

/** `MIN_PAYOUT_MINOR[currency]` with a safe fallback for an unrecognised currency. */
export function payoutMinimumFor(currency: string): number {
  return MIN_PAYOUT_MINOR[currency as 'NPR' | 'USD'] ?? MIN_PAYOUT_MINOR.NPR;
}

export type PayoutStatus = 'pending' | 'approved' | 'rejected' | 'paid';
const payoutStatusSchema = z.enum(['pending', 'approved', 'rejected', 'paid']);

const myPayoutRequestSchema = z.object({
  id: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  status: payoutStatusSchema,
  note: z.string().nullable().catch(null),
  disbursementRef: z.string().nullable().catch(null),
  requestedAt: z.string(),
  decidedAt: z.string().nullable().catch(null),
});
export type MyPayoutRequest = z.infer<typeof myPayoutRequestSchema>;

/** Resilient: drop unparseable rows rather than blanking the whole history. */
const myPayoutStatusSchema = z.object({
  requests: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): MyPayoutRequest[] => {
      const parsed = myPayoutRequestSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/**
 * GET /api/coach/payouts → the caller's OWN payout-request history (newest
 * 50), newest first. At most one 'pending' row exists at a time (server-
 * enforced via a partial unique index) — the UI derives "you already have a
 * pending request" from finding one in this list rather than tracking it
 * separately. Requires `coach.wallet.read`.
 */
export async function getMyPayoutStatus(token: string): Promise<MyPayoutRequest[]> {
  const data = await staffRequest({ method: 'GET', path: '/api/coach/payouts', token });
  return parse(myPayoutStatusSchema, data).requests;
}

const requestPayoutEnvelope = z.object({ id: z.string() });

/**
 * POST /api/coach/payouts {amountMinor, currency} → files a withdrawal
 * request against the caller's own wallet balance; returns the new request's
 * id (use getMyPayoutStatus to read the fresh row back). `currency` must be
 * 'NPR' or 'USD'. 'invalid' when the amount is below the per-currency
 * minimum (server: `{error:'below_minimum', minimumMinor, currency}`, a 400
 * this client maps to 'invalid'); 'insufficient_balance' when it exceeds the
 * caller's current balance in that currency; 'already_pending' (409) when the
 * caller already has one pending request. Requires `coach.wallet.read`.
 */
export async function requestPayout(
  amountMinor: number,
  currency: string,
  token: string,
): Promise<string> {
  const data = await staffRequest({
    method: 'POST',
    path: '/api/coach/payouts',
    token,
    body: { amountMinor, currency },
  });
  return parse(requestPayoutEnvelope, data).id;
}

// ════════════════════════════════════════════════════════════════
// Admin console — payout queue (P1-12)
// ════════════════════════════════════════════════════════════════

const payoutRequestRowSchema = z.object({
  id: z.string(),
  coach: tierRequestCoachSchema,
  amountMinor: z.number(),
  currency: z.string(),
  status: payoutStatusSchema,
  note: z.string().nullable().catch(null),
  disbursementRef: z.string().nullable().catch(null),
  // Only populated on PENDING rows (the coach's live ledger balance in the
  // requested currency, so the admin can see coverage before approving);
  // null on decided/history rows. `.catch(null)` tolerates an older server.
  balanceMinor: z.number().nullable().catch(null),
  requestedAt: z.string(),
  decidedAt: z.string().nullable().catch(null),
});
export type PayoutRequestRow = z.infer<typeof payoutRequestRowSchema>;

function parsePayoutRows(raw: unknown): PayoutRequestRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): PayoutRequestRow[] => {
    const parsed = payoutRequestRowSchema.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  });
}

const payoutQueueSchema = z.object({
  pending: z.array(z.unknown()).transform(parsePayoutRows),
  history: z.array(z.unknown()).transform(parsePayoutRows),
});
export interface PayoutQueue {
  /** Every currently-pending request, oldest first (so nothing starves). */
  pending: PayoutRequestRow[];
  /** The newest 100 decided requests (approved/rejected/paid), newest first. */
  history: PayoutRequestRow[];
}

/**
 * GET /api/admin/payouts → the payout review queue: ALL pending requests plus
 * a capped tail of decided history (no `status` filter — the server always
 * returns both buckets in one call; the caller derives per-status tabs by
 * filtering `history` locally). Requires `payouts.review`.
 */
export async function getPayoutRequests(token: string): Promise<PayoutQueue> {
  const data = await staffRequest({ method: 'GET', path: '/api/admin/payouts', token });
  return parse(payoutQueueSchema, data);
}

/**
 * POST /api/admin/payouts/[id] {action:'approve', disbursementRef, note?} |
 * {action:'reject', note?} → decide a pending payout. Approve requires a
 * non-empty `disbursementRef` (the bank/eSewa/Khalti transaction reference),
 * re-checks the coach's LIVE ledger balance at decision time, and posts the
 * negative wallet-ledger entry server-side; reject frees the coach's
 * one-pending slot. 'not_found' for an unknown id; 'conflict' (409, server
 * `{error:'already_decided'}`) when another admin already decided it in the
 * meantime — the caller should refetch the queue rather than retry blindly;
 * 'insufficient_balance' when the coach's balance no longer covers the
 * request. Requires `payouts.review`.
 */
export async function decidePayoutRequest(
  id: string,
  action: DecideAction,
  options: { disbursementRef?: string; note?: string },
  token: string,
): Promise<void> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/admin/payouts/${encodeURIComponent(id)}`,
    token,
    body: {
      action,
      ...(options.disbursementRef !== undefined
        ? { disbursementRef: options.disbursementRef }
        : {}),
      ...(options.note !== undefined ? { note: options.note } : {}),
    },
  });
  parse(okSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Admin console — meal-delivery orders oversight (plan §3/§6/§7 P11)
// ════════════════════════════════════════════════════════════════

const orderStatusSchema = z.enum(ORDER_STATUSES as unknown as [OrderStatus, ...OrderStatus[]]);
const mealWindowSchema = z.enum(['lunch', 'dinner']);
const mealCurrencySchema = z.enum(['NPR', 'USD']);
const orderPaymentMethodSchema = z.enum(['esewa', 'khalti', 'cod']);
const orderPaymentStatusSchema = z.enum(['unpaid', 'receipt_submitted', 'paid', 'refunded']);
const orderSourceSchema = z.enum(['one_time', 'subscription']);

const adminOrderItemSchema = z.object({
  name: z.string(),
  qty: z.number(),
  priceMinorSnapshot: z.number(),
});
export type AdminOrderItem = z.infer<typeof adminOrderItemSchema>;

/**
 * One order row for the all-partners oversight queue — the partner strict
 * projection (§2 PartnerOrderView) PLUS the partner's own name/id, since an
 * admin (unlike a partner) may see across restaurants. Still never carries the
 * member's raw accountId/email — delivery-necessary fields only, same
 * discipline as the partner surface.
 */
const adminOrderRowSchema = z.object({
  id: z.string(),
  partnerId: z.string(),
  partnerName: z.string(),
  source: orderSourceSchema,
  status: orderStatusSchema,
  placedAt: z.string(),
  deliveryDate: z.string(),
  window: mealWindowSchema,
  deliveryName: z.string(),
  deliveryPhone: z.string(),
  deliveryAddressText: z.string(),
  // Free-text delivery note (already PII-masked server-side).
  deliveryNotes: z.string().catch(''),
  // Geocoded delivery pin for rider navigation; null when address is text-only.
  deliveryLat: z.number().nullable().catch(null),
  deliveryLng: z.number().nullable().catch(null),
  items: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): AdminOrderItem[] => {
      const parsed = adminOrderItemSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
  totalMinor: z.number(),
  currency: mealCurrencySchema,
  paymentMethod: orderPaymentMethodSchema,
  paymentStatus: orderPaymentStatusSchema,
  cancelReason: z.string().nullable().catch(null),
});
export type AdminOrderRow = z.infer<typeof adminOrderRowSchema>;

/** Resilient: drop unparseable rows rather than blanking the whole queue. */
const adminOrdersSchema = z.object({
  orders: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): AdminOrderRow[] => {
      const parsed = adminOrderRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

export type AdminOrderScope = 'active' | 'history';

/**
 * GET /api/admin/orders?scope=active|history&status=&partnerId= → every
 * order across every partner (all-orders oversight, §3/§7 P11). `scope`
 * defaults to 'active' (non-terminal, oldest-cutoff first) server-side;
 * 'history' returns delivered/cancelled/refused, newest first. `status` and
 * `partnerId` optionally narrow further. Requires `orders.review`
 * (super_admin/main_admin — no sub-role preset).
 */
export async function fetchAdminOrders(
  token: string,
  opts: { scope?: AdminOrderScope; status?: OrderStatus; partnerId?: string } = {},
): Promise<AdminOrderRow[]> {
  const params = new URLSearchParams();
  if (opts.scope) params.set('scope', opts.scope);
  if (opts.status) params.set('status', opts.status);
  if (opts.partnerId) params.set('partnerId', opts.partnerId);
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await staffRequest({
    method: 'GET',
    path: `/api/admin/orders${query}`,
    token,
  });
  return parse(adminOrdersSchema, data).orders;
}

const adminOrderEnvelope = z.object({ order: adminOrderRowSchema });

/**
 * POST /api/admin/orders/[id]/override {toStatus, reason?} → admin force-
 * advance, mirroring the partner advance route but with admin authority
 * (§3/§8 `canActorAdvance(from, toStatus, 'admin')`): every transition a
 * partner may drive, PLUS "cancel any non-terminal order" even one already
 * out for delivery. A CAS conflict (lost race / illegal transition / the
 * order already moved on) surfaces as 'conflict' — refetch the queue rather
 * than retrying blind. Requires `orders.review`.
 */
export async function overrideOrderStatus(
  id: string,
  toStatus: OrderStatus,
  reason: string | undefined,
  token: string,
): Promise<AdminOrderRow> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/admin/orders/${encodeURIComponent(id)}/override`,
    token,
    body: { toStatus, ...(reason !== undefined ? { reason } : {}) },
  });
  return parse(adminOrderEnvelope, data).order;
}

// ════════════════════════════════════════════════════════════════
// Admin console — meal-delivery payment requests (plan §3/§6/§7 P11)
// ════════════════════════════════════════════════════════════════

export type MealPaymentReviewStatus = 'pending' | 'approved' | 'rejected' | 'refunded';
const mealPaymentStatusSchema = z.enum(['pending', 'approved', 'rejected', 'refunded']);
const mealPaymentMethodSchema = z.enum(['esewa', 'khalti']);

const mealPaymentAccountSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
});

/** Order-scoped target context (null fields when the row's target is a cycle). */
const mealPaymentOrderTargetSchema = z.object({
  kind: z.literal('order'),
  id: z.string().nullable(),
  totalMinor: z.number().nullable(),
  status: orderStatusSchema.nullable(),
  paymentStatus: orderPaymentStatusSchema.nullable(),
  deliveryDate: z.string().nullable(),
  window: mealWindowSchema.nullable(),
});

/** Cycle-scoped target context (weekly-subscription billing). */
const mealPaymentCycleTargetSchema = z.object({
  kind: z.literal('cycle'),
  id: z.string().nullable(),
  amountMinor: z.number().nullable(),
  status: z.enum(['open', 'awaiting_payment', 'paid', 'void']).nullable(),
  weekStart: z.string().nullable(),
  weekEnd: z.string().nullable(),
});

const mealPaymentTargetSchema = z.union([
  mealPaymentOrderTargetSchema,
  mealPaymentCycleTargetSchema,
]);
export type MealPaymentTarget = z.infer<typeof mealPaymentTargetSchema>;

const mealPaymentRequestRowSchema = z.object({
  id: z.string(),
  account: mealPaymentAccountSchema,
  target: mealPaymentTargetSchema,
  amountMinor: z.number(),
  currency: z.string(),
  method: mealPaymentMethodSchema,
  // A signed URL minted per-request — never cache/store beyond this screen's
  // lifetime (mirrors the subscription payment-requests receipt contract).
  receiptUrl: z.string(),
  note: z.string().nullable(),
  status: mealPaymentStatusSchema,
  reviewNote: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable().catch(null),
});
export type MealPaymentRequestRow = z.infer<typeof mealPaymentRequestRowSchema>;

/** Resilient: drop unparseable rows rather than blanking the whole queue. */
const mealPaymentQueueSchema = z.object({
  requests: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): MealPaymentRequestRow[] => {
      const parsed = mealPaymentRequestRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/**
 * GET /api/admin/meal-payments?status= → the meal manual-payment queue
 * (eSewa/Khalti receipts for one-time orders AND weekly subscription
 * cycles), newest first. Reuses `payments.review` (no new permission key per
 * the plan). `receiptUrl` is re-minted fresh on every read.
 */
export async function fetchMealPaymentQueue(
  token: string,
  status?: MealPaymentReviewStatus,
): Promise<MealPaymentRequestRow[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const data = await staffRequest({
    method: 'GET',
    path: `/api/admin/meal-payments${query}`,
    token,
  });
  return parse(mealPaymentQueueSchema, data).requests;
}

/**
 * POST /api/admin/meal-payments/[id] {action:'approve'|'reject', note?} →
 * decide one pending meal payment request. Approve idempotently stamps the
 * target `paid` (order.paymentStatus or cycle.status) but does NOT auto-
 * advance order fulfillment — that's a separate overrideOrderStatus/partner
 * advance call. 'not_found' for an unknown id; a 409 means another admin
 * already decided it — refetch rather than retry. Requires `payments.review`.
 */
export async function decideMealPayment(
  id: string,
  action: DecideAction,
  note: string | undefined,
  token: string,
): Promise<void> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/admin/meal-payments/${encodeURIComponent(id)}`,
    token,
    body: { action, ...(note !== undefined ? { note } : {}) },
  });
  parse(okSchema, data);
}

/**
 * POST /api/admin/meal-payments/[id]/refund {reason?} → reverse an already-
 * APPROVED meal payment. Non-refundable (409) once the order is in
 * production (preparing/out_for_delivery/delivered/refused) or past its
 * frozen cutoff, or once the cycle's billed week has begun — mirrors the
 * subscription payment-requests refund pattern. Requires `payments.review`.
 */
export async function refundMealPayment(
  id: string,
  reason: string | undefined,
  token: string,
): Promise<void> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/admin/meal-payments/${encodeURIComponent(id)}/refund`,
    token,
    body: { ...(reason !== undefined ? { reason } : {}) },
  });
  parse(okSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Shared numeric coercion — geo columns (lat/lng/radius) can arrive as a
// number OR a driver-stringified numeric; coerce, tolerating null. A parse
// failure defaults to null rather than nuking the whole row.
// ════════════════════════════════════════════════════════════════

const numericNullable = z.coerce.number().nullable().catch(null);

// ════════════════════════════════════════════════════════════════
// Admin console — platform analytics (GET /api/admin/analytics, analytics.read)
// ════════════════════════════════════════════════════════════════

const currencyAmountSchema = z.object({ currency: z.string(), amountMinor: z.number() });
export type CurrencyAmount = z.infer<typeof currencyAmountSchema>;

const revenueMonthSchema = z.object({
  month: z.string(),
  totals: z.array(currencyAmountSchema).catch([]),
});
export type RevenueMonth = z.infer<typeof revenueMonthSchema>;

const promoPerformanceSchema = z.object({
  codeId: z.string(),
  code: z.string(),
  ownerName: z.string().nullable().catch(null),
  active: z.boolean().catch(true),
  commissionPct: z.number().catch(0),
  redemptions: z.number().catch(0),
  settlements: z.number().catch(0),
  commission: z.array(currencyAmountSchema).catch([]),
});
export type PromoPerformance = z.infer<typeof promoPerformanceSchema>;

const coachPerformanceSchema = z.object({
  coachId: z.string(),
  displayName: z.string(),
  coachTier: coachTierSchema.catch('silver'),
  activeClients: z.number().catch(0),
  totalMilestones: z.number().catch(0),
  walletEarned: z.array(currencyAmountSchema).catch([]),
});
export type CoachPerformance = z.infer<typeof coachPerformanceSchema>;

const tierCountSchema = z.object({ tier: tierSchema, count: z.number() });
const countryCountSchema = z.object({ country: z.string().nullable(), count: z.number() });

const periodDeltasSchema = z.object({
  windowDays: z.number().catch(30),
  revenue: z
    .array(z.object({ currency: z.string(), current: z.number(), prior: z.number() }))
    .catch([]),
  newMembers: z.object({ current: z.number(), prior: z.number() }).catch({ current: 0, prior: 0 }),
  approvedPayments: z
    .object({ current: z.number(), prior: z.number() })
    .catch({ current: 0, prior: 0 }),
});
export type PeriodDeltas = z.infer<typeof periodDeltasSchema>;

/** Drop unparseable rows rather than blanking a whole breakdown section. */
function resilientRows<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>) {
  return z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): T[] => {
      const parsed = schema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  );
}

const analyticsSchema = z.object({
  revenueByMonth: resilientRows(revenueMonthSchema),
  currencies: z.array(z.string()).catch([]),
  promoPerformance: resilientRows(promoPerformanceSchema),
  coachPerformance: resilientRows(coachPerformanceSchema),
  tierBreakdown: resilientRows(tierCountSchema),
  countryBreakdown: resilientRows(countryCountSchema),
  deltas: periodDeltasSchema,
  generatedAt: z.string(),
});
export type AdminAnalytics = z.infer<typeof analyticsSchema>;

/**
 * GET /api/admin/analytics → the platform analytics snapshot (revenue by
 * month × currency incl. the meal-delivery vertical, promo + coach
 * performance, effective-tier + country breakdowns, trailing-30-day deltas).
 * Every figure is a server-side aggregate; no member PII. Requires
 * `analytics.read` (super/main, or a per-account override).
 */
export async function getAdminAnalytics(token: string): Promise<AdminAnalytics> {
  const data = await staffRequest({ method: 'GET', path: '/api/admin/analytics', token });
  return parse(analyticsSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Admin console — broadcast history + audience preview
// ════════════════════════════════════════════════════════════════

/**
 * One past broadcast, reconstructed from the audit trail. No dedicated
 * broadcast-history route exists — every send writes ONE `broadcast.send`
 * audit row carrying the recipient/device/delivery counts in its `meta`, so
 * the history view reads the audit log filtered to that action and unpacks
 * `meta`. Fields default defensively (a legacy row may omit newer keys).
 */
export interface BroadcastHistoryEntry {
  id: string;
  title: string;
  tier: string | null;
  country: string | null;
  recipients: number;
  devices: number;
  delivered: number;
  failed: number;
  truncated: boolean;
  actorEmail: string | null;
  createdAt: string;
}

const broadcastMetaSchema = z
  .object({
    title: z.string().catch(''),
    tier: z.string().nullable().catch(null),
    country: z.string().nullable().catch(null),
    recipients: z.number().catch(0),
    devices: z.number().catch(0),
    delivered: z.number().catch(0),
    failed: z.number().catch(0),
    truncated: z.boolean().catch(false),
  })
  .catch({
    title: '',
    tier: null,
    country: null,
    recipients: 0,
    devices: 0,
    delivered: 0,
    failed: 0,
    truncated: false,
  });

/**
 * GET /api/admin/audit?action=broadcast.send → the broadcast send history,
 * newest first (reuses the audit route + its keyset paging; `broadcast.send`
 * is audited with the full delivery counts in `meta`). Requires the audit
 * route's `audit.read`. Returns only the entries page (the caller can page via
 * getAudit directly if it needs the cursor).
 */
export async function getBroadcastHistory(token: string): Promise<BroadcastHistoryEntry[]> {
  const page = await getAudit(token, { action: 'broadcast.send' });
  return page.entries.map((e) => {
    const meta = broadcastMetaSchema.parse(e.meta);
    return {
      id: e.id,
      title: meta.title,
      tier: meta.tier,
      country: meta.country,
      recipients: meta.recipients,
      devices: meta.devices,
      delivered: meta.delivered,
      failed: meta.failed,
      truncated: meta.truncated,
      actorEmail: e.actorEmail,
      createdAt: e.createdAt,
    };
  });
}

export interface BroadcastAudienceFilter {
  /** Restrict to accounts at this effective billing tier. */
  tier?: Tier;
  /** ISO-3166 alpha-2 country code (e.g. 'NP'). */
  country?: string;
}

const broadcastPreviewSchema = z.object({ recipients: z.number() });

/**
 * POST /api/admin/broadcast/preview {tier?, country?} → { recipients } — the
 * size of the audience a send with the same filters would reach, WITHOUT
 * sending anything (frozen contract; the route is added by the broadcast-route
 * package). Lets the composer show "this reaches N members" before the
 * irreversible fan-out. Requires `broadcast.send`.
 */
export async function previewBroadcastAudience(
  filter: BroadcastAudienceFilter,
  token: string,
): Promise<number> {
  const data = await staffRequest({
    method: 'POST',
    path: '/api/admin/broadcast/preview',
    token,
    body: {
      ...(filter.tier !== undefined ? { tier: filter.tier } : {}),
      ...(filter.country !== undefined ? { country: filter.country } : {}),
    },
  });
  return parse(broadcastPreviewSchema, data).recipients;
}

// ════════════════════════════════════════════════════════════════
// Admin console — gamification oversight (gamification.manage)
// ════════════════════════════════════════════════════════════════

const xpCorrectionRowSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  accountEmail: z.string().nullable().catch(null),
  accountName: z.string().nullable().catch(null),
  amount: z.number(),
  createdAt: z.string(),
});
export type XpCorrectionRow = z.infer<typeof xpCorrectionRowSchema>;

const awardedBadgeRowSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  accountEmail: z.string().catch(''),
  accountName: z.string().catch(''),
  badgeId: z.string(),
  badgeName: z.string().catch(''),
  status: z.string(),
  earnedAt: z.string(),
});
export type AwardedBadgeRow = z.infer<typeof awardedBadgeRowSchema>;

const gamificationCorrectionsSchema = z.object({
  corrections: resilientRows(xpCorrectionRowSchema),
});
const gamificationBadgesSchema = z.object({ badges: resilientRows(awardedBadgeRowSchema) });

export interface GamificationOverview {
  recentCorrections: XpCorrectionRow[];
  recentBadges: AwardedBadgeRow[];
}

/**
 * The gamification console has no single "overview" route — it renders three
 * DB-backed lists. This composes the two browsable ones:
 *   GET /api/admin/gamification/xp-corrections?accountId=  (recent corrections)
 *   GET /api/admin/gamification/badges?accountId=          (recent awarded badges)
 * Pass `accountId` to narrow both to one member (the moderator's search flow);
 * omit it for the platform-wide recent feed. Challenges are a separate list
 * (listChallengesAdmin). Requires `gamification.manage`.
 */
export async function getGamificationOverview(
  token: string,
  accountId?: string,
): Promise<GamificationOverview> {
  const query = accountId?.trim() ? `?accountId=${encodeURIComponent(accountId.trim())}` : '';
  const [corrections, badges] = await Promise.all([
    staffRequest({ method: 'GET', path: `/api/admin/gamification/xp-corrections${query}`, token }),
    staffRequest({ method: 'GET', path: `/api/admin/gamification/badges${query}`, token }),
  ]);
  return {
    recentCorrections: parse(gamificationCorrectionsSchema, corrections).corrections,
    recentBadges: parse(gamificationBadgesSchema, badges).badges,
  };
}

const xpAdjustSchema = z.object({
  accountId: z.string(),
  delta: z.number(),
  xpTotal: z.number().nullable().catch(null),
});
export type XpAdjustResult = z.infer<typeof xpAdjustSchema>;

/**
 * POST /api/admin/gamification/xp-corrections {accountId, delta, reason} →
 * insert one `admin_correction` XP event (delta may be negative) and re-run
 * the award engine; returns the fresh cached total (or null if the refresh
 * couldn't run). `reason` is audit-logged verbatim. 'not_found' for an unknown
 * account, 'invalid' when delta is zero. Requires `gamification.manage`.
 */
export async function adjustMemberXp(
  accountId: string,
  delta: number,
  reason: string,
  token: string,
): Promise<XpAdjustResult> {
  const data = await staffRequest({
    method: 'POST',
    path: '/api/admin/gamification/xp-corrections',
    token,
    body: { accountId, delta, reason },
  });
  return parse(xpAdjustSchema, data);
}

/**
 * DELETE /api/admin/gamification/badges/[id] → remove ONE awarded-badge row by
 * its own id (the underlying XP award is left intact — claw it back separately
 * with a negative adjustMemberXp). The award engine may re-award on the
 * member's next sync if they still meet the threshold — this corrects a
 * wrongly-awarded badge, not a legitimately-earned one. 'not_found' for a
 * gone id. Requires `gamification.manage`.
 */
export async function revokeBadge(awardedBadgeId: string, token: string): Promise<void> {
  const data = await staffRequest({
    method: 'DELETE',
    path: `/api/admin/gamification/badges/${encodeURIComponent(awardedBadgeId)}`,
    token,
  });
  parse(z.object({ id: z.string() }), data);
}

const adminChallengeRowSchema = z.object({
  id: z.string(),
  coachId: z.string(),
  coachEmail: z.string().nullable().catch(null),
  coachName: z.string().nullable().catch(null),
  title: z.string(),
  monthKey: z.string(),
  targetDays: z.number(),
  memberCount: z.number().catch(0),
  createdAt: z.string(),
});
export type AdminChallengeRow = z.infer<typeof adminChallengeRowSchema>;

const adminChallengesSchema = z.object({ challenges: resilientRows(adminChallengeRowSchema) });

/**
 * GET /api/admin/gamification/challenges → every coach challenge across every
 * coach (newest month first) with the owning coach's identity and a live
 * member count — the moderation list. Requires `gamification.manage`.
 */
export async function listChallengesAdmin(token: string): Promise<AdminChallengeRow[]> {
  const data = await staffRequest({
    method: 'GET',
    path: '/api/admin/gamification/challenges',
    token,
  });
  return parse(adminChallengesSchema, data).challenges;
}

/**
 * DELETE /api/admin/gamification/challenges/[id] → remove an abusive/
 * miscalibrated coach challenge (members cascade; already-earned completion
 * badges are kept as permanent history). 'not_found' for a gone id. Requires
 * `gamification.manage`.
 */
export async function moderateChallenge(id: string, token: string): Promise<void> {
  const data = await staffRequest({
    method: 'DELETE',
    path: `/api/admin/gamification/challenges/${encodeURIComponent(id)}`,
    token,
  });
  parse(z.object({ id: z.string() }), data);
}

// ════════════════════════════════════════════════════════════════
// Admin console — catalog authoring (catalog.manage)
//
// NOTE: this table is NOT read by the shipped app yet (mobile sources its
// exercise/plan library from bundled JSON) — it's a staging/authoring tool
// for a future catalog sync. Screens must say so plainly; edits here don't
// change what members see today.
// ════════════════════════════════════════════════════════════════

const catalogExerciseRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  muscleGroup: z.string().catch(''),
  secondaryMuscles: z.array(z.string()).catch([]),
  equipment: z.string().nullable().catch(null),
  level: z.string().nullable().catch(null),
  category: z.string().nullable().catch(null),
  instructions: z.array(z.string()).catch([]),
  imageUrls: z.array(z.string()).catch([]),
  usedByPlanCount: z.number().catch(0),
});
export type CatalogExerciseRow = z.infer<typeof catalogExerciseRowSchema>;

const catalogExercisesSchema = z.object({ exercises: resilientRows(catalogExerciseRowSchema) });

/**
 * GET /api/admin/catalog/exercises?q=&limit= → the exercise catalog, name
 * ILIKE `q`, alphabetical, capped at `limit` (default 50, max 200). Each row
 * carries `usedByPlanCount` so the UI can warn before a delete that would
 * 409. Requires `catalog.manage`.
 */
export async function listCatalogExercises(
  token: string,
  opts: { q?: string; limit?: number } = {},
): Promise<CatalogExerciseRow[]> {
  const params = new URLSearchParams();
  if (opts.q?.trim()) params.set('q', opts.q.trim());
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await staffRequest({
    method: 'GET',
    path: `/api/admin/catalog/exercises${query}`,
    token,
  });
  return parse(catalogExercisesSchema, data).exercises;
}

export interface CatalogExerciseInput {
  /** Present → PATCH that existing row. Absent → POST a new one (the server
   * slugifies `name`, or accepts an explicit `slug` for a new row). */
  id?: string;
  /** Only honoured on CREATE — the bundled free-exercise-db slug space
   * (`^[A-Za-z0-9_-]+$`); omit to let the server slugify `name`. */
  slug?: string;
  name?: string;
  muscleGroup?: string;
  secondaryMuscles?: string[];
  /** null clears the column. */
  equipment?: string | null;
  level?: string | null;
  category?: string | null;
  instructions?: string[];
  imageUrls?: string[];
}

/**
 * Upsert one catalog exercise. With `id` → PATCH /api/admin/catalog/exercises/
 * [id] (partial update; a null field clears it). Without `id` → POST
 * /api/admin/catalog/exercises (create; `name`/`muscleGroup` required
 * server-side). Returns the row id. 'invalid' on a bad body, 'conflict' when
 * an explicit create slug is taken. Requires `catalog.manage`.
 */
export async function upsertCatalogExercise(
  input: CatalogExerciseInput,
  token: string,
): Promise<string> {
  const { id, slug, ...fields } = input;
  if (id) {
    const data = await staffRequest({
      method: 'PATCH',
      path: `/api/admin/catalog/exercises/${encodeURIComponent(id)}`,
      token,
      body: { ...fields },
    });
    return parse(z.object({ id: z.string() }), data).id;
  }
  const data = await staffRequest({
    method: 'POST',
    path: '/api/admin/catalog/exercises',
    token,
    body: { ...(slug !== undefined ? { id: slug } : {}), ...fields },
  });
  return parse(z.object({ id: z.string() }), data).id;
}

const catalogPlanRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  tierRequired: tierSchema.catch('starter'),
  goalType: z.string(),
  weeks: z.number(),
  daysPerWeek: z.number(),
  description: z.string().nullable().catch(null),
  isBranded: z.boolean().catch(false),
  workoutCount: z.number().catch(0),
});
export type CatalogPlanRow = z.infer<typeof catalogPlanRowSchema>;

const catalogPlansSchema = z.object({ plans: resilientRows(catalogPlanRowSchema) });

/**
 * GET /api/admin/catalog/plans → every training plan with its workout count
 * (not exercise-level detail — use getCatalogPlan for the full structure).
 * Requires `catalog.manage`.
 */
export async function listCatalogPlans(token: string): Promise<CatalogPlanRow[]> {
  const data = await staffRequest({ method: 'GET', path: '/api/admin/catalog/plans', token });
  return parse(catalogPlansSchema, data).plans;
}

const catalogPlanExerciseSchema = z.object({
  id: z.string(),
  exerciseId: z.string(),
  exerciseName: z.string().nullable().catch(null),
  position: z.number(),
  sets: z.number(),
  repRange: z.string(),
  restSec: z.number(),
});
const catalogPlanWorkoutSchema = z.object({
  id: z.string(),
  week: z.number(),
  day: z.number(),
  name: z.string(),
  exercises: z.array(catalogPlanExerciseSchema).catch([]),
});
export type CatalogPlanWorkout = z.infer<typeof catalogPlanWorkoutSchema>;

const catalogPlanDetailSchema = z.object({
  plan: z.object({
    id: z.string(),
    name: z.string(),
    tierRequired: tierSchema.catch('starter'),
    goalType: z.string(),
    weeks: z.number(),
    daysPerWeek: z.number(),
    description: z.string().nullable().catch(null),
    isBranded: z.boolean().catch(false),
  }),
  workouts: z.array(catalogPlanWorkoutSchema).catch([]),
});
export type CatalogPlanDetail = z.infer<typeof catalogPlanDetailSchema>;

/**
 * GET /api/admin/catalog/plans/[id] → one plan's top-level fields plus its
 * full nested workout/exercise structure (the builder read-model that
 * upsertCatalogPlan's `workouts` replace-set is built from). 'not_found' for
 * an unknown id. Requires `catalog.manage`.
 */
export async function getCatalogPlan(id: string, token: string): Promise<CatalogPlanDetail> {
  const data = await staffRequest({
    method: 'GET',
    path: `/api/admin/catalog/plans/${encodeURIComponent(id)}`,
    token,
  });
  return parse(catalogPlanDetailSchema, data);
}

export interface CatalogPlanWorkoutInput {
  week: number;
  day: number;
  name: string;
  exercises: {
    /** Must already exist in the exercise catalog (else 400 unknown_exercise). */
    exerciseId: string;
    position?: number;
    sets: number;
    repRange: string;
    restSec?: number;
  }[];
}

export interface CatalogPlanInput {
  /** Present → PATCH that plan. Absent → POST a new plan shell. */
  id?: string;
  name?: string;
  tierRequired?: Tier;
  goalType?: 'fat_loss' | 'muscle' | 'strength';
  weeks?: number;
  daysPerWeek?: number;
  description?: string;
  isBranded?: boolean;
  /** Update-only: replaces the ENTIRE workout/exercise structure (whole-set
   * replace, not a diff). Every `exerciseId` must exist in the catalog. */
  workouts?: CatalogPlanWorkoutInput[];
}

/**
 * Upsert a catalog plan. With `id` → PATCH /api/admin/catalog/plans/[id]
 * (partial top-level fields; if `workouts` is present the whole structure is
 * replaced). Without `id` → POST /api/admin/catalog/plans (create a shell;
 * `name`/`goalType`/`weeks`/`daysPerWeek` required server-side — add workouts
 * via a follow-up update). Returns the plan id. 'invalid' on a bad body (incl.
 * `unknown_exercise` for a workout referencing a missing exercise). Requires
 * `catalog.manage`.
 */
export async function upsertCatalogPlan(input: CatalogPlanInput, token: string): Promise<string> {
  const { id, ...fields } = input;
  if (id) {
    const data = await staffRequest({
      method: 'PATCH',
      path: `/api/admin/catalog/plans/${encodeURIComponent(id)}`,
      token,
      body: { ...fields },
    });
    return parse(z.object({ id: z.string() }), data).id;
  }
  const data = await staffRequest({
    method: 'POST',
    path: '/api/admin/catalog/plans',
    token,
    body: { ...fields },
  });
  return parse(z.object({ id: z.string() }), data).id;
}

// ════════════════════════════════════════════════════════════════
// Admin console — meal-partner roster (partners.manage)
// ════════════════════════════════════════════════════════════════

// The core meal_partners columns — exactly what the PATCH route echoes back.
const partnerCoreSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  contact: z.string().catch(''),
  phone: z.string().catch(''),
  addressText: z.string().catch(''),
  serviceAreas: z.array(z.string()).catch([]),
  serviceLat: numericNullable,
  serviceLng: numericNullable,
  serviceRadiusKm: numericNullable,
  acceptsCod: z.boolean().catch(true),
  currency: mealCurrencySchema.catch('NPR'),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type PartnerCore = z.infer<typeof partnerCoreSchema>;

// The roster list projection = the core row PLUS the login/aggregate columns
// the GET route joins on (never echoed by the single-row PATCH).
const partnerRowSchema = partnerCoreSchema.extend({
  email: z.string().catch(''),
  accountStatus: memberStatusSchema.catch('active'),
  menuCount: z.number().catch(0),
  activeOrders: z.number().catch(0),
});
export type PartnerRow = z.infer<typeof partnerRowSchema>;

const partnersSchema = z.object({ partners: resilientRows(partnerRowSchema) });

/**
 * GET /api/admin/partners → every meal partner with its login email/status,
 * live menu-item count and active-order count. Requires `partners.manage`
 * (super/main bypass only — not in any sub-role preset).
 */
export async function listPartnersAdmin(token: string): Promise<PartnerRow[]> {
  const data = await staffRequest({ method: 'GET', path: '/api/admin/partners', token });
  return parse(partnersSchema, data).partners;
}

export interface PartnerCreateInput {
  email: string;
  /** 8..200 chars — mints the partner's login. Handled in-request only; never
   * stored client-side. */
  password: string;
  name: string;
  contact?: string;
  phone?: string;
  addressText?: string;
  serviceAreas?: string[];
  serviceLat?: number | null;
  serviceLng?: number | null;
  serviceRadiusKm?: number | null;
  acceptsCod?: boolean;
  currency?: 'NPR' | 'USD';
}

const partnerCreateSchema = z.object({ id: z.string(), accountId: z.string() });

/**
 * POST /api/admin/partners → mint a partner login + restaurant row (the ONLY
 * way a `partner`-role account is created). 'conflict' (409 `email_taken`)
 * when the email is in use. Returns the new partner + account ids. Requires
 * `partners.manage`.
 */
export async function createPartner(
  input: PartnerCreateInput,
  token: string,
): Promise<{ id: string; accountId: string }> {
  const data = await staffRequest({
    method: 'POST',
    path: '/api/admin/partners',
    token,
    body: {
      email: input.email,
      password: input.password,
      name: input.name,
      ...(input.contact !== undefined ? { contact: input.contact } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.addressText !== undefined ? { addressText: input.addressText } : {}),
      ...(input.serviceAreas !== undefined ? { serviceAreas: input.serviceAreas } : {}),
      ...(input.serviceLat !== undefined ? { serviceLat: input.serviceLat } : {}),
      ...(input.serviceLng !== undefined ? { serviceLng: input.serviceLng } : {}),
      ...(input.serviceRadiusKm !== undefined ? { serviceRadiusKm: input.serviceRadiusKm } : {}),
      ...(input.acceptsCod !== undefined ? { acceptsCod: input.acceptsCod } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
    },
  });
  return parse(partnerCreateSchema, data);
}

export interface PartnerPatch {
  name?: string;
  contact?: string;
  phone?: string;
  addressText?: string;
  serviceAreas?: string[];
  serviceLat?: number | null;
  serviceLng?: number | null;
  serviceRadiusKm?: number | null;
  acceptsCod?: boolean;
  currency?: 'NPR' | 'USD';
  isActive?: boolean;
}

/**
 * PATCH /api/admin/partners/[id] → edit fields and/or flip `isActive`. Setting
 * `isActive:false` on an active partner ALSO kills every live session for that
 * login (a second kill-switch). 'not_found' for an unknown id. Returns the
 * updated partner row. Requires `partners.manage`.
 */
export async function updatePartner(
  id: string,
  patch: PartnerPatch,
  token: string,
): Promise<PartnerCore> {
  const data = await staffRequest({
    method: 'PATCH',
    path: `/api/admin/partners/${encodeURIComponent(id)}`,
    token,
    body: { ...patch },
  });
  return parse(z.object({ partner: partnerCoreSchema }), data).partner;
}

/**
 * Deactivate a partner — a `updatePartner(id, { isActive: false })` shorthand
 * that also kills the partner's live sessions (see updatePartner). Requires
 * `partners.manage`.
 */
export async function deactivatePartner(id: string, token: string): Promise<void> {
  await staffRequest({
    method: 'PATCH',
    path: `/api/admin/partners/${encodeURIComponent(id)}`,
    token,
    body: { isActive: false },
  });
}

// ════════════════════════════════════════════════════════════════
// Admin console — nearby-gyms directory (gyms.manage)
// ════════════════════════════════════════════════════════════════

const gymStatusSchema = z.enum(['draft', 'published', 'archived']);
export type GymStatus = z.infer<typeof gymStatusSchema>;

const gymSocialLinkSchema = z.object({ platform: z.string(), url: z.string() });

const gymRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  category: z.string().catch('gym'),
  addressText: z.string().catch(''),
  city: z.string().catch(''),
  district: z.string().catch(''),
  lat: numericNullable,
  lng: numericNullable,
  phone: z.string().catch(''),
  website: z.string().nullable().catch(null),
  socialLinks: z.array(gymSocialLinkSchema).catch([]),
  // hours is an opaque per-day shift map — kept as-is for the editor to render.
  hours: z.record(z.string(), z.unknown()).catch({}),
  amenities: z.array(z.string()).catch([]),
  externalImageUrl: z.string().nullable().catch(null),
  priceNote: z.string().catch(''),
  description: z.string().catch(''),
  status: gymStatusSchema.catch('draft'),
  verifiedByAdmin: z.boolean().catch(false),
  photoCount: z.number().catch(0),
  createdAt: z.string().catch(''),
  updatedAt: z.string().catch(''),
});
export type GymRow = z.infer<typeof gymRowSchema>;

const gymsSchema = z.object({ gyms: resilientRows(gymRowSchema) });

/**
 * GET /api/admin/gyms → every gym regardless of status (draft/published/
 * archived) with a photo count, so the console can see what's not live yet.
 * Requires `gyms.manage` (super/main bypass only).
 */
export async function listGymsAdmin(token: string): Promise<GymRow[]> {
  const data = await staffRequest({ method: 'GET', path: '/api/admin/gyms', token });
  return parse(gymsSchema, data).gyms;
}

export interface GymInput {
  /** Present → PATCH that gym. Absent → POST a new draft. */
  id?: string;
  /** Create-only: explicit slug (`^[a-z0-9-]+$`); omit to slugify `name`. */
  slug?: string;
  name?: string;
  category?: string;
  addressText?: string;
  city?: string;
  district?: string;
  lat?: number | null;
  lng?: number | null;
  phone?: string;
  website?: string | null;
  socialLinks?: { platform: string; url: string }[];
  hours?: Record<string, unknown>;
  amenities?: string[];
  externalImageUrl?: string | null;
  priceNote?: string;
  description?: string;
}

/**
 * Upsert a gym listing. With `id` → PATCH /api/admin/gyms/[id]. Without `id` →
 * POST /api/admin/gyms (always created `draft` + unverified regardless of
 * input — go live via setGymStatus once reviewed). Returns `{ id, slug? }`
 * ('invalid' on a bad body, 'conflict' on a taken slug). Requires
 * `gyms.manage`. Status/verified changes go through setGymStatus, not here.
 */
export async function upsertGymAdmin(
  input: GymInput,
  token: string,
): Promise<{ id: string; slug?: string }> {
  const { id, ...fields } = input;
  if (id) {
    const data = await staffRequest({
      method: 'PATCH',
      path: `/api/admin/gyms/${encodeURIComponent(id)}`,
      token,
      body: { ...fields },
    });
    return parse(z.object({ id: z.string(), slug: z.string().optional() }), data);
  }
  const data = await staffRequest({
    method: 'POST',
    path: '/api/admin/gyms',
    token,
    body: { ...fields },
  });
  return parse(z.object({ id: z.string(), slug: z.string().optional() }), data);
}

/**
 * PATCH /api/admin/gyms/[id] {status, verifiedByAdmin?} → publish/archive/
 * unpublish a gym (and/or flip its verified flag). Publishing requires the
 * gym to be verified (already, or set `verifiedByAdmin:true` in the same
 * call) — otherwise the server returns 400 (surfaced as 'invalid'). Requires
 * `gyms.manage`.
 */
export async function setGymStatus(
  id: string,
  status: GymStatus,
  token: string,
  verifiedByAdmin?: boolean,
): Promise<void> {
  await staffRequest({
    method: 'PATCH',
    path: `/api/admin/gyms/${encodeURIComponent(id)}`,
    token,
    body: { status, ...(verifiedByAdmin !== undefined ? { verifiedByAdmin } : {}) },
  });
}

// ════════════════════════════════════════════════════════════════
// Admin console — referral/trial abuse dashboard (subscription.override)
// ════════════════════════════════════════════════════════════════

const topReferrerSchema = z.object({
  referrerId: z.string(),
  email: z.string().catch(''),
  displayName: z.string().catch(''),
  totalCount: z.number(),
  rewardedCount: z.number().catch(0),
});

const multiTrialAccountSchema = z.object({
  accountId: z.string(),
  email: z.string().catch(''),
  displayName: z.string().catch(''),
  tiersTrialed: z.array(z.string()).catch([]),
});

const recentTrialSchema = z.object({
  accountId: z.string(),
  email: z.string().catch(''),
  displayName: z.string().catch(''),
  tier: z.string(),
  startedAt: z.string(),
  expiresAt: z.string(),
});

const abuseDashboardSchema = z.object({
  referrals: z.object({
    total: z.number().catch(0),
    pending: z.number().catch(0),
    joined: z.number().catch(0),
    rewarded: z.number().catch(0),
    topReferrers: resilientRows(topReferrerSchema),
  }),
  trials: z.object({
    total: z.number().catch(0),
    byTier: z
      .object({ silver: z.number(), gold: z.number(), elite: z.number() })
      .catch({ silver: 0, gold: 0, elite: 0 }),
    multiTrialAccounts: resilientRows(multiTrialAccountSchema),
    recentTrials: resilientRows(recentTrialSchema),
  }),
  limitations: z.array(z.string()).catch([]),
});
export type AbuseDashboard = z.infer<typeof abuseDashboardSchema>;

/**
 * GET /api/admin/abuse → referral + trial-usage aggregates (top referrers,
 * multi-trial accounts, recent trials) plus a `limitations` note (no
 * device/IP fingerprint is captured, so same-device detection isn't
 * available). Gated on `subscription.override` (member_admin preset + super/
 * main) — not a new key.
 */
export async function getAbuseDashboard(token: string): Promise<AbuseDashboard> {
  const data = await staffRequest({ method: 'GET', path: '/api/admin/abuse', token });
  return parse(abuseDashboardSchema, data);
}

const trialResetSchema = z.object({
  accountId: z.string(),
  reset: z.array(z.string()).catch([]),
});

/**
 * POST /api/admin/abuse {accountId, tier?} → clear the account's trial_usage
 * row(s) so it can start a fresh trial (one tier when `tier` is given, every
 * tier otherwise). Returns the tiers actually removed (empty = the account was
 * already clean — still a 200, not a 404). 'not_found' for an unknown account.
 * Requires `subscription.override`.
 */
export async function resetTrial(
  accountId: string,
  tier: 'silver' | 'gold' | 'elite' | undefined,
  token: string,
): Promise<string[]> {
  const data = await staffRequest({
    method: 'POST',
    path: '/api/admin/abuse',
    token,
    body: { accountId, ...(tier !== undefined ? { tier } : {}) },
  });
  return parse(trialResetSchema, data).reset;
}

// ════════════════════════════════════════════════════════════════
// Admin console — per-account permission overrides (permissions.override)
// ════════════════════════════════════════════════════════════════

const permissionRowSchema = z.object({
  key: z.string(),
  preset: z.boolean(),
  override: z.enum(['allow', 'deny']).nullable(),
  effective: z.boolean(),
});
export type StaffPermissionRow = z.infer<typeof permissionRowSchema>;

const staffPermissionsSchema = z.object({
  accountId: z.string(),
  role: staffRoleSchema,
  // super_admin/main_admin are safety floors — overrides are ignored and the
  // editor locks (C-A). The screen disables all toggles when `locked`.
  locked: z.boolean().catch(false),
  permissions: resilientRows(permissionRowSchema),
});
export type StaffPermissions = z.infer<typeof staffPermissionsSchema>;

/**
 * GET /api/admin/staff/[accountId]/permissions → the target staff account's
 * effective permission set with provenance per key ({preset, override:
 * 'allow'|'deny'|null, effective}), plus a `locked` flag for the super/main
 * safety floor. 'not_found' (404 `not_staff`) for a non-staff account,
 * 'insufficient_rank' when the caller can't manage the target. Requires
 * `permissions.override`.
 */
export async function getStaffPermissions(
  accountId: string,
  token: string,
): Promise<StaffPermissions> {
  const data = await staffRequest({
    method: 'GET',
    path: `/api/admin/staff/${encodeURIComponent(accountId)}/permissions`,
    token,
  });
  return parse(staffPermissionsSchema, data);
}

/**
 * PUT /api/admin/staff/[accountId]/permissions {perm, allow} → set ONE
 * override: `allow:true` grants an extra permission beyond the role preset,
 * `allow:false` strips a preset one. Returns the fresh provenance payload.
 * 'invalid' for an unknown permission key; 'forbidden' (403
 * `cannot_modify_super_admin`) against a super/main target; 'cannot_target_self'
 * for the caller's own row; 'insufficient_rank' when out-ranked. Requires
 * `permissions.override`.
 */
export async function setPermissionOverride(
  accountId: string,
  perm: Permission,
  allow: boolean,
  token: string,
): Promise<StaffPermissions> {
  const data = await staffRequest({
    method: 'PUT',
    path: `/api/admin/staff/${encodeURIComponent(accountId)}/permissions`,
    token,
    body: { perm, allow },
  });
  return parse(staffPermissionsSchema, data);
}

/**
 * PUT /api/admin/staff/[accountId]/permissions {perm, allow:null} → clear one
 * override, reverting that key to the role preset. Returns the fresh
 * provenance payload. Same guards as setPermissionOverride. Requires
 * `permissions.override`.
 */
export async function clearPermissionOverride(
  accountId: string,
  perm: Permission,
  token: string,
): Promise<StaffPermissions> {
  const data = await staffRequest({
    method: 'PUT',
    path: `/api/admin/staff/${encodeURIComponent(accountId)}/permissions`,
    token,
    body: { perm, allow: null },
  });
  return parse(staffPermissionsSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Coach console — attention queue (coach.user.read)
// ════════════════════════════════════════════════════════════════

const attentionCheckInSchema = z
  .object({
    id: z.string(),
    date: z.string().catch(''),
    note: z.string().nullable().catch(null),
    summary: z.string().nullable().catch(null),
  })
  .nullable()
  .catch(null);

const coachAttentionRowSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string().catch(''),
  tier: tierSchema.catch('starter'),
  lastWorkoutAt: z.string().nullable().catch(null),
  lastCheckInAt: z.string().nullable().catch(null),
  daysSinceWorkout: z.number().nullable().catch(null),
  daysSinceCheckIn: z.number().nullable().catch(null),
  latestCheckIn: attentionCheckInSchema,
  pendingSuggestions: z.number().catch(0),
});
export type CoachAttentionRow = z.infer<typeof coachAttentionRowSchema>;

const coachAttentionSchema = z.object({ clients: resilientRows(coachAttentionRowSchema) });

/**
 * GET /api/coach/attention → the caller's active clients sorted stalest-first
 * (max of days-since-workout / days-since-check-in; clients with no data at
 * all sort to the top). super/main see every actively-assigned client.
 * Requires `coach.user.read`.
 */
export async function getCoachAttention(token: string): Promise<CoachAttentionRow[]> {
  const data = await staffRequest({ method: 'GET', path: '/api/coach/attention', token });
  return parse(coachAttentionSchema, data).clients;
}

// ════════════════════════════════════════════════════════════════
// Coach console — progression review queue (coach.user.read / coach.message.user)
// ════════════════════════════════════════════════════════════════

export type SuggestionStatus = 'pending' | 'approved' | 'adjusted';
const suggestionStatusSchema = z.enum(['pending', 'approved', 'adjusted']);

const reviewUserSchema = z.object({
  id: z.string(),
  displayName: z.string().catch(''),
  email: z.string().catch(''),
});

const reviewSuggestionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  exerciseId: z.string().nullable().catch(null),
  exerciseName: z.string().catch(''),
  sourceWorkoutId: z.string().nullable().catch(null),
  action: z.string().catch(''),
  targetWeightKg: z.number().nullable().catch(null),
  targetRepsMin: z.number().nullable().catch(null),
  targetRepsMax: z.number().nullable().catch(null),
  reason: z.string().nullable().catch(null),
  status: suggestionStatusSchema,
  coachId: z.string().nullable().catch(null),
  adjustedWeightKg: z.number().nullable().catch(null),
  coachNote: z.string().nullable().catch(null),
  reviewedAt: z.string().nullable().catch(null),
  createdAt: z.string(),
  user: reviewUserSchema,
});
export type ReviewSuggestion = z.infer<typeof reviewSuggestionSchema>;

const reviewQueueSchema = z.object({ suggestions: resilientRows(reviewSuggestionSchema) });

/**
 * GET /api/coach/suggestions?status= → the progression-review queue for the
 * caller's assigned clients (default 'pending'; also 'approved'|'adjusted'),
 * oldest first. super/main see every client. Requires `coach.user.read`.
 */
export async function getCoachReviewQueue(
  token: string,
  status: SuggestionStatus = 'pending',
): Promise<ReviewSuggestion[]> {
  const data = await staffRequest({
    method: 'GET',
    path: `/api/coach/suggestions?status=${encodeURIComponent(status)}`,
    token,
  });
  return parse(reviewQueueSchema, data).suggestions;
}

export type ReviewDecision =
  | { action: 'approve' }
  | { action: 'adjust'; weightKg: number; note?: string };

/**
 * POST /api/coach/suggestions/[id] → review one suggestion: `{action:'approve'}`
 * accepts it as-is; `{action:'adjust', weightKg, note?}` overrides the target
 * weight (canonical kg). Ownership comes from the row (the caller must have an
 * active assignment over the suggestion's member) — 'forbidden' otherwise,
 * 'not_found' for a gone id. Requires `coach.message.user`.
 */
export async function decideCoachReview(
  id: string,
  decision: ReviewDecision,
  token: string,
): Promise<void> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/coach/suggestions/${encodeURIComponent(id)}`,
    token,
    body:
      decision.action === 'approve'
        ? { action: 'approve' }
        : {
            action: 'adjust',
            weightKg: decision.weightKg,
            ...(decision.note !== undefined ? { note: decision.note } : {}),
          },
  });
  parse(z.object({ suggestion: z.unknown() }), data);
}

// ════════════════════════════════════════════════════════════════
// Coach console — strength-badge verification queue (coach.user.read)
// ════════════════════════════════════════════════════════════════

const verifyItemSchema = z.object({
  awardId: z.string(),
  userId: z.string(),
  badgeId: z.string(),
  earnedAt: z.string(),
  displayName: z.string().catch(''),
});
export type VerifyItem = z.infer<typeof verifyItemSchema>;

const verifyQueueSchema = z.object({ items: resilientRows(verifyItemSchema) });

/**
 * GET /api/coach/verifications → the caller's assigned clients' `logged`
 * strength-club badges awaiting a coach checkmark, oldest first. super/main
 * see every client. Requires `coach.user.read`.
 */
export async function getCoachVerifyQueue(token: string): Promise<VerifyItem[]> {
  const data = await staffRequest({ method: 'GET', path: '/api/coach/verifications', token });
  return parse(verifyQueueSchema, data).items;
}

/**
 * POST /api/coach/verifications/[awardId] {action:'verify'} → stamp a logged
 * strength badge verified (idempotent). 'invalid' (400 `not_verifiable`) for a
 * non-strength badge; 'forbidden' with no active assignment over the member;
 * 'not_found' for a gone award. Requires `coach.message.user`.
 */
export async function decideCoachVerify(awardId: string, token: string): Promise<void> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/coach/verifications/${encodeURIComponent(awardId)}`,
    token,
    body: { action: 'verify' },
  });
  parse(okSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Coach console — flagged (unranked) workouts (coach.user.read)
// ════════════════════════════════════════════════════════════════

const flagTopSetSchema = z
  .object({ exerciseName: z.string(), weightKg: z.number(), reps: z.number() })
  .nullable()
  .catch(null);

const coachFlagRowSchema = z.object({
  workoutId: z.string(),
  userId: z.string(),
  displayName: z.string().catch(''),
  date: z.string().catch(''),
  name: z.string().catch(''),
  reason: z.string().nullable().catch(null),
  topSet: flagTopSetSchema,
  acked: z.boolean().catch(false),
});
export type CoachFlagRow = z.infer<typeof coachFlagRowSchema>;

const coachFlagsSchema = z.object({ items: resilientRows(coachFlagRowSchema) });

/**
 * GET /api/coach/flags → the caller's assigned clients' flagged (unranked)
 * workouts, unacknowledged first, each with its heaviest set as `topSet`
 * context. super/main see every client. Requires `coach.user.read`.
 */
export async function getCoachFlags(token: string): Promise<CoachFlagRow[]> {
  const data = await staffRequest({ method: 'GET', path: '/api/coach/flags', token });
  return parse(coachFlagsSchema, data).items;
}

export type CoachFlagAction = 'acknowledge' | 'restore';

/**
 * POST /api/coach/flags/[workoutId] {action:'restore'} → clear a false-positive
 * flag: ranked=true + flagReason cleared, re-running the member's award engine
 * so the session counts again (the ONLY path that can un-flag a workout).
 * `{action:'acknowledge'}` instead just marks the flag seen without un-flagging.
 * Ownership comes from the row — 'forbidden' with no active assignment,
 * 'not_found' for a gone id. Requires `coach.message.user`.
 */
export async function restoreCoachFlag(
  workoutId: string,
  token: string,
  action: CoachFlagAction = 'restore',
): Promise<void> {
  const data = await staffRequest({
    method: 'POST',
    path: `/api/coach/flags/${encodeURIComponent(workoutId)}`,
    token,
    body: { action },
  });
  parse(okSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Coach console — monthly challenge (coach.user.read / coach.message.user)
// ════════════════════════════════════════════════════════════════

const coachChallengeMemberSchema = z.object({
  userId: z.string(),
  displayName: z.string().catch(''),
  joined: z.boolean(),
  days: z.number().catch(0),
  complete: z.boolean().catch(false),
});
export type CoachChallengeMember = z.infer<typeof coachChallengeMemberSchema>;

const coachChallengeSchema = z.object({
  id: z.string(),
  title: z.string(),
  monthKey: z.string(),
  targetDays: z.number(),
  members: z.array(coachChallengeMemberSchema).catch([]),
});
export type CoachChallenge = z.infer<typeof coachChallengeSchema>;

const coachChallengeEnvelope = z.object({ challenge: coachChallengeSchema.nullable() });

/**
 * GET /api/coach/challenges → the caller's CURRENT-month challenge (or null if
 * none), with a per-assigned-client progress list (joined?, ranked
 * session-days this month, complete?). One active challenge per coach per
 * month. Requires `coach.user.read`.
 */
export async function listCoachChallenges(token: string): Promise<CoachChallenge | null> {
  const data = await staffRequest({ method: 'GET', path: '/api/coach/challenges', token });
  return parse(coachChallengeEnvelope, data).challenge;
}

export interface CoachChallengeInput {
  /** 1..80 chars. */
  title: string;
  /** 4..31 — days of ranked training needed to complete. */
  targetDays: number;
  /** 'YYYY-MM'; must be the current month. Defaults to the current UTC month. */
  monthKey?: string;
}

/** Current UTC month key ('YYYY-MM') — the only month the server will accept. */
function currentChallengeMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

const coachChallengeCreateEnvelope = z.object({ challenge: z.object({ id: z.string() }).passthrough() });

/**
 * POST /api/coach/challenges {title, targetDays, monthKey} → create the
 * caller's monthly challenge (create-only; there is no edit route — a coach
 * runs ONE per month). Returns the new challenge id. 'conflict' (409) when one
 * already exists this month (`exists`) or the month isn't current
 * (`wrong_month`); 'invalid' on a bad body. Requires `coach.message.user`.
 */
export async function upsertCoachChallenge(
  input: CoachChallengeInput,
  token: string,
): Promise<string> {
  const data = await staffRequest({
    method: 'POST',
    path: '/api/coach/challenges',
    token,
    body: {
      title: input.title,
      targetDays: input.targetDays,
      monthKey: input.monthKey ?? currentChallengeMonthKey(),
    },
  });
  return parse(coachChallengeCreateEnvelope, data).challenge.id;
}

// ════════════════════════════════════════════════════════════════
// Member meals — checkout quote (POST /api/meals/quote)
// ════════════════════════════════════════════════════════════════

const mealQuoteSchema = z.object({
  subtotalMinor: z.number(),
  deliveryFeeMinor: z.number(),
  smallOrderFeeMinor: z.number(),
  totalMinor: z.number(),
  currency: mealCurrencySchema,
  // true = the partner delivers to the chosen address, false = out of range,
  // null = undeterminable (no geocoded pin / text-only address).
  deliversTo: z.boolean().nullable(),
});
export type MealQuote = z.infer<typeof mealQuoteSchema>;

export interface MealQuoteInput {
  partnerId: string;
  items: { mealId: string; qty: number }[];
  /** A saved delivery address id, when quoting against one. */
  addressId?: string;
  window: 'lunch' | 'dinner';
  /** 'YYYY-MM-DD' delivery date. */
  date: string;
}

/**
 * POST /api/meals/quote {partnerId, items, addressId?, window, date} → the
 * priced order preview (subtotal + delivery fee + small-order fee + grand
 * total, in the partner's currency) plus `deliversTo` coverage, WITHOUT
 * placing anything — so the member sees every fee before committing (frozen
 * contract; the route is built by the meals-route package). A member (bearer)
 * call, not a staff one, but it reuses this module's fetch/error plumbing.
 */
export async function quoteMealOrder(input: MealQuoteInput, token: string): Promise<MealQuote> {
  const data = await staffRequest({
    method: 'POST',
    path: '/api/meals/quote',
    token,
    body: {
      partnerId: input.partnerId,
      items: input.items,
      ...(input.addressId !== undefined ? { addressId: input.addressId } : {}),
      window: input.window,
      date: input.date,
    },
  });
  return parse(mealQuoteSchema, data);
}
