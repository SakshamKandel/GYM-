import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet } from 'jose';
import { z } from 'zod';
import { appleAuthNonceSchema } from '@gym/shared';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const JWKS_CACHE_MS = 60 * 60 * 1_000;

const appleRsaJwkSchema = z
  .object({
    kty: z.literal('RSA'),
    kid: z.string().min(1),
    use: z.literal('sig'),
    alg: z.literal('RS256'),
    n: z.string().min(1),
    e: z.string().min(1),
  })
  .passthrough();

const appleJwksSchema = z
  .object({
    keys: z.array(appleRsaJwkSchema).min(1),
  })
  .strict();

const verifiedEmailSchema = z.string().trim().email().max(320);

interface CachedJwks {
  value: JSONWebKeySet;
  expiresAtMs: number;
  fetchImpl: typeof globalThis.fetch;
}

let cachedJwks: CachedJwks | null = null;

export interface AppleIdentity {
  /** Stable, pairwise Apple subject. This — never email — identifies the account. */
  sub: string;
  /** Null only for Apple accounts whose managed identity has no email address. */
  email: string | null;
  isPrivateEmail: boolean;
}

export class AppleVerificationUnavailable extends Error {
  constructor() {
    super('Apple identity verification is temporarily unavailable');
    this.name = 'AppleVerificationUnavailable';
  }
}

export function allowedAppleClientIds(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = [env.APPLE_CLIENT_ID, env.APPLE_CLIENT_IDS]
    .filter((value): value is string => typeof value === 'string')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(raw)];
}

async function fetchAppleJwks(
  fetchImpl: typeof globalThis.fetch,
  nowMs: number,
  force: boolean,
): Promise<JSONWebKeySet> {
  if (
    !force &&
    cachedJwks !== null &&
    cachedJwks.fetchImpl === fetchImpl &&
    cachedJwks.expiresAtMs > nowMs
  ) {
    return cachedJwks.value;
  }

  let response: Response;
  try {
    response = await fetchImpl(APPLE_JWKS_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
      cache: 'no-store',
    });
  } catch {
    throw new AppleVerificationUnavailable();
  }
  if (!response.ok) throw new AppleVerificationUnavailable();

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AppleVerificationUnavailable();
  }
  const parsed = appleJwksSchema.safeParse(body);
  if (!parsed.success) throw new AppleVerificationUnavailable();

  const value: JSONWebKeySet = parsed.data;
  cachedJwks = { value, expiresAtMs: nowMs + JWKS_CACHE_MS, fetchImpl };
  return value;
}

async function verifyWithJwks(
  identityToken: string,
  jwks: JSONWebKeySet,
  allowedAudiences: readonly string[],
  expectedNonce: string,
  now: Date,
): Promise<AppleIdentity | null> {
  try {
    const { payload } = await jwtVerify(identityToken, createLocalJWKSet(jwks), {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      audience: [...allowedAudiences],
      currentDate: now,
      clockTolerance: 5,
      maxTokenAge: '10m',
      requiredClaims: ['iss', 'aud', 'exp', 'iat', 'sub', 'nonce'],
    });

    if (payload.nonce !== expectedNonce || !appleAuthNonceSchema.safeParse(payload.nonce).success) {
      return null;
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 255) {
      return null;
    }

    let email: string | null = null;
    if (payload.email !== undefined && payload.email !== '') {
      const verified = payload.email_verified === true || payload.email_verified === 'true';
      if (!verified) return null;
      const parsedEmail = verifiedEmailSchema.safeParse(payload.email);
      if (!parsedEmail.success) return null;
      email = parsedEmail.data.toLowerCase();
    }

    return {
      sub: payload.sub,
      email,
      isPrivateEmail:
        payload.is_private_email === true || payload.is_private_email === 'true',
    };
  } catch (error: unknown) {
    if (error instanceof errors.JWKSNoMatchingKey) throw error;
    return null;
  }
}

/**
 * Verify an Apple ID token locally against Apple's current RS256 keys and all
 * identity-bearing claims. A cached key miss is refreshed once to tolerate key
 * rotation. Network/JWKS failures are distinct from invalid credentials.
 */
export async function verifyAppleIdToken(
  identityToken: string,
  allowedAudiences: readonly string[],
  expectedNonce: string,
  options: {
    fetchImpl?: typeof globalThis.fetch;
    now?: Date;
  } = {},
): Promise<AppleIdentity | null> {
  if (allowedAudiences.length === 0 || !appleAuthNonceSchema.safeParse(expectedNonce).success) {
    return null;
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? new Date();
  let jwks = await fetchAppleJwks(fetchImpl, now.getTime(), false);
  try {
    return await verifyWithJwks(identityToken, jwks, allowedAudiences, expectedNonce, now);
  } catch (error: unknown) {
    if (!(error instanceof errors.JWKSNoMatchingKey)) return null;
    jwks = await fetchAppleJwks(fetchImpl, now.getTime(), true);
    try {
      return await verifyWithJwks(identityToken, jwks, allowedAudiences, expectedNonce, now);
    } catch {
      return null;
    }
  }
}

/** Remove control characters and collapse whitespace in Apple's one-time name. */
export function sanitizeAppleDisplayName(value: string | undefined): string {
  if (value === undefined) return '';
  return value
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
}

/** Private-relay addresses must never leak their opaque local part into UI. */
export function displayNameForNewAppleAccount(
  oneTimeName: string | undefined,
  verifiedEmail: string,
): string {
  const supplied = sanitizeAppleDisplayName(oneTimeName);
  if (supplied) return supplied;
  if (verifiedEmail.toLowerCase().endsWith('@privaterelay.appleid.com')) return 'Apple member';
  const localPart = verifiedEmail.split('@')[0] ?? '';
  return sanitizeAppleDisplayName(localPart.replace(/[._+-]+/g, ' ')) || 'Apple member';
}

export interface AppleEmailCollision {
  status: 'active' | 'suspended';
  passwordHash: string | null;
  googleSub: string | null;
  appleSub: string | null;
}

export type AppleEmailCollisionDecision =
  | 'reject'
  | 'require_password'
  | 'verify_password'
  | 'link_verified_provider';

/**
 * Decide how a verified Apple email may attach to an existing account.
 * Password-created rows require the password (pre-hijacking defence). A
 * Google-only row already proved ownership of that same email and may link.
 */
export function decideAppleEmailCollision(
  account: AppleEmailCollision,
  passwordWasSupplied: boolean,
): AppleEmailCollisionDecision {
  if (account.status !== 'active' || account.appleSub !== null) return 'reject';
  if (account.passwordHash !== null) {
    return passwordWasSupplied ? 'verify_password' : 'require_password';
  }
  if (account.googleSub !== null) return 'link_verified_provider';
  return 'reject';
}

/** Test-only cache reset; exported to make key-rotation tests deterministic. */
export function resetAppleJwksCacheForTests(): void {
  cachedJwks = null;
}
