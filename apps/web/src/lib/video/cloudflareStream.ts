/**
 * Cloudflare Stream implementation of VideoProvider.
 *
 * Required env (all four; any missing → NotConfiguredError):
 *   CF_STREAM_ACCOUNT_ID  — Cloudflare account id (API path segment).
 *   CF_STREAM_API_TOKEN   — API token with Stream:Edit (create uploads / delete).
 *   CF_STREAM_KEY_ID      — signing key id (the `kid`, from POST /stream/keys).
 *   CF_STREAM_JWK         — base64-encoded JWK (RSA private key) for that key id.
 *
 * Upload: uses direct-creator-upload so the browser POSTs bytes straight to
 * Cloudflare (never through Vercel). We persist only the returned `uid`.
 *
 * Playback: mints a signed JWT (RS256, ~2h TTL) and returns a signed HLS
 * manifest URL. Signing is hand-rolled with node:crypto — no JWT dependency.
 */

import {
  createPrivateKey,
  createSign,
  type JsonWebKey,
} from 'node:crypto';
import type {
  CreateUploadMeta,
  CreateUploadResult,
  VideoProvider,
} from './types';
import { NotConfiguredError } from './types';

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';
/** Cloudflare's customer subdomain for HLS manifests of signed videos. */
const CF_STREAM_DELIVERY = 'https://customer-stream.cloudflarestream.com';
/** Signed playback token time-to-live: ~2 hours. */
const PLAYBACK_TTL_SECONDS = 2 * 60 * 60;
/** Default cap on how long a reserved upload URL stays usable. */
const DEFAULT_UPLOAD_MAX_DURATION = 3600;

interface CfConfig {
  accountId: string;
  apiToken: string;
  keyId: string;
  /** RSA private key, parsed from the base64 CF_STREAM_JWK. */
  jwk: JsonWebKey;
}

/** Read + validate env. Throws NotConfiguredError listing every missing var. */
function loadConfig(): CfConfig {
  const accountId = process.env.CF_STREAM_ACCOUNT_ID;
  const apiToken = process.env.CF_STREAM_API_TOKEN;
  const keyId = process.env.CF_STREAM_KEY_ID;
  const jwkRaw = process.env.CF_STREAM_JWK;

  const missing: string[] = [];
  if (!accountId) missing.push('CF_STREAM_ACCOUNT_ID');
  if (!apiToken) missing.push('CF_STREAM_API_TOKEN');
  if (!keyId) missing.push('CF_STREAM_KEY_ID');
  if (!jwkRaw) missing.push('CF_STREAM_JWK');
  if (missing.length > 0) throw new NotConfiguredError(missing);

  let jwk: JsonWebKey;
  try {
    // CF_STREAM_JWK is the base64 blob returned in the `jwk` field of
    // POST /stream/keys. Decode → JSON → JsonWebKey.
    const decoded = Buffer.from(jwkRaw!, 'base64').toString('utf8');
    jwk = JSON.parse(decoded) as JsonWebKey;
  } catch {
    // Present but unparseable — treat as misconfiguration, not a runtime 500.
    throw new NotConfiguredError(['CF_STREAM_JWK']);
  }

  return { accountId: accountId!, apiToken: apiToken!, keyId: keyId!, jwk };
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Build a Cloudflare Stream signed playback token (JWT, RS256) for one video.
 * Payload follows CF's spec: `sub` = video uid, `kid` = signing key id, plus
 * nbf/exp. Signed with the RSA private key from the JWK.
 */
function signPlaybackToken(uid: string, cfg: CfConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: cfg.keyId };
  const payload = {
    sub: uid,
    kid: cfg.keyId,
    nbf: now - 5, // small clock-skew allowance
    exp: now + PLAYBACK_TTL_SECONDS,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(payload),
  )}`;

  const privateKey = createPrivateKey({ key: cfg.jwk, format: 'jwk' });
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(privateKey);

  return `${signingInput}.${base64url(signature)}`;
}

/** Narrow shape of the Cloudflare API envelope we depend on. */
interface CfEnvelope<T> {
  success: boolean;
  errors?: { code?: number; message?: string }[];
  result?: T;
}

function cfErrorMessage(body: CfEnvelope<unknown> | null, status: number): string {
  const first = body?.errors?.[0]?.message;
  return first ?? `Cloudflare Stream API error (HTTP ${status})`;
}

export class CloudflareStreamProvider implements VideoProvider {
  async createDirectUpload(meta: CreateUploadMeta): Promise<CreateUploadResult> {
    const cfg = loadConfig();
    const res = await fetch(
      `${CF_API_BASE}/accounts/${cfg.accountId}/stream/direct_upload`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          maxDurationSeconds: meta.maxDurationSeconds ?? DEFAULT_UPLOAD_MAX_DURATION,
          // requireSignedURLs → playback needs a signed token (matches our tier gate).
          requireSignedURLs: true,
          ...(meta.name ? { meta: { name: meta.name } } : {}),
        }),
      },
    );

    const body = (await res.json().catch(() => null)) as CfEnvelope<{
      uploadURL?: string;
      uid?: string;
    }> | null;

    if (!res.ok || !body?.success || !body.result?.uploadURL || !body.result.uid) {
      throw new Error(cfErrorMessage(body, res.status));
    }

    return { uploadUrl: body.result.uploadURL, uid: body.result.uid };
  }

  async signedPlaybackUrl(uid: string): Promise<string> {
    const cfg = loadConfig();
    const token = signPlaybackToken(uid, cfg);
    // Signed HLS manifest. The token itself carries the uid (sub) + key id.
    return `${CF_STREAM_DELIVERY}/${token}/manifest/video.m3u8`;
  }

  async deleteVideo(uid: string): Promise<void> {
    const cfg = loadConfig();
    const res = await fetch(
      `${CF_API_BASE}/accounts/${cfg.accountId}/stream/${uid}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${cfg.apiToken}` },
      },
    );

    // 404 → already gone; treat delete as idempotent.
    if (res.status === 404) return;

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as CfEnvelope<unknown> | null;
      throw new Error(cfErrorMessage(body, res.status));
    }
  }
}
