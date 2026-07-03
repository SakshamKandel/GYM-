import { z } from 'zod';
import type { Tier } from '@gym/shared';

/**
 * Auth API client — tiny typed fetch wrapper for the GM Method backend.
 *
 * Accounts are OPTIONAL (local-first app); this client only powers cloud
 * sync / subscriptions. Every payload is zod-validated at the boundary
 * (CLAUDE.md rule 8) and every failure surfaces as a typed `ApiError`
 * code so screens never string-match server messages.
 */

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export type ApiErrorCode =
  | 'email_taken'
  | 'bad_credentials'
  | 'invalid'
  | 'network'
  | 'unauthorized'
  | 'not_configured';

export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ApiError';
    this.code = code;
  }
}

/** Narrow an unknown thrown value to ApiError (anything else = network). */
export function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('network');
}

// ── Schemas ───────────────────────────────────────────────────

const tierSchema: z.ZodType<Tier> = z.enum(['starter', 'silver', 'gold', 'elite']);

const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  tier: tierSchema,
});

export type AuthUser = z.infer<typeof userSchema>;

const sessionSchema = z.object({ token: z.string(), user: userSchema });

export type AuthSession = z.infer<typeof sessionSchema>;

const meSchema = z.object({ user: userSchema });
const okSchema = z.object({ ok: z.literal(true) });
const errorBodySchema = z.object({ error: z.string() });

// ── Fetch plumbing ────────────────────────────────────────────

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  body?: Record<string, unknown>;
  token?: string;
}

function serverErrorCode(raw: string): ApiErrorCode | null {
  return raw === 'email_taken' ||
    raw === 'bad_credentials' ||
    raw === 'invalid' ||
    raw === 'not_configured'
    ? raw
    : null;
}

/** Perform the request; resolve with the parsed JSON of a 2xx response. */
async function request(opts: RequestOptions): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${opts.path}`, {
      method: opts.method,
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : null),
        ...(opts.token !== undefined ? { Authorization: `Bearer ${opts.token}` } : null),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError('network', "Can't reach the server");
  }

  if (res.ok) {
    try {
      return (await res.json()) as unknown;
    } catch {
      throw new ApiError('network', 'Unexpected server response');
    }
  }

  // Non-2xx: prefer the contract's {error} code, fall back on the status.
  let code: ApiErrorCode = res.status === 401 ? 'unauthorized' : 'network';
  try {
    const parsed = errorBodySchema.safeParse(await res.json());
    if (parsed.success) code = serverErrorCode(parsed.data.error) ?? code;
  } catch {
    // Body wasn't JSON — keep the status-derived code.
  }
  throw new ApiError(code);
}

/** Validate a payload; a malformed body is indistinguishable from a bad server. */
function parseAs<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ApiError('network', 'Unexpected server response');
  return parsed.data;
}

// ── Endpoints (see AUTH API CONTRACT) ─────────────────────────

export async function register(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<AuthSession> {
  const data = await request({ method: 'POST', path: '/api/auth/register', body: input });
  return parseAs(sessionSchema, data);
}

export async function login(input: { email: string; password: string }): Promise<AuthSession> {
  const data = await request({ method: 'POST', path: '/api/auth/login', body: input });
  return parseAs(sessionSchema, data);
}

/**
 * Exchange a Google ID token (from expo-auth-session) for a session.
 * Throws 'not_configured' until the server has GOOGLE_CLIENT_ID set.
 */
export async function loginWithGoogle(idToken: string): Promise<AuthSession> {
  const data = await request({ method: 'POST', path: '/api/auth/google', body: { idToken } });
  return parseAs(sessionSchema, data);
}

export async function me(token: string): Promise<AuthUser> {
  const data = await request({ method: 'GET', path: '/api/me', token });
  return parseAs(meSchema, data).user;
}

export async function logout(token: string): Promise<void> {
  const data = await request({ method: 'POST', path: '/api/auth/logout', token });
  parseAs(okSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Buddy Sync (see BUDDY API CONTRACT) — appended section.
// Same philosophy as auth: zod at the boundary, typed error codes,
// and network failures must never block the UI (screens keep the
// last known state and retry quietly).
// ════════════════════════════════════════════════════════════════

export type BuddyErrorCode =
  | 'not_found'
  | 'invalid'
  | 'already_linked'
  | 'buddy_limit'
  | 'nudge_limit'
  | 'tier_mismatch'
  | 'trial_used'
  | 'forbidden'
  | 'unauthorized'
  | 'network';

export class BuddyApiError extends Error {
  readonly code: BuddyErrorCode;

  constructor(code: BuddyErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'BuddyApiError';
    this.code = code;
  }
}

/** Narrow an unknown thrown value to BuddyApiError (anything else = network). */
export function toBuddyError(err: unknown): BuddyApiError {
  return err instanceof BuddyApiError ? err : new BuddyApiError('network');
}

// ── Buddy schemas ─────────────────────────────────────────────

const buddyUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string(),
});

export type BuddyUser = z.infer<typeof buddyUserSchema>;

const buddyLinkSchema = z.object({ linkId: z.string(), buddy: buddyUserSchema });

export type BuddyLink = z.infer<typeof buddyLinkSchema>;

const buddyListSchema = z.object({
  accepted: z.array(buddyLinkSchema),
  pendingIn: z.array(buddyLinkSchema),
  pendingOut: z.array(buddyLinkSchema),
});

export type BuddyList = z.infer<typeof buddyListSchema>;

export type BuddyActivityType = 'workout_completed' | 'pr';

const buddyEventPayloadSchema = z.object({
  name: z.string().optional(),
  date: z.string().optional(),
  durationSec: z.number().optional(),
  volumeKg: z.number().optional(),
  prCount: z.number().optional(),
  /** live_session events carry the workout name here. */
  sessionName: z.string().optional(),
});

export type BuddyEventPayload = z.infer<typeof buddyEventPayloadSchema>;

const buddyEventSchema = z.object({
  id: z.string(),
  actor: z.object({ id: z.string(), displayName: z.string() }),
  type: z.enum(['workout_completed', 'pr', 'nudge', 'live_session']),
  // Lenient: nudge events may ship a null/absent payload.
  payload: buddyEventPayloadSchema.nullish(),
  createdAt: z.string(),
});

export type BuddyEvent = z.infer<typeof buddyEventSchema>;

/**
 * Resilient feed: the server appends new activity types over time (a
 * 'live_session' row once broke EVERY feed fetch and with it the whole
 * Buddy tab). Unknown/malformed events are dropped instead of failing
 * the entire response.
 */
const buddyFeedSchema = z.object({
  events: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): BuddyEvent[] => {
      const parsed = buddyEventSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

// ── Buddy fetch plumbing ──────────────────────────────────────

function buddyServerErrorCode(raw: string): BuddyErrorCode | null {
  return raw === 'not_found' ||
    raw === 'invalid' ||
    raw === 'already_linked' ||
    raw === 'buddy_limit' ||
    raw === 'nudge_limit' ||
    raw === 'tier_mismatch' ||
    raw === 'trial_used'
    ? (raw as BuddyErrorCode)
    : null;
}

interface BuddyRequestOptions {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  token: string;
  body?: Record<string, unknown>;
}

/** Buddy request; resolves with parsed JSON (or null for empty 2xx bodies). */
async function buddyRequest(opts: BuddyRequestOptions): Promise<unknown> {
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
    throw new BuddyApiError('network', "Can't reach the server");
  }

  if (res.ok) {
    // Several buddy endpoints 200/201 without a documented body.
    try {
      return (await res.json()) as unknown;
    } catch {
      return null;
    }
  }

  let code: BuddyErrorCode =
    res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : 'network';
  try {
    const parsed = errorBodySchema.safeParse(await res.json());
    if (parsed.success) code = buddyServerErrorCode(parsed.data.error) ?? code;
  } catch {
    // Body wasn't JSON — keep the status-derived code.
  }
  throw new BuddyApiError(code);
}

/** Like parseAs, but throws the buddy-typed error (and tolerates transforms). */
function parseBuddy<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new BuddyApiError('network', 'Unexpected server response');
  return parsed.data;
}

// ── Buddy endpoints ───────────────────────────────────────────

/**
 * Invite a friend by email. The 201 body ({link}) isn't consumed by the
 * app, so it's deliberately not validated — only errors matter here.
 */
export async function inviteBuddy(token: string, email: string): Promise<void> {
  await buddyRequest({ method: 'POST', path: '/api/buddy/invite', token, body: { email } });
}

export async function getBuddies(token: string): Promise<BuddyList> {
  const data = await buddyRequest({ method: 'GET', path: '/api/buddy', token });
  return parseBuddy(buddyListSchema, data);
}

export async function respondToBuddy(
  token: string,
  linkId: string,
  accept: boolean,
): Promise<void> {
  await buddyRequest({ method: 'POST', path: '/api/buddy/respond', token, body: { linkId, accept } });
}

/** Unlink an accepted buddy or cancel a pending outgoing invite. */
export async function removeBuddy(token: string, linkId: string): Promise<void> {
  await buddyRequest({ method: 'DELETE', path: `/api/buddy/${linkId}`, token });
}

export async function getBuddyFeed(token: string): Promise<BuddyEvent[]> {
  const data = await buddyRequest({ method: 'GET', path: '/api/buddy/feed', token });
  return parseBuddy(buddyFeedSchema, data).events;
}

/** Throws BuddyApiError 'nudge_limit' when today's nudge is already spent. */
export async function nudgeBuddy(token: string, linkId: string): Promise<void> {
  await buddyRequest({ method: 'POST', path: '/api/buddy/nudge', token, body: { linkId } });
}

export async function publishBuddyActivity(
  token: string,
  type: BuddyActivityType,
  payload: BuddyEventPayload,
): Promise<void> {
  await buddyRequest({ method: 'POST', path: '/api/buddy/activity', token, body: { type, payload } });
}

/**
 * Fire-and-forget publish for the training finish flow. Swallows every
 * failure — buddy sync must NEVER block or break finishing a workout
 * (the local log already succeeded; buddies just won't see this one).
 */
export async function publishWorkoutActivity(
  token: string,
  payload: {
    name: string;
    date: string;
    durationSec: number;
    volumeKg: number;
    prCount: number;
  },
): Promise<void> {
  try {
    await publishBuddyActivity(token, 'workout_completed', payload);
  } catch {
    // Intentionally silent.
  }
}

// ════════════════════════════════════════════════════════════════
// Buddy Live Sessions, Referrals & Trials
// ════════════════════════════════════════════════════════════════

export type BuddyTier = 'starter' | 'silver' | 'gold' | 'elite';

const buddySessionSchema = z.object({
  id: z.string(),
  host: z.object({ id: z.string(), displayName: z.string(), tier: z.string() }),
  workoutName: z.string(),
  status: z.string(),
  startedAt: z.string(),
});

export type BuddySession = z.infer<typeof buddySessionSchema>;

const buddySessionListSchema = z.object({ sessions: z.array(buddySessionSchema) });

/**
 * POST /api/buddy/sessions responds `{ session }`. Older deploys omit
 * `host`/`status`, so only the always-present fields are required — the
 * screen reloads the full list right after anyway.
 */
const startedSessionSchema = z.object({
  session: z.object({
    id: z.string(),
    workoutName: z.string(),
    startedAt: z.string(),
  }),
});

export type StartedBuddySession = z.infer<typeof startedSessionSchema>['session'];

/** Get active live sessions: accepted buddies' plus your own. */
export async function getBuddySessions(token: string): Promise<BuddySession[]> {
  const data = await buddyRequest({ method: 'GET', path: '/api/buddy/sessions', token });
  return parseBuddy(buddySessionListSchema, data).sessions;
}

/** Start a live workout session. */
export async function startBuddySession(
  token: string,
  workoutName: string,
): Promise<StartedBuddySession> {
  const data = await buddyRequest({
    method: 'POST',
    path: '/api/buddy/sessions',
    token,
    body: { workoutName },
  });
  return parseBuddy(startedSessionSchema, data).session;
}

/** End a live session (host only). */
export async function endBuddySession(token: string, sessionId: string): Promise<void> {
  await buddyRequest({ method: 'DELETE', path: `/api/buddy/sessions/${sessionId}`, token });
}

/** Join a buddy's live session (requires same tier). */
export async function joinBuddySession(token: string, sessionId: string): Promise<void> {
  await buddyRequest({ method: 'POST', path: `/api/buddy/sessions/${sessionId}/join`, token });
}

// ── Referrals ─────────────────────────────────────────────────

export type ReferralStatus = 'pending' | 'joined' | 'rewarded';

const referralSchema = z.object({
  id: z.string(),
  inviteeEmail: z.string(),
  status: z.enum(['pending', 'joined', 'rewarded']),
  createdAt: z.string(),
  rewardedAt: z.string().nullable().optional(),
});

export type Referral = z.infer<typeof referralSchema>;

const referralListSchema = z.object({ referrals: z.array(referralSchema) });

/** Get this user's referrals. */
export async function getReferrals(token: string): Promise<Referral[]> {
  const data = await buddyRequest({ method: 'GET', path: '/api/buddy/referrals', token });
  return parseBuddy(referralListSchema, data).referrals;
}

/** Create a referral invite for a friend's email. */
export async function createReferral(token: string, inviteeEmail: string): Promise<void> {
  await buddyRequest({
    method: 'POST',
    path: '/api/buddy/referrals',
    token,
    body: { inviteeEmail },
  });
}

// ── Trial ─────────────────────────────────────────────────────

export type TrialTier = 'silver' | 'gold' | 'elite';

const trialSchema = z.object({
  tier: z.enum(['silver', 'gold', 'elite']),
  startedAt: z.string(),
  expiresAt: z.string(),
  active: z.boolean(),
});

export type Trial = z.infer<typeof trialSchema>;

const trialListSchema = z.object({
  trials: z.array(trialSchema),
  trialDays: z.number(),
});

export interface TrialStatus {
  trials: Trial[];
  trialDays: number;
}

/** Get trial status for this account. */
export async function getTrialStatus(token: string): Promise<TrialStatus> {
  const data = await buddyRequest({ method: 'GET', path: '/api/buddy/trial', token });
  return parseBuddy(trialListSchema, data);
}

/** Start a 2-day trial for a tier (one-time per tier). */
export async function startTrial(token: string, tier: TrialTier): Promise<void> {
  await buddyRequest({ method: 'POST', path: '/api/buddy/trial', token, body: { tier } });
}

// ── Cloud profile backup ──────────────────────────────────────

const profileGetSchema = z.object({
  profile: z.record(z.string(), z.unknown()).nullable(),
});

/** The account's saved profile blob, or null for a brand-new account. */
export async function getProfileData(
  token: string,
): Promise<Record<string, unknown> | null> {
  const data = await request({ method: 'GET', path: '/api/profile', token });
  return profileGetSchema.parse(data).profile;
}

/** Upsert the profile blob (the app's profile store owns the shape). */
export async function putProfileData(
  token: string,
  profile: Record<string, unknown>,
): Promise<void> {
  await request({ method: 'PUT', path: '/api/profile', token, body: { profile } });
}

// ── Push token registration ───────────────────────────────────

/**
 * Register this device's Expo push token so the server can deliver buddy
 * pushes (channelId 'default'). Fire-and-forget from the caller's side:
 * the 200 `{ok:true}` body isn't consumed, so only auth failures propagate
 * (the caller in notifications.ts swallows them). Throws ApiError on a
 * non-2xx / network failure, matching the rest of this client.
 */
export async function registerPushToken(
  token: string,
  platform: 'ios' | 'android',
  authToken: string,
): Promise<void> {
  await request({
    method: 'POST',
    path: '/api/push/register',
    body: { token, platform },
    token: authToken,
  });
}

// ════════════════════════════════════════════════════════════════
// Elite coach messaging (see COACH API CONTRACT)
// Two async threads per account, split by `kind`. Same philosophy as
// the rest of this client: zod at the boundary, typed error codes, and
// network failures NEVER block the UI (the thread keeps its last-known
// state and retries quietly). 'forbidden' means the account isn't Elite.
// ════════════════════════════════════════════════════════════════

export type CoachThreadKind = 'coach_chat' | 'support';

export type CoachErrorCode = 'forbidden' | 'invalid' | 'unauthorized' | 'network';

export class CoachApiError extends Error {
  readonly code: CoachErrorCode;

  constructor(code: CoachErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CoachApiError';
    this.code = code;
  }
}

/** Narrow an unknown thrown value to CoachApiError (anything else = network). */
export function toCoachError(err: unknown): CoachApiError {
  return err instanceof CoachApiError ? err : new CoachApiError('network');
}

const coachMessageSchema = z.object({
  id: z.string(),
  kind: z.enum(['coach_chat', 'support']),
  sender: z.enum(['user', 'coach']),
  body: z.string(),
  createdAt: z.string(),
  readByUser: z.boolean(),
});

export type CoachMessage = z.infer<typeof coachMessageSchema>;

/**
 * Resilient list: if the server ever grows a new sender/kind the whole thread
 * shouldn't blank out — drop unparseable rows instead of failing the fetch.
 */
const coachMessagesSchema = z.object({
  messages: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): CoachMessage[] => {
      const parsed = coachMessageSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

interface CoachRequestOptions {
  method: 'GET' | 'POST';
  path: string;
  token: string;
  body?: Record<string, unknown>;
}

/** Coach request; resolves with parsed JSON of a 2xx response. */
async function coachRequest(opts: CoachRequestOptions): Promise<unknown> {
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
    throw new CoachApiError('network', "Can't reach the server");
  }

  if (res.ok) {
    try {
      return (await res.json()) as unknown;
    } catch {
      throw new CoachApiError('network', 'Unexpected server response');
    }
  }

  let code: CoachErrorCode =
    res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : 'network';
  try {
    const parsed = errorBodySchema.safeParse(await res.json());
    if (parsed.success && parsed.data.error === 'invalid') code = 'invalid';
  } catch {
    // Body wasn't JSON — keep the status-derived code.
  }
  throw new CoachApiError(code);
}

function parseCoach<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new CoachApiError('network', 'Unexpected server response');
  return parsed.data;
}

/** Load a thread (oldest → newest). Any signed-in tier can read its history. */
export async function getCoachMessages(
  kind: CoachThreadKind,
  token: string,
): Promise<CoachMessage[]> {
  const data = await coachRequest({
    method: 'GET',
    path: `/api/coach/messages?kind=${encodeURIComponent(kind)}`,
    token,
  });
  return parseCoach(coachMessagesSchema, data).messages;
}

/**
 * Send a message. ELITE ONLY — throws CoachApiError 'forbidden' for any lower
 * tier. Returns the inserted [userMessage, coachReply] pair so the UI can
 * reconcile its optimistic append with the server's real rows.
 *
 * `coachReply` is the on-device AI Greece reply (generated with the bundled
 * EXPO_PUBLIC_GROQ_API_KEY). When present the server stores it verbatim; when
 * omitted (generation failed / offline) the server falls back to its own Groq
 * reply or the canned auto-ack, so the thread is never left hanging.
 */
export async function sendCoachMessage(
  kind: CoachThreadKind,
  body: string,
  token: string,
  coachReply?: string,
): Promise<CoachMessage[]> {
  const trimmedReply = coachReply?.trim();
  const data = await coachRequest({
    method: 'POST',
    path: '/api/coach/messages',
    token,
    body:
      trimmedReply && trimmedReply.length > 0
        ? { kind, body, coachReply: trimmedReply }
        : { kind, body },
  });
  return parseCoach(coachMessagesSchema, data).messages;
}
