import { z } from 'zod';

/**
 * Server-side Google ID-token verification via Google's tokeninfo endpoint
 * (no extra dependency; fine at sign-in volume). The token comes from the
 * mobile app's expo-auth-session flow; we re-verify EVERYTHING here — the
 * client is untrusted.
 *
 * Configured through env:
 * - `GOOGLE_CLIENT_ID` — the accepted OAuth client id, or
 * - `GOOGLE_CLIENT_IDS` — comma-separated list (web + iOS + Android ids).
 */

const tokenInfoSchema = z.object({
  aud: z.string(),
  sub: z.string().min(1),
  email: z.string().min(3),
  email_verified: z.string().optional(),
  exp: z.string(),
  name: z.string().optional(),
  given_name: z.string().optional(),
});

export interface GoogleIdentity {
  /** Google's stable subject id — the durable account link. */
  sub: string;
  /** Verified email, lowercased. */
  email: string;
  /** Best-effort display name ('' when Google returns none). */
  displayName: string;
}

/** Client ids a token's `aud` may match. Empty array = Google sign-in not configured. */
export function allowedGoogleClientIds(): string[] {
  const raw = [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_IDS]
    .filter((v): v is string => typeof v === 'string')
    .join(',');
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * Verify an ID token against the allowed client ids.
 * Returns null on ANY failure (bad token, wrong audience, unverified email,
 * expired, network) — callers treat null as bad_credentials.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  allowedAuds: string[],
): Promise<GoogleIdentity | null> {
  if (allowedAuds.length === 0) return null;

  let res: Response;
  try {
    res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return null;
  }

  const parsed = tokenInfoSchema.safeParse(body);
  if (!parsed.success) return null;
  const info = parsed.data;

  if (!allowedAuds.includes(info.aud)) return null;
  if (info.email_verified !== 'true') return null;

  const expMs = Number(info.exp) * 1000;
  if (!Number.isFinite(expMs) || expMs <= Date.now()) return null;

  return {
    sub: info.sub,
    email: info.email.toLowerCase(),
    displayName: (info.name ?? info.given_name ?? '').trim(),
  };
}
