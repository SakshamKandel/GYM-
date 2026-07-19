import { z } from 'zod';
import {
  ACCOUNT_DELETION_BLOCKER_CODES,
  type AccountDeletionImpact,
  type Tier,
} from '@gym/shared';

/**
 * Auth API client — tiny typed fetch wrapper for the GM Method backend.
 *
 * Accounts are OPTIONAL (local-first app); this client only powers cloud
 * sync / subscriptions. Every payload is zod-validated at the boundary
 * (CLAUDE.md rule 8) and every failure surfaces as a typed `ApiError`
 * code so screens never string-match server messages.
 */

/**
 * API base URL. Exported so sibling clients (e.g. features/staff/api.ts) build
 * their own request plumbing against the SAME host without re-reading the env.
 */
export const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export type ApiErrorCode =
  | 'email_taken'
  | 'bad_credentials'
  /** Google sign-in hit an email that already has a password account — retry with `password` to link. */
  | 'link_required'
  | 'invalid'
  | 'network'
  | 'unauthorized'
  | 'not_configured'
  /** Live billing: paid tiers require a store purchase, not a self-serve pick. */
  | 'billing_required'
  /** 403 — signed in, but not allowed (e.g. a non-coach reserving a coach-only upload kind). */
  | 'forbidden'
  /** POST /api/promo/redeem: the code doesn't exist, is inactive, or is the caller's own coach code. */
  | 'invalid_code'
  /** POST /api/promo/redeem: this account already redeemed that code. */
  | 'already_used'
  /** POST /api/promo/redeem: past its window or redemption cap. */
  | 'expired'
  /** POST /api/uploads/image: the image host (Cloudinary) isn't configured server-side. */
  | 'image_not_configured'
  /** POST /api/payments/requests: another request is still awaiting review. */
  | 'already_pending'
  /** POST /api/payments/requests: the uploaded receipt already funded a request. */
  | 'receipt_already_used'
  | 'account_deletion_blocked'
  | 'confirmation_required'
  | 'private_asset_cleanup_pending'
  | 'account_deletion_conflict';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly deletionImpact: AccountDeletionImpact | null;

  constructor(
    code: ApiErrorCode,
    message?: string,
    deletionImpact: AccountDeletionImpact | null = null,
  ) {
    super(message ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.deletionImpact = deletionImpact;
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
const deletionBlockerCodeSchema = z.enum(ACCOUNT_DELETION_BLOCKER_CODES);
const accountDeletionImpactSchema: z.ZodType<AccountDeletionImpact> = z.object({
  canDelete: z.boolean(),
  blockers: z.array(
    z.object({
      code: deletionBlockerCodeSchema,
      count: z.number().int().nonnegative(),
    }),
  ),
  retainedHistory: z.object({
    mealOrders: z.number().int().nonnegative(),
    mealSubscriptions: z.number().int().nonnegative(),
    mealPaymentRequests: z.number().int().nonnegative(),
    membershipPaymentRequests: z.number().int().nonnegative(),
    promoRedemptions: z.number().int().nonnegative(),
    discountGrants: z.number().int().nonnegative(),
    coachPayoutRequests: z.number().int().nonnegative(),
    walletLedgerEntries: z.number().int().nonnegative(),
  }),
});
const errorBodySchema = z.object({
  error: z.string(),
  impact: accountDeletionImpactSchema.optional(),
});

// ── Fetch plumbing ────────────────────────────────────────────

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
  token?: string;
}

function serverErrorCode(raw: string): ApiErrorCode | null {
  return raw === 'email_taken' ||
    raw === 'bad_credentials' ||
    raw === 'link_required' ||
    raw === 'invalid' ||
    raw === 'not_configured' ||
    raw === 'billing_required' ||
    raw === 'forbidden' ||
    raw === 'invalid_code' ||
    raw === 'already_used' ||
    raw === 'expired' ||
    raw === 'image_not_configured' ||
    raw === 'already_pending' ||
    raw === 'receipt_already_used' ||
    raw === 'account_deletion_blocked' ||
    raw === 'confirmation_required' ||
    raw === 'private_asset_cleanup_pending' ||
    raw === 'account_deletion_conflict'
    ? raw
    : null;
}

/**
 * Every call gives up after this long. Without a bound, a hung connection
 * can freeze flows that await the network — sign-out once sat on
 * "Signing out…" forever because of exactly this.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * fetch with a timeout; the abort surfaces as a rejection the callers already
 * map to their typed 'network' errors. Exported so sibling clients
 * (features/staff/api.ts, features/staff/supportApi.ts) share the same
 * hang-proofing instead of issuing bare `fetch` calls (defect H1/H2/H4).
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Perform the request; resolve with the parsed JSON of a 2xx response. */
async function request(opts: RequestOptions): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE_URL}${opts.path}`, {
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
  let deletionImpact: AccountDeletionImpact | null = null;
  try {
    const parsed = errorBodySchema.safeParse(await res.json());
    if (parsed.success) {
      code = serverErrorCode(parsed.data.error) ?? code;
      deletionImpact = parsed.data.impact ?? null;
    }
  } catch {
    // Body wasn't JSON — keep the status-derived code.
  }
  throw new ApiError(code, undefined, deletionImpact);
}

/** Validate a payload; a malformed body is indistinguishable from a bad server. */
function parseAs<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ApiError('network', 'Unexpected server response');
  return parsed.data;
}

/** Like parseAs, but for resilient-list schemas whose `.transform()` changes
 * the input type (z.array(z.unknown()).transform(...)) — parseAs's stricter
 * z.ZodType<T> can't type-check those. */
function parseAsResilient<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
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
 * Throws 'link_required' when the email already belongs to a password
 * account — retry with that account's `password` to link Google onto it
 * (both sign-in methods then open the SAME account).
 */
export async function loginWithGoogle(
  idToken: string,
  password?: string,
): Promise<AuthSession> {
  const data = await request({
    method: 'POST',
    path: '/api/auth/google',
    body: password === undefined ? { idToken } : { idToken, password },
  });
  return parseAs(sessionSchema, data);
}

export async function me(token: string): Promise<AuthUser> {
  const data = await request({ method: 'GET', path: '/api/me', token });
  return parseAs(meSchema, data).user;
}

const healthSchema = z.object({ ok: z.literal(true), app: z.literal('gym-tracker') });

/**
 * True only when GET /api/health identifies the host as the real GYM Tracker
 * server. In dev, BASE_URL is a LAN host:port — if another app ever squats
 * that port, its blanket 401s must not read as "session revoked" (a foreign
 * 401 once signed users out — see state/auth.ts refresh()). Returns false on
 * any failure: "couldn't confirm identity", and the caller keeps the session
 * rather than wiping a valid one.
 */
export async function confirmGymTrackerServer(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      `${BASE_URL}/api/health`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      4_000,
    );
    if (!res.ok) return false;
    return healthSchema.safeParse(await res.json()).success;
  } catch {
    return false;
  }
}

export async function logout(token: string): Promise<void> {
  const data = await request({ method: 'POST', path: '/api/auth/logout', token });
  parseAs(okSchema, data);
}

/**
 * Set the account's subscription tier SERVER-SIDE (the paywall's "Choose
 * plan"). The server is the tier authority — PUT /api/profile no longer
 * writes accounts.tier — so gated features stay locked until this returns.
 * Resolves with the updated user (same shape as GET /api/me) so the caller
 * can adopt it into the auth store immediately, no extra round trip.
 */
export async function setSubscriptionTier(token: string, tier: Tier): Promise<AuthUser> {
  const data = await request({
    method: 'POST',
    path: '/api/subscription/tier',
    body: { tier },
    token,
  });
  return parseAs(meSchema, data).user;
}

/**
 * Permanently delete an eligible signed-in account. The typed confirmation is
 * enforced by the API, not just the screen. Operational/offboarding/retention
 * blockers surface as `ApiError.deletionImpact` and nothing is deleted.
 */
export async function deleteAccount(token: string, confirmation: string): Promise<void> {
  const data = await request({
    method: 'DELETE',
    path: '/api/me',
    token,
    body: { confirmation },
  });
  parseAs(okSchema, data);
}

/**
 * Revoke EVERY session for this account (sign out on all devices), including
 * the one making the call. Throws ApiError on failure so the caller can tell
 * the user their other devices are still signed in.
 */
export async function logoutAll(token: string): Promise<void> {
  const data = await request({ method: 'POST', path: '/api/auth/logout-all', token });
  parseAs(okSchema, data);
}

// ════════════════════════════════════════════════════════════════
// Referrals ("Invite friends") & tier trials — appended section.
// Same philosophy as auth: zod at the boundary, typed error codes,
// and network failures must never block the UI (screens keep the
// last known state and retry quietly). Both endpoints still live
// under /api/buddy/* server-side for wire-compat with deployed
// clients; the buddy feature itself is gone.
// ════════════════════════════════════════════════════════════════

export type RewardsErrorCode =
  | 'invalid'
  /** Referrals: you already invited this email yourself. */
  | 'already_linked'
  /** Referrals: the invited email already belongs to an existing account. */
  | 'already_enrolled'
  /** Trial: this tier's one-time trial is already spent. */
  | 'trial_used'
  /** Trial: the requested tier isn't above the account's current tier. */
  | 'not_an_upgrade'
  | 'forbidden'
  | 'unauthorized'
  | 'network';

export class RewardsApiError extends Error {
  readonly code: RewardsErrorCode;

  constructor(code: RewardsErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RewardsApiError';
    this.code = code;
  }
}

/** Narrow an unknown thrown value to RewardsApiError (anything else = network). */
export function toRewardsError(err: unknown): RewardsApiError {
  return err instanceof RewardsApiError ? err : new RewardsApiError('network');
}

// ── Rewards fetch plumbing ────────────────────────────────────

function rewardsServerErrorCode(raw: string): RewardsErrorCode | null {
  return raw === 'invalid' ||
    raw === 'already_linked' ||
    raw === 'already_enrolled' ||
    raw === 'trial_used' ||
    raw === 'not_an_upgrade'
    ? (raw as RewardsErrorCode)
    : null;
}

interface RewardsRequestOptions {
  method: 'GET' | 'POST';
  path: string;
  token: string;
  body?: Record<string, unknown>;
}

/** Rewards request; resolves with parsed JSON (or null for empty 2xx bodies). */
async function rewardsRequest(opts: RewardsRequestOptions): Promise<unknown> {
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
    throw new RewardsApiError('network', "Can't reach the server");
  }

  if (res.ok) {
    // Some endpoints 200/201 without a documented body.
    try {
      return (await res.json()) as unknown;
    } catch {
      return null;
    }
  }

  let code: RewardsErrorCode =
    res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : 'network';
  try {
    const parsed = errorBodySchema.safeParse(await res.json());
    if (parsed.success) code = rewardsServerErrorCode(parsed.data.error) ?? code;
  } catch {
    // Body wasn't JSON — keep the status-derived code.
  }
  throw new RewardsApiError(code);
}

/** Like parseAs, but throws the rewards-typed error (and tolerates transforms). */
function parseRewards<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new RewardsApiError('network', 'Unexpected server response');
  return parsed.data;
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
  const data = await rewardsRequest({ method: 'GET', path: '/api/buddy/referrals', token });
  return parseRewards(referralListSchema, data).referrals;
}

/**
 * Create a referral invite for a friend's email. Throws RewardsApiError
 * 'already_enrolled' when the email already belongs to an existing account
 * (invites are only for people new to the app) and 'already_linked' when the
 * caller already invited that email.
 */
export async function createReferral(token: string, inviteeEmail: string): Promise<void> {
  await rewardsRequest({
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
  const data = await rewardsRequest({ method: 'GET', path: '/api/buddy/trial', token });
  return parseRewards(trialListSchema, data);
}

/** Start a 2-day trial for a tier (one-time per tier). */
export async function startTrial(token: string, tier: TrialTier): Promise<void> {
  await rewardsRequest({ method: 'POST', path: '/api/buddy/trial', token, body: { tier } });
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
 * Register this device's Expo push token so the server can deliver pushes
 * (coach, support, badge — channelId 'default'). Fire-and-forget from the caller's side:
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

/**
 * Sign-out counterpart to registerPushToken: remove this device's token
 * mapping so the account signing out stops receiving pushes here. Throws
 * ApiError on failure — callers treat it as best-effort.
 */
export async function unregisterPushToken(token: string, authToken: string): Promise<void> {
  await request({
    method: 'POST',
    path: '/api/push/unregister',
    body: { token },
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
  /** Override for endpoints whose server legitimately works longer than the default. */
  timeoutMs?: number;
}

/** Coach request; resolves with parsed JSON of a 2xx response. */
async function coachRequest(opts: CoachRequestOptions): Promise<unknown> {
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
    }, opts.timeoutMs);
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
 * tier. The coach reply is generated SERVER-SIDE in Greece's voice (the Groq
 * key never ships in the app). Returns the inserted [userMessage, coachReply]
 * pair so the UI can reconcile its optimistic append with the server's rows.
 */
export async function sendCoachMessage(
  kind: CoachThreadKind,
  body: string,
  token: string,
): Promise<CoachMessage[]> {
  const data = await coachRequest({
    method: 'POST',
    path: '/api/coach/messages',
    token,
    body: { kind, body },
    // The server runs an LLM round trip before responding — the default 10s
    // deadline would abort sends the server has already persisted.
    timeoutMs: 30_000,
  });
  return parseCoach(coachMessagesSchema, data).messages;
}

// ── AI coach tips ─────────────────────────────────────────────

/** A single tip-prompt turn (built by the caller, sent to the server). */
export interface AiTipMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const aiTipSchema = z.object({ text: z.string().nullable() });

/**
 * Fetch a short AI coach tip. Generated SERVER-SIDE with the server's Groq
 * key (no key in the app bundle), so it requires a signed-in `token`. Never
 * throws — any failure (offline, signed-out server error, missing key) resolves
 * to null so the tip card degrades quietly.
 */
export async function getAiTip(messages: AiTipMessage[], token: string): Promise<string | null> {
  try {
    const data = await request({ method: 'POST', path: '/api/ai/tip', body: { messages }, token });
    return aiTipSchema.parse(data).text;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// Gated form-check playback (see PLAYBACK API CONTRACT)
// GET /api/plan-videos/[exerciseId] mints a short-lived signed HLS url for
// the exercise's coach video, gated per-tier SERVER-SIDE. The signed url is
// disposable (~2h TTL) — fetch it per playback, never cache/persist it. The
// providerVideoId is never returned. On 503/network the caller falls back to
// the bundled greeceVideos seed so playback never hard-breaks for one release.
// ════════════════════════════════════════════════════════════════

/**
 * Discriminated result of a playback lookup — the hook branches on `kind`
 * instead of catching typed errors, because 'locked' is a normal (not
 * exceptional) outcome that drives the paywall affordance.
 *
 *  - 'ok'             → play `url` (title/tierRequired for the caption/label).
 *  - 'locked'         → 403; show the "unlock with <requiredTier>" affordance.
 *  - 'not_found'      → no ready video for this exercise (fall back to seed).
 *  - 'not_configured' → provider keys absent (503); fall back to seed.
 *  - 'unavailable'    → 401/network/malformed; fall back to seed.
 */
export type PlanVideoResult =
  | { kind: 'ok'; url: string; title: string; tierRequired: Tier }
  | { kind: 'locked'; requiredTier: Tier }
  | { kind: 'not_found' }
  | { kind: 'not_configured' }
  | { kind: 'unavailable' };

const planVideoOkSchema = z.object({
  url: z.string(),
  title: z.string(),
  tierRequired: tierSchema,
});

const planVideoLockedSchema = z.object({
  error: z.literal('locked'),
  requiredTier: tierSchema,
});

/**
 * Fetch the signed playback url for an exercise's coach video.
 *
 * NEVER throws — every failure resolves to a fallback-triggering variant so
 * the video path degrades to the bundled seed instead of crashing the screen.
 * Only the 200 (playable) and 403 (locked → paywall) outcomes carry data.
 */
export async function getPlanVideo(exerciseId: string, token: string): Promise<PlanVideoResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE_URL}/api/plan-videos/${encodeURIComponent(exerciseId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
  } catch {
    return { kind: 'unavailable' };
  }

  if (res.ok) {
    try {
      const parsed = planVideoOkSchema.safeParse(await res.json());
      if (!parsed.success) return { kind: 'unavailable' };
      return { kind: 'ok', ...parsed.data };
    } catch {
      return { kind: 'unavailable' };
    }
  }

  if (res.status === 403) {
    try {
      const parsed = planVideoLockedSchema.safeParse(await res.json());
      if (parsed.success) return { kind: 'locked', requiredTier: parsed.data.requiredTier };
    } catch {
      // Body wasn't JSON — treat as unavailable so we fall back to the seed.
    }
    return { kind: 'unavailable' };
  }

  if (res.status === 404) return { kind: 'not_found' };
  if (res.status === 503) return { kind: 'not_configured' };
  // 401 (expired session) and anything else → fall back to the local seed.
  return { kind: 'unavailable' };
}

// ════════════════════════════════════════════════════════════════
// Coach-assigned workouts & diet plans (SCALE-UP-PLAN §4.3)
// GET /api/me/coach-workouts and GET /api/me/coach-diet mirror the
// plan-videos playback lookup above: a locked 403 is a normal (not
// exceptional) outcome that drives the UpgradePrompt affordance, so both
// resolve to a discriminated result instead of throwing. NEVER throws —
// any failure (offline, malformed body, unexpected status) resolves to
// 'unavailable' so the section degrades quietly instead of crashing the
// Train/Food tab.
// ════════════════════════════════════════════════════════════════

const coachInfoSchema = z.object({ id: z.string(), displayName: z.string() });
export type CoachInfo = z.infer<typeof coachInfoSchema>;

const coachWorkoutItemSchema = z.object({
  exerciseId: z.string().nullable(),
  name: z.string(),
  sets: z.number(),
  repRange: z.string(),
  restSec: z.number(),
  note: z.string().optional(),
  imageUrl: z.string().optional(),
});
export type CoachWorkoutItem = z.infer<typeof coachWorkoutItemSchema>;

const coachWorkoutRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  notes: z.string(),
  position: z.number(),
  status: z.enum(['active', 'archived']),
  items: z.array(coachWorkoutItemSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CoachWorkoutRow = z.infer<typeof coachWorkoutRowSchema>;

/** Resilient list — one unparseable row must not blank the whole section. */
const myCoachWorkoutsOkSchema = z.object({
  workouts: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): CoachWorkoutRow[] => {
      const parsed = coachWorkoutRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
  coach: coachInfoSchema.nullable(),
});

const lockedSchema = z.object({ error: z.literal('locked'), requiredTier: tierSchema });

export type MyCoachWorkoutsResult =
  | { kind: 'ok'; workouts: CoachWorkoutRow[]; coach: CoachInfo | null }
  | { kind: 'locked'; requiredTier: Tier }
  | { kind: 'unavailable' };

/** GET /api/me/coach-workouts → the Train tab's "From your coach" section. */
export async function getMyCoachWorkouts(token: string): Promise<MyCoachWorkoutsResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE_URL}/api/me/coach-workouts`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
  } catch {
    return { kind: 'unavailable' };
  }

  if (res.ok) {
    try {
      const parsed = myCoachWorkoutsOkSchema.safeParse(await res.json());
      if (!parsed.success) return { kind: 'unavailable' };
      return { kind: 'ok', ...parsed.data };
    } catch {
      return { kind: 'unavailable' };
    }
  }

  if (res.status === 403) {
    try {
      const parsed = lockedSchema.safeParse(await res.json());
      if (parsed.success) return { kind: 'locked', requiredTier: parsed.data.requiredTier };
    } catch {
      // Body wasn't JSON — fall through to unavailable.
    }
    return { kind: 'unavailable' };
  }

  // 401 (expired session) and anything else → the section just stays hidden.
  return { kind: 'unavailable' };
}

const coachDietItemSchema = z.object({
  name: z.string(),
  qty: z.string(),
  kcal: z.number().optional(),
  protein: z.number().optional(),
  carbs: z.number().optional(),
  fat: z.number().optional(),
  note: z.string().optional(),
});
export type CoachDietItem = z.infer<typeof coachDietItemSchema>;

const coachDietMealSchema = z.object({
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snacks']),
  items: z.array(coachDietItemSchema),
});
export type CoachDietMeal = z.infer<typeof coachDietMealSchema>;

const coachDietPlanRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  notes: z.string(),
  status: z.enum(['active', 'archived']),
  meals: z.array(coachDietMealSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CoachDietPlanRow = z.infer<typeof coachDietPlanRowSchema>;

/** Resilient list — one unparseable row must not blank the whole screen. */
const myCoachDietOkSchema = z.object({
  plans: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): CoachDietPlanRow[] => {
      const parsed = coachDietPlanRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
  coach: coachInfoSchema.nullable(),
});

export type MyCoachDietResult =
  | { kind: 'ok'; plans: CoachDietPlanRow[]; coach: CoachInfo | null }
  | { kind: 'locked'; requiredTier: Tier }
  | { kind: 'unavailable' };

/** GET /api/me/coach-diet → the Food tab's "Coach diet plan" card / screen. */
export async function getMyCoachDiet(token: string): Promise<MyCoachDietResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE_URL}/api/me/coach-diet`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
  } catch {
    return { kind: 'unavailable' };
  }

  if (res.ok) {
    try {
      const parsed = myCoachDietOkSchema.safeParse(await res.json());
      if (!parsed.success) return { kind: 'unavailable' };
      return { kind: 'ok', ...parsed.data };
    } catch {
      return { kind: 'unavailable' };
    }
  }

  if (res.status === 403) {
    try {
      const parsed = lockedSchema.safeParse(await res.json());
      if (parsed.success) return { kind: 'locked', requiredTier: parsed.data.requiredTier };
    } catch {
      // Body wasn't JSON — fall through to unavailable.
    }
    return { kind: 'unavailable' };
  }

  return { kind: 'unavailable' };
}

// ════════════════════════════════════════════════════════════════
// Regional pricing catalog, promo codes, payment requests & image
// uploads (SCALE-UP-PLAN §4.1 / §4.2 / §4.5). Same philosophy as the
// rest of this client: zod at the boundary, typed ApiError codes.
// ════════════════════════════════════════════════════════════════

export type PriceRegion = 'NP' | 'INTL';

const catalogTierSchema = z.object({
  tier: tierSchema,
  /** Pre-discount catalog price, minor units. */
  amountMinor: z.number(),
  /** Present only when the account has an active discount grant. */
  discountedMinor: z.number().optional(),
  discountPct: z.number().optional(),
  discountSource: z.enum(['referral', 'promo']).optional(),
});
export type CatalogTier = z.infer<typeof catalogTierSchema>;

const catalogSchema = z.object({
  region: z.enum(['NP', 'INTL']),
  currency: z.string(),
  tiers: z.array(catalogTierSchema),
  trialDays: z.number(),
});
export type SubscriptionCatalog = z.infer<typeof catalogSchema>;

/**
 * GET /api/subscription/catalog?region= → regional pricing + this account's
 * best active discount. `region` is a raw ISO-3166 alpha-2 hint (e.g. from
 * expo-localization) — the server clamps it to NP/INTL and persists it onto
 * the account for next time. Requires a signed-in `token`.
 */
export async function getSubscriptionCatalog(
  token: string,
  region?: string,
): Promise<SubscriptionCatalog> {
  const query = region ? `?region=${encodeURIComponent(region)}` : '';
  const data = await request({
    method: 'GET',
    path: `/api/subscription/catalog${query}`,
    token,
  });
  return parseAs(catalogSchema, data);
}

const promoRedeemSchema = z.object({ code: z.string(), discountPct: z.number() });
export type PromoRedeemResult = z.infer<typeof promoRedeemSchema>;

/**
 * POST /api/promo/redeem {code} → apply a promo code to this account. Throws
 * ApiError with code 'invalid_code' | 'already_used' | 'expired' | 'unauthorized'
 * on failure (uniform codes — the response never confirms code ownership).
 */
export async function redeemPromoCode(token: string, code: string): Promise<PromoRedeemResult> {
  const data = await request({
    method: 'POST',
    path: '/api/promo/redeem',
    body: { code },
    token,
  });
  return parseAs(promoRedeemSchema, data);
}

// ── Nepal manual payments (eSewa/Khalti/bank) ─────────────────

export type PaymentMethod = 'esewa' | 'khalti' | 'bank' | 'other';
/** Only paid tiers may be purchased this way — 'starter' is always free. */
export type PayableTier = 'silver' | 'gold' | 'elite';

const paymentMethodSchema = z.enum(['esewa', 'khalti', 'bank', 'other']);
const paymentStatusSchema = z.enum(['pending', 'approved', 'rejected']);

export interface PaymentRequestInput {
  tier: PayableTier;
  months: 1 | 3 | 12;
  method: PaymentMethod;
  /** The `uid` returned by POST /api/uploads/image {kind:'payment_receipt'}. */
  receiptUrl: string;
  note?: string;
  region?: string;
}

const createdPaymentRequestSchema = z.object({
  id: z.string(),
  status: z.literal('pending'),
  amountMinor: z.number(),
  currency: z.string(),
});
export type CreatedPaymentRequest = z.infer<typeof createdPaymentRequestSchema>;

/**
 * POST /api/payments/requests → submit a manual-payment receipt for review.
 * The amount is computed SERVER-side from the live catalog (with any active
 * discount applied) — never trusted from the client.
 */
export async function submitPaymentRequest(
  input: PaymentRequestInput,
  token: string,
): Promise<CreatedPaymentRequest> {
  const data = await request({
    method: 'POST',
    path: '/api/payments/requests',
    token,
    body: { ...input },
  });
  return parseAs(createdPaymentRequestSchema, data);
}

const paymentRequestRowSchema = z.object({
  id: z.string(),
  tier: tierSchema,
  months: z.number(),
  amountMinor: z.number(),
  currency: z.string(),
  method: paymentMethodSchema,
  status: paymentStatusSchema,
  reviewNote: z.string().nullable(),
  createdAt: z.string(),
});
export type PaymentRequestRow = z.infer<typeof paymentRequestRowSchema>;

/** Resilient list: an unparseable row is dropped rather than failing the fetch. */
const paymentRequestListSchema = z.object({
  requests: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): PaymentRequestRow[] => {
      const parsed = paymentRequestRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/** GET /api/payments/requests → the caller's own request history, newest first. */
export async function getPaymentRequests(token: string): Promise<PaymentRequestRow[]> {
  const data = await request({ method: 'GET', path: '/api/payments/requests', token });
  return parseAsResilient(paymentRequestListSchema, data).requests;
}

// ── Image uploads (direct-to-Cloudinary, mirrors createVideo's handshake) ──

export type ImageUploadKind =
  | 'progress_photo'
  | 'payment_receipt'
  | 'application_avatar'
  | 'coach_avatar'
  | 'custom_exercise'
  | 'diet_item'
  /** Meal-delivery eSewa/Khalti receipt (plan §3/§8 P12) — always authenticated
   * access, never public; validated server-side against its exact uid shape. */
  | 'meal_receipt';

const imageUploadReservationSchema = z.object({
  uploadUrl: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
  uid: z.string(),
  /** Present only for 'public'-access kinds (avatars, exercise/diet images). */
  deliveryUrl: z.string().optional(),
});
export type ImageUploadReservation = z.infer<typeof imageUploadReservationSchema>;

/**
 * POST /api/uploads/image {kind} → reserve a direct-creator IMAGE upload slot.
 * 'forbidden' when `kind` requires a coach role the caller doesn't hold;
 * 'image_not_configured' (503) when the image host isn't set up server-side.
 */
export async function reserveImageUpload(
  token: string,
  kind: ImageUploadKind,
): Promise<ImageUploadReservation> {
  const data = await request({
    method: 'POST',
    path: '/api/uploads/image',
    token,
    body: { kind },
  });
  return parseAs(imageUploadReservationSchema, data);
}

/** Minimal file descriptor RN's FormData accepts as a multipart part. */
export interface PickedFile {
  uri: string;
  name: string;
  type: string;
}

/**
 * Uploads picked file bytes straight to a reserved `uploadUrl` (bytes never
 * pass through our API) — the same multipart handshake
 * features/staff/api.ts's createVideo flow uses: every `fields` entry first,
 * then the file under `file`. Throws ApiError('network') on any transport or
 * host failure so the caller can retry without re-reserving.
 *
 * Uses a long (90s) timeout rather than the default 10s — a stalled Cloudinary
 * upload must eventually surface as a retryable failure instead of wedging the
 * avatar/receipt/photo flow forever (defect H4).
 */
const UPLOAD_TIMEOUT_MS = 90_000;

export async function uploadImageAsset(
  reservation: ImageUploadReservation,
  file: PickedFile,
): Promise<void> {
  const form = new FormData();
  if (reservation.fields) {
    for (const [key, value] of Object.entries(reservation.fields)) form.append(key, value);
  }
  form.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);

  let res: Response;
  try {
    res = await fetchWithTimeout(
      reservation.uploadUrl,
      { method: 'POST', body: form },
      UPLOAD_TIMEOUT_MS,
    );
  } catch {
    throw new ApiError('network', "Couldn't reach the upload host");
  }
  if (!res.ok) throw new ApiError('network', 'The file upload failed');
  await res.json().catch(() => null);
}
