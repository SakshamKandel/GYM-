import { z } from 'zod';
import { supportsRail, type Payee } from './payeeLogic';
import {
  ACCOUNT_DELETION_BLOCKER_CODES,
  aiTipOutcome,
  aiTipResponseSchema,
  appleAuthNonceResponseSchema,
  appleAuthRequestSchema,
  trainingCatalogSchema,
  type AccountDeletionImpact,
  type AiTipOutcome,
  type AiTipRequest,
  type Tier,
  type TrainingCatalog,
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
 * Address of the account service, from EXPO_PUBLIC_API_URL at build time.
 *
 * A build with this missing used to fall back to localhost in silence, so a
 * shipped app pointed at nothing and every single request died as "check your
 * connection" — advice that could never work. Now: in development we fall
 * back (a web dev server on this same machine is the normal case) and say so
 * loudly, and in a release build we refuse to pretend. See `fetchWithTimeout`.
 */
const DEV_FALLBACK_URL = 'http://localhost:3000';
const CONFIGURED_API_URL = process.env.EXPO_PUBLIC_API_URL?.trim() ?? '';

/** True when this build was given a real address. */
export const API_URL_CONFIGURED = CONFIGURED_API_URL !== '';

/**
 * API base URL. Exported so sibling clients (e.g. features/staff/api.ts) build
 * their own request plumbing against the SAME host without re-reading the env.
 */
export const BASE_URL = API_URL_CONFIGURED ? CONFIGURED_API_URL : DEV_FALLBACK_URL;

if (!API_URL_CONFIGURED) {
  if (__DEV__) {
    console.warn(
      [
        '',
        '══════════════════════════════════════════════════════════════',
        ' EXPO_PUBLIC_API_URL is not set.',
        ` Falling back to ${DEV_FALLBACK_URL}, which only reaches a web`,
        ' app running on THIS machine — a phone on wi-fi cannot see it.',
        ' Set it in apps/mobile/.env, and in eas.json for every build',
        ' profile. A release build without it refuses all requests.',
        '══════════════════════════════════════════════════════════════',
        '',
      ].join('\n'),
    );
  } else {
    // Release build: nothing here can work, and the first request will say so.
    console.error(
      '[api] EXPO_PUBLIC_API_URL is missing from this build — every request is refused.',
    );
  }
}

export type ApiErrorCode =
  | 'email_taken'
  | 'bad_credentials'
  /** Google sign-in hit an email that already has a password account — retry with `password` to link. */
  | 'link_required'
  | 'invalid'
  | 'network'
  | 'unauthorized'
  | 'not_configured'
  /**
   * The sign-in provider's own service couldn't be reached from our server
   * (503). Distinct from 'network': the phone is online, the provider isn't
   * answering, so "check your connection" would be the wrong advice.
   */
  | 'auth_unavailable'
  /** Live billing: paid tiers require a store purchase, not a self-serve pick. */
  | 'billing_required'
  /**
   * Live billing is switched on but the deployment has no store rail wired up
   * yet, so POST /api/subscription/tier answers 503. The paywall already has
   * the right explanation for it; without this mapping the answer collapsed to
   * 'network' and a member on a misconfigured deployment was told to check a
   * connection that was working perfectly.
   */
  | 'billing_unavailable'
  /**
   * 429 — the server is asking this account (or this phone) to slow down. The
   * request arrived and was understood, so "check your connection" is not just
   * wrong, it invites an immediate retry that pushes the wait out further.
   */
  | 'rate_limited'
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
  | 'account_deletion_conflict'
  /**
   * This BUILD has no address for the account service (EXPO_PUBLIC_API_URL was
   * missing when it was made), so nothing that needs an account can work here.
   * Never comes from the server — the request is refused before it leaves the
   * phone, because "check your connection" would send the member chasing a
   * fault that isn't theirs.
   */
  | 'app_not_configured';

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

/**
 * Outcome of one catalog read.
 *  - 'catalog'   → a full, validated snapshot: store it and show it.
 *  - 'unchanged' → the server confirmed the revision we asked about is still
 *                  the current one, so the snapshot we already hold stands and
 *                  nothing was downloaded. Only ever returned for a revision
 *                  this call actually sent.
 */
export type TrainingCatalogResult =
  | { kind: 'catalog'; catalog: TrainingCatalog }
  | { kind: 'unchanged' };

/** Shape of the server's revisions-match answer (see the route's doc comment). */
const CATALOG_REVISION_PATTERN = /^[a-f0-9]{64}$/;
const trainingCatalogUnchangedSchema = z.object({
  notModified: z.literal(true),
  revision: z.string().regex(CATALOG_REVISION_PATTERN),
});

/**
 * Authenticated Neon-backed plan and exercise snapshot for member training.
 *
 * Pass `knownRevision` (the revision of the snapshot already on the device) to
 * skip re-downloading a library that has not changed: the server answers with a
 * tiny confirmation instead, and this resolves to `{ kind: 'unchanged' }`. The
 * conditional read is best-effort in every direction — a revision that isn't
 * shaped like one the server mints, a server that predates the feature, or any
 * answer that doesn't confirm the exact revision we asked about all fall
 * straight through to a normal full read, so a stale library can never be
 * mistaken for a current one.
 */
export async function getTrainingCatalog(
  token: string,
  knownRevision?: string | null,
): Promise<TrainingCatalogResult> {
  const conditional =
    typeof knownRevision === 'string' && CATALOG_REVISION_PATTERN.test(knownRevision)
      ? knownRevision
      : null;
  const url = conditional
    ? `${BASE_URL}/api/me/training-catalog?revision=${encodeURIComponent(conditional)}`
    : `${BASE_URL}/api/me/training-catalog`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError('network');
  }
  if (response.status === 401) throw new ApiError('unauthorized');
  if (!response.ok) throw new ApiError('network');
  try {
    const body = (await response.json()) as unknown;
    if (conditional !== null) {
      const unchanged = trainingCatalogUnchangedSchema.safeParse(body);
      // The revision has to come back identical: anything else is a body we
      // don't understand, and the full parse below is the honest answer to it.
      if (unchanged.success && unchanged.data.revision === conditional) {
        return { kind: 'unchanged' };
      }
    }
    const parsed = trainingCatalogSchema.safeParse(body);
    if (!parsed.success) throw new ApiError('network', 'invalid training catalog');
    return { kind: 'catalog', catalog: parsed.data };
  } catch (error: unknown) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('network', 'invalid training catalog');
  }
}

// ── Schemas ───────────────────────────────────────────────────

const tierSchema: z.ZodType<Tier> = z.enum(['starter', 'silver', 'gold', 'elite']);

/** Provenance of the account's stored tier grant (mirrors accounts.tier_source). */
export type TierSource = 'console' | 'manual_payment' | 'revenuecat' | 'preview' | 'coach';
const tierSourceSchema = z.enum(['console', 'manual_payment', 'revenuecat', 'preview', 'coach']);

const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  tier: tierSchema,
  /**
   * ISO instant the current paid tier lapses; null = no expiry (free/permanent).
   * Optional so older responses (login/register, which omit it) still parse —
   * GET /api/me and POST /api/subscription/tier always carry it. RAW value:
   * present even when already past, so the app can show "expired — renew" while
   * `tier` has collapsed to 'starter'. WP-9 / Pack J (B22).
   */
  tierExpiresAt: z.string().nullable().optional(),
  tierSource: tierSourceSchema.nullable().optional(),
  tierSourceId: z.string().nullable().optional(),
});

export type AuthUser = z.infer<typeof userSchema>;

const sessionSchema = z.object({ token: z.string(), user: userSchema });

export type AuthSession = z.infer<typeof sessionSchema>;

const meSchema = z.object({ user: userSchema });
/**
 * POST /api/subscription/tier response: the updated user plus the instant the
 * change takes effect — `now` for an upgrade / immediate downgrade, or the
 * paid-window end for a cancel-at-period-end (Pack J period-end semantics).
 */
const tierChangeSchema = z.object({
  user: userSchema,
  effectiveAt: z.string().nullable().optional(),
});
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
    raw === 'auth_unavailable' ||
    raw === 'billing_required' ||
    raw === 'billing_unavailable' ||
    raw === 'rate_limited' ||
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
 * The full vocabulary {@link httpStatusToCode} can produce. Deliberately wider
 * than any single client's own union: each client narrows it to the codes it
 * actually has copy for.
 */
export type HttpStatusCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'conflict'
  | 'rate_limited'
  | 'not_configured'
  | 'network';

/**
 * ONE HTTP status → error code table for every API client in the app.
 *
 * There used to be six of these, one per feature client, and they had drifted:
 * some knew 429, some didn't, so the same "slow down" from the server read as
 * a wait on one screen and as "check your connection" on another — advice that
 * invites an immediate retry and pushes the wait out further.
 *
 * Callers narrow the answer to their own union; anything a client has no copy
 * for folds to 'network', which is exactly what it did before. Widening a
 * client is then a copy decision in one place, not an archaeology exercise.
 */
export function httpStatusToCode(status: number): HttpStatusCode {
  if (status === 400) return 'invalid';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'not_configured';
  return 'network';
}

/**
 * What a member is told when the build has no address for the account
 * service. It names the one thing that can actually help (a newer build) and
 * doesn't blame their connection for something that was never sent.
 */
const APP_NOT_CONFIGURED_MESSAGE =
  "This version of the app can't reach your account. Please update the app";

/**
 * What a member is told when the server asks us to slow down (429). It must
 * never read like a connection fault and must never say "try again" on its
 * own — another immediate attempt only extends the wait. Exported so every
 * screen shows the SAME line instead of inventing its own.
 */
export const RATE_LIMITED_MESSAGE = 'Too many attempts. Wait a moment and try again';

/**
 * fetch with a timeout; the abort surfaces as a rejection the callers already
 * map to their typed 'network' errors. Exported so sibling clients
 * (features/staff/api.ts, features/staff/supportApi.ts) share the same
 * hang-proofing instead of issuing bare `fetch` calls (defect H1/H2/H4).
 *
 * Also the single gate for a release build made without EXPO_PUBLIC_API_URL:
 * every request is refused here, with a message that is at least true, rather
 * than thrown at a localhost address no phone can reach.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  if (!API_URL_CONFIGURED && !__DEV__) {
    throw new ApiError('app_not_configured', APP_NOT_CONFIGURED_MESSAGE);
  }
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
  } catch (err: unknown) {
    // A typed refusal (nothing was ever sent) keeps its own honest message —
    // only a genuine transport failure becomes "check your connection".
    if (err instanceof ApiError) throw err;
    throw new ApiError('network', "We couldn't connect. Check your connection and try again");
  }

  if (res.ok) {
    try {
      return (await res.json()) as unknown;
    } catch {
      throw new ApiError('network', 'Unexpected server response');
    }
  }

  // Non-2xx: prefer the contract's {error} code, fall back on the status. A 429
  // is recognised from the status alone as well as from the body, because every
  // limiter answers `{error:'rate_limited', retryAfterSec}` but a proxy in front
  // of us may not. These are the only two statuses this client has ever spoken
  // about on their own — every other status keeps reading as a plain failure
  // unless the body names a code.
  const fromStatus = httpStatusToCode(res.status);
  let code: ApiErrorCode =
    fromStatus === 'unauthorized' || fromStatus === 'rate_limited' ? fromStatus : 'network';
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
  throw new ApiError(
    code,
    code === 'rate_limited' ? RATE_LIMITED_MESSAGE : undefined,
    deletionImpact,
  );
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

// The password-reset request lives in features/auth/AuthScreen.tsx
// (`askForResetLink`), the only screen that offers it. A second copy used to
// sit here with no callers, and it had already drifted: it ignored the server's
// `delivery` field, so it would have told members instructions were on the way
// on a deployment that cannot send email at all.

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

/**
 * Ask the server for the one-time challenge that ties ONE Apple sign-in
 * attempt to ONE backend exchange. Its value is opaque to the app: hand it
 * to the Apple prompt as-is and send the SAME raw value back with
 * loginWithApple — Apple hashes it into the signed credential itself, and the
 * server compares against the raw value it issued.
 *
 * Throws 'not_configured' until the server has its Apple app ids set, and
 * 'auth_unavailable' when the challenge couldn't be issued right now.
 */
export async function requestAppleNonce(): Promise<string> {
  const data = await request({ method: 'POST', path: '/api/auth/apple/nonce' });
  return parseAs(appleAuthNonceResponseSchema, data).nonce;
}

/**
 * Exchange a signed Apple credential (from expo-apple-authentication) for a
 * session. `nonce` must be the RAW value requestAppleNonce returned and the
 * same one passed to the Apple prompt. `displayName` is Apple's one-time
 * name — it's only ever profile metadata (the server re-sanitises it and
 * never matches on it), and Apple supplies it on the FIRST authorization only.
 *
 * Throws 'not_configured' until the server has its Apple app ids set, and
 * 'link_required' when the Apple email already belongs to a password
 * account — retry with the SAME identityToken and nonce plus that account's
 * `password` to link Apple onto it (both sign-in methods then open the SAME
 * account). The server deliberately keeps the challenge unspent on
 * link_required so that retry works.
 */
export async function loginWithApple(
  identityToken: string,
  nonce: string,
  displayName?: string,
  password?: string,
): Promise<AuthSession> {
  // Validated against the SAME shared schema the API route parses with, so a
  // malformed payload fails here instead of costing a round trip (rule 8).
  const trimmedName = displayName?.trim() ?? '';
  const body = appleAuthRequestSchema.safeParse({
    identityToken,
    nonce,
    ...(trimmedName !== '' ? { displayName: trimmedName } : null),
    ...(password !== undefined ? { password } : null),
  });
  if (!body.success) throw new ApiError('invalid');
  const payload: Record<string, unknown> = { ...body.data };
  const data = await request({ method: 'POST', path: '/api/auth/apple', body: payload });
  return parseAs(sessionSchema, data);
}

export async function me(token: string): Promise<AuthUser> {
  const data = await request({ method: 'GET', path: '/api/me', token });
  return parseAs(meSchema, data).user;
}

const healthSchema = z.object({ ok: z.literal(true), app: z.literal('gym-tracker') });

/**
 * True only when GET /api/health identifies the host as the real GM Method
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

/** The outcome of a tier change: the updated user + when it takes effect. */
export interface TierChangeResult {
  user: AuthUser;
  /** ISO instant the change takes effect (now, or a cancel's period end). */
  effectiveAt: string | null;
}

/**
 * Set the account's subscription tier SERVER-SIDE (the paywall's "Choose
 * plan" / "Cancel"). The server is the tier authority — PUT /api/profile no
 * longer writes accounts.tier — so gated features stay locked until this
 * returns. Resolves with the updated user (same shape as GET /api/me) plus
 * `effectiveAt`: for a downgrade to 'starter' the server keeps access until the
 * paid window ends (period-end semantics), so `effectiveAt` is that end date;
 * an upgrade / immediate downgrade returns `now`.
 */
export async function setSubscriptionTier(token: string, tier: Tier): Promise<TierChangeResult> {
  const data = await request({
    method: 'POST',
    path: '/api/subscription/tier',
    body: { tier },
    token,
  });
  const parsed = parseAs(tierChangeSchema, data);
  return { user: parsed.user, effectiveAt: parsed.effectiveAt ?? null };
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
  /** Referrals: you already saved this email yourself. */
  | 'already_linked'
  /** Invite codes: that code isn't one we recognise. */
  | 'invalid_code'
  /** Invite codes: that's the caller's own code. */
  | 'own_code'
  /** Invite codes: this account has already used an invite code. */
  | 'code_already_used'
  /** Invite codes: past the new-member window for using a code. */
  | 'not_new_member'
  /** Invite codes: the link was made but the discount didn't land; safe to retry. */
  | 'grant_failed'
  /** Trial: this tier's one-time trial is already spent. */
  | 'trial_used'
  /** Trial: the requested tier isn't above the account's current tier. */
  | 'not_an_upgrade'
  /**
   * Trial: the account already holds a paid or longer-dated membership, so the
   * server refused rather than overwrite it with a two-day trial window.
   */
  | 'subscription_active'
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
    raw === 'invalid_code' ||
    raw === 'own_code' ||
    raw === 'code_already_used' ||
    raw === 'not_new_member' ||
    raw === 'grant_failed' ||
    raw === 'trial_used' ||
    raw === 'not_an_upgrade' ||
    raw === 'subscription_active'
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
    throw new RewardsApiError('network', "We couldn't connect. Check your connection and try again");
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
  /**
   * True only when a discount actually landed for this invite. A friend who
   * already had an account is recorded but earns nobody anything, and reads
   * `false` here even though the status says joined. Optional: a server that
   * predates the field leaves it undefined, and undefined must never be read
   * as "earned".
   */
  discountEarned: z.boolean().optional(),
});

export type Referral = z.infer<typeof referralSchema>;

/** The member's own shareable code plus the reward terms, straight from the server. */
const inviteInfoSchema = z.object({
  /** null on the rare account whose id isn't shaped like a code. */
  code: z.string().nullable(),
  /** Public page to point a friend at — the member shares it themselves. */
  shareUrl: z.string(),
  discountPct: z.number(),
  rewardDays: z.number(),
  redeemWindowDays: z.number(),
  /** False once this account has had a referral discount, or is past the window. */
  canRedeem: z.boolean(),
});

export type InviteInfo = z.infer<typeof inviteInfoSchema>;

const referralListSchema = z.object({
  referrals: z.array(referralSchema),
  invite: inviteInfoSchema.optional(),
});

export interface ReferralsSnapshot {
  referrals: Referral[];
  /** null when talking to a server that predates shareable codes. */
  invite: InviteInfo | null;
}

/** Get this user's invite code and the invites they've recorded. */
export async function getReferrals(token: string): Promise<ReferralsSnapshot> {
  const data = await rewardsRequest({ method: 'GET', path: '/api/buddy/referrals', token });
  const parsed = parseRewards(referralListSchema, data);
  return { referrals: parsed.referrals, invite: parsed.invite ?? null };
}

/**
 * Record a friend's email so the discount lands automatically when they sign
 * up with it. Nothing is sent to that address — the member still passes the
 * invite on themselves. Throws RewardsApiError 'already_linked' when the
 * caller already saved that email.
 */
export async function createReferral(token: string, inviteeEmail: string): Promise<void> {
  await rewardsRequest({
    method: 'POST',
    path: '/api/buddy/referrals',
    token,
    body: { inviteeEmail },
  });
}

/**
 * Use a friend's shared invite code. Throws RewardsApiError: 'invalid_code'
 * (unrecognised), 'own_code', 'code_already_used', 'not_new_member' (past the
 * window), or 'grant_failed' (nothing was linked — safe to try again).
 */
export async function redeemInviteCode(token: string, inviteCode: string): Promise<void> {
  await rewardsRequest({
    method: 'POST',
    path: '/api/buddy/referrals',
    token,
    body: { inviteCode },
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
// Human coach/support messaging (see COACH API CONTRACT)
// Two async threads per account, split by `kind`. Same philosophy as
// the rest of this client: zod at the boundary, typed error codes, and
// network failures NEVER block the UI (the thread keeps its last-known
// state and retries quietly). `coach_unavailable` means no active persisted
// human coach assignment owns the member's coach thread.
// ════════════════════════════════════════════════════════════════

export type CoachThreadKind = 'coach_chat' | 'support';

export type CoachErrorCode =
  | 'coach_unavailable'
  | 'forbidden'
  | 'invalid'
  | 'unauthorized'
  | 'network';

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
  /**
   * Send responses only, and additive: true when the stored message differs
   * from what was typed because contact details were taken out of it (coach
   * chat only, never support). `.optional()` keeps an older server's payload
   * valid, in which case the app just never mentions it.
   */
  contactHidden: z.boolean().optional(),
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
    throw new CoachApiError('network', "We couldn't connect. Check your connection and try again");
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
    if (parsed.success) {
      if (parsed.data.error === 'invalid') code = 'invalid';
      if (parsed.data.error === 'coach_unavailable') code = 'coach_unavailable';
    }
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

export interface SentCoachMessages {
  /** Only the rows the server actually inserted. */
  messages: CoachMessage[];
  /** The stored message differs from what was typed, because contact details
   * were taken out of it. Coach chat only. Undefined on an older server. */
  contactHidden?: boolean;
}

/**
 * Send a persisted human-owned message. Coach chat requires an active coach
 * assignment and throws `coach_unavailable` otherwise; support routes to the
 * staff inbox. Returns only rows that the server actually inserted, plus
 * whether contact details were taken out of the message on the way in.
 */
export async function sendCoachMessage(
  kind: CoachThreadKind,
  body: string,
  token: string,
): Promise<SentCoachMessages> {
  const data = await coachRequest({
    method: 'POST',
    path: '/api/coach/messages',
    token,
    body: { kind, body },
  });
  const parsed = parseCoach(coachMessagesSchema, data);
  return { messages: parsed.messages, contactHidden: parsed.contactHidden };
}

// ── AI coach tips ─────────────────────────────────────────────

/**
 * Fetch a short AI coach tip. The request is CLOSED: a card `kind` plus a small
 * bag of training and body numbers (packages/shared aiCoachTip.ts). We never
 * send prose, so nothing a member typed anywhere in the app can reach the
 * model, and the prompt itself is owned by the server.
 *
 * Written SERVER-SIDE with the server's provider key (no key in the app
 * bundle), so it needs a signed-in `token`. Never throws: any failure (offline,
 * server error, no key configured) resolves to 'unavailable' and the card shows
 * its quiet empty state.
 */
export async function getAiTip(
  input: AiTipRequest,
  token: string,
): Promise<AiTipOutcome> {
  try {
    const data = await request({ method: 'POST', path: '/api/ai/tip', body: input, token });
    const parsed = aiTipResponseSchema.safeParse(data);
    return parsed.success ? aiTipOutcome(parsed.data) : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

// ════════════════════════════════════════════════════════════════
// Gated form-check playback (see PLAYBACK API CONTRACT)
// GET /api/plan-videos/[exerciseId] mints a short-lived signed HLS url for
// the exercise's coach video, gated per-tier SERVER-SIDE. The signed url is
// disposable (~2h TTL) — fetch it per playback, never cache/persist it. The
// providerVideoId is never returned. Missing configuration/content remains
// unavailable; the client never substitutes a compiled playback URL.
// ════════════════════════════════════════════════════════════════

/**
 * Discriminated result of a playback lookup — the hook branches on `kind`
 * instead of catching typed errors, because 'locked' is a normal (not
 * exceptional) outcome that drives the paywall affordance.
 *
 *  - 'ok'             → play `url` (title/tierRequired for the caption/label).
 *  - 'locked'         → 403; show the "unlock with <requiredTier>" affordance.
 *  - 'not_found'      → no ready video for this exercise.
 *  - 'not_configured' → provider keys absent (503).
 *  - 'unavailable'    → 401/network/malformed.
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
 * NEVER throws — every failure resolves to an explicit unavailable variant so
 * the video path remains unavailable instead of crashing the screen.
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
      // Body wasn't JSON — treat as unavailable.
    }
    return { kind: 'unavailable' };
  }

  if (res.status === 404) return { kind: 'not_found' };
  if (res.status === 503) return { kind: 'not_configured' };
  // 401 (expired session) and anything else → unavailable.
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

// ── Payee: where a member sends money before uploading a receipt ──
//
// The server publishes the configured payee on the two member routes these
// screens already call — GET /api/subscription/catalog (membership) and
// GET /api/meals/partners (meals) — so it rides along with the response the
// screen is already waiting for instead of costing a second request.
//
// `null` is a first-class answer and means NO rail is configured. Every caller
// must then hide the manual-payment option and say so in one line rather than
// asking for a transfer to nobody. An older server that doesn't send the key,
// or a body we can't read, lands on the same `null`, so a stale API can never
// invent a destination for money. The pure "is this rail payable" rules live in
// ./payeeLogic (no React, no network) and are shared with every payment surface.

const payeeWalletSchema = z.object({
  /** Wallet id money is sent to (an eSewa/Khalti mobile number). */
  id: z.string().min(1),
  /** Registered holder name, when the operator filled it in. */
  name: z.string().nullish(),
});

const payeeBankSchema = z.object({
  bankName: z.string().nullish(),
  accountName: z.string().min(1),
  accountNumber: z.string().min(1),
});

// Each rail falls back to "not configured" on its own: a half-filled bank
// record must not take a perfectly good wallet down with it.
const payeeSchema = z.object({
  esewa: payeeWalletSchema.nullish().catch(null),
  khalti: payeeWalletSchema.nullish().catch(null),
  bank: payeeBankSchema.nullish().catch(null),
  /** Optional scan-to-pay image. */
  qrImageUrl: z.string().nullish().catch(null),
  /** Optional extra line from the operator. */
  instructions: z.string().nullish().catch(null),
});

/**
 * Read a response's `payee` value. NEVER throws and never fails the parse of
 * the response it travels on: anything unreadable is "nothing configured".
 *
 * A QR image or an extra instruction line names no destination, so neither can
 * make a rail payable on its own — the same rule the server applies before
 * sending this.
 */
export function parsePayee(raw: unknown): Payee | null {
  const parsed = payeeSchema.safeParse(raw);
  if (!parsed.success) return null;
  const payee: Payee = {
    esewa: parsed.data.esewa ? { id: parsed.data.esewa.id, name: parsed.data.esewa.name ?? null } : null,
    khalti: parsed.data.khalti ? { id: parsed.data.khalti.id, name: parsed.data.khalti.name ?? null } : null,
    bank: parsed.data.bank
      ? {
          bankName: parsed.data.bank.bankName ?? null,
          accountName: parsed.data.bank.accountName,
          accountNumber: parsed.data.bank.accountNumber,
        }
      : null,
    qrImageUrl: parsed.data.qrImageUrl ?? null,
    instructions: parsed.data.instructions ?? null,
  };
  const payable =
    supportsRail(payee, 'esewa') || supportsRail(payee, 'khalti') || supportsRail(payee, 'bank');
  return payable ? payee : null;
}

/** The `payee` key as it sits inside a response schema. Unreadable → null. */
export const payeeFieldSchema = z.unknown().transform((raw): Payee | null => parsePayee(raw));

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
  /**
   * Server billing mode. 'live' means paid tiers can NOT be granted by the
   * self-serve tier endpoint (it 402s) — the paywall pre-detects this and shows
   * a store / manual-payment affordance instead of a Choose CTA that reverts
   * (B23 flicker + Pack J honest INTL affordance). Optional/defaulted so an
   * older server response still parses (absent → treated as 'preview').
   */
  billingMode: z.enum(['disabled', 'preview', 'live']),
  /**
   * Where a member sends money for a manual payment, or null when the operator
   * has configured nothing payable. Rides along with the prices the paywall is
   * already waiting for, so the screen never has to ask twice. See
   * {@link parsePayee}.
   */
  payee: payeeFieldSchema,
});
export type SubscriptionCatalog = z.infer<typeof catalogSchema>;

/**
 * GET /api/subscription/catalog?region= → regional pricing + this account's
 * best active discount + the payee for manual payments. `region` is a raw
 * ISO-3166 alpha-2 hint (e.g. from expo-localization) — the server clamps it to
 * NP/INTL and persists it onto the account for next time. Requires a signed-in
 * `token`.
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
  // Resilient: the payee field transforms an unknown value into `Payee | null`,
  // so the schema's input and output shapes differ (see parseAsResilient).
  return parseAsResilient(catalogSchema, data);
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
/**
 * Mirrors payment_requests.status exactly. 'refunded' is terminal and set by
 * POST /api/admin/payment-requests/[id]/refund (approved→refunded, rolling the
 * tier back). It was missing here, so every admin-refunded row failed to parse
 * and — because the list drops unparseable rows — silently VANISHED from the
 * member's in-app payment history, leaving no record of a payment they made.
 */
const paymentStatusSchema = z.enum(['pending', 'approved', 'rejected', 'refunded']);

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
