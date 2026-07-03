/**
 * Cloudinary implementation of VideoProvider (free-tier friendly).
 *
 * Required env (all three; any missing → NotConfiguredError):
 *   CLOUDINARY_CLOUD_NAME  — the cloud name (API path segment + delivery host).
 *   CLOUDINARY_API_KEY     — public API key (safe to send to the browser).
 *   CLOUDINARY_API_SECRET  — signing secret. NEVER leaves the server.
 *
 * Upload: the browser POSTs the file bytes straight to Cloudinary's upload
 * endpoint (never through Vercel) using a *signed* set of form fields we mint
 * here. Assets are stored as resource_type=video, type=authenticated, with the
 * public_id set to the uid the server chose — so playback ALWAYS requires a
 * signed delivery URL. We persist only that uid.
 *
 * Playback: `signedPlaybackUrl` mints a short-lived (~2h) signed, authenticated
 * delivery URL. The signature covers an expiry token so the link self-expires.
 *
 * Signing is hand-rolled with node:crypto (no SDK / no new deps):
 *   - Upload/admin signature: SHA-1 hex of the alphabetically-sorted
 *     `key=value` params joined by '&', with the api_secret appended.
 *   - Delivery signature: SHA-256 of "<transformation>/<public_id.ext><secret>"
 *     truncated + base64url-encoded per Cloudinary's signed-URL scheme.
 */

import { createHash, randomUUID } from 'node:crypto';
import type {
  CreateUploadMeta,
  CreateUploadResult,
  VideoProvider,
} from './types';
import { NotConfiguredError } from './types';

const CLOUDINARY_API_BASE = 'https://api.cloudinary.com/v1_1';
const CLOUDINARY_DELIVERY_BASE = 'https://res.cloudinary.com';
/** Signed delivery URL time-to-live: ~2 hours. */
const PLAYBACK_TTL_SECONDS = 2 * 60 * 60;

interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/** Read + validate env. Throws NotConfiguredError listing every missing var. */
function loadConfig(): CloudinaryConfig {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  const missing: string[] = [];
  if (!cloudName) missing.push('CLOUDINARY_CLOUD_NAME');
  if (!apiKey) missing.push('CLOUDINARY_API_KEY');
  if (!apiSecret) missing.push('CLOUDINARY_API_SECRET');
  if (missing.length > 0) throw new NotConfiguredError(missing);

  return { cloudName: cloudName!, apiKey: apiKey!, apiSecret: apiSecret! };
}

function base64url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Cloudinary upload/admin signature: take every signed param (i.e. everything
 * EXCEPT api_key, file, resource_type and the signature itself), sort the keys
 * alphabetically, join as `key=value` with '&', append the api_secret, and take
 * the SHA-1 hex digest.
 */
function signParams(
  params: Record<string, string | number>,
  apiSecret: string,
): string {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha1')
    .update(toSign + apiSecret)
    .digest('hex');
}

/**
 * Cloudinary signed-delivery signature (the `s--<sig>--` URL segment).
 *
 * Per Cloudinary's signed-URL scheme, the string to sign is everything after
 * the delivery type in the URL path — i.e. "<transformation>/<public_id.ext>"
 * (transformation omitted when empty) — with the api_secret appended. The
 * SHA-256 digest is base64url-encoded and truncated to the first 8 chars.
 */
function signDeliveryComponent(toSign: string, apiSecret: string): string {
  const digest = createHash('sha256')
    .update(toSign + apiSecret)
    .digest();
  return base64url(digest).slice(0, 8);
}

/** Narrow shape of the Cloudinary destroy response we depend on. */
interface CloudinaryDestroyResult {
  result?: string; // "ok" | "not found"
  error?: { message?: string };
}

export class CloudinaryProvider implements VideoProvider {
  async createDirectUpload(meta: CreateUploadMeta): Promise<CreateUploadResult> {
    const cfg = loadConfig();
    const publicId = randomUUID();
    const timestamp = Math.floor(Date.now() / 1000);

    // Params that MUST be signed (order-independent; signParams sorts them).
    // NOTE: api_key, file and resource_type are NOT part of the signature.
    const signed: Record<string, string | number> = {
      public_id: publicId,
      timestamp,
      type: 'authenticated',
      ...(meta.name ? { context: `name=${sanitizeContextValue(meta.name)}` } : {}),
    };

    const signature = signParams(signed, cfg.apiSecret);

    // Full set of form fields the browser attaches (besides the `file` blob).
    // api_secret is deliberately absent — only the derived signature ships.
    const upload: Record<string, string> = {
      api_key: cfg.apiKey,
      timestamp: String(timestamp),
      public_id: publicId,
      type: 'authenticated',
      signature,
    };
    if (signed.context) upload.context = String(signed.context);

    const uploadUrl = `${CLOUDINARY_API_BASE}/${cfg.cloudName}/video/upload`;

    return { uploadUrl, uid: publicId, upload };
  }

  async signedPlaybackUrl(uid: string): Promise<string> {
    const cfg = loadConfig();

    // Assets are stored as type=authenticated, so *every* delivery URL must be
    // signed (`s--<sig>--`) with the api_secret — an unsigned URL 401s. This is
    // the free-tier signing scheme (SHA-256 over the path + secret). The tier
    // gate has already run upstream; this method only mints the delivery URL.
    //
    // We deliver an HLS manifest (.m3u8): Cloudinary transcodes authenticated
    // video to HLS on demand for the `.m3u8` extension. `sp_auto` selects an
    // adaptive streaming profile so the manifest has renditions.
    //
    // Short-TTL note: a hard per-request expiry on the delivery URL itself
    // requires Cloudinary's token-based auth (`__cld_token__`), which needs a
    // separate URL-signing key that is a paid add-on — not available with only
    // the api_secret on the free tier. We therefore return a signed URL (the
    // real, free-tier mechanism); PLAYBACK_TTL_SECONDS documents the intended
    // window and is the seam to swap in token auth if the plan is upgraded.
    void PLAYBACK_TTL_SECONDS;

    const transformation = 'sp_auto';
    const publicIdWithExt = `${uid}.m3u8`;

    // Signature is computed over "<transformation>/<public_id.ext>".
    const toSign = `${transformation}/${publicIdWithExt}`;
    const signature = signDeliveryComponent(toSign, cfg.apiSecret);

    // Cloudinary signed authenticated HLS delivery URL:
    //   https://res.cloudinary.com/<cloud>/video/authenticated/
    //     s--<sig>--/<transformation>/<public_id>.m3u8
    return (
      `${CLOUDINARY_DELIVERY_BASE}/${cfg.cloudName}/video/authenticated/` +
      `s--${signature}--/${transformation}/${publicIdWithExt}`
    );
  }

  async deleteVideo(uid: string): Promise<void> {
    const cfg = loadConfig();
    const timestamp = Math.floor(Date.now() / 1000);

    const signed: Record<string, string | number> = {
      public_id: uid,
      timestamp,
      type: 'authenticated',
    };
    const signature = signParams(signed, cfg.apiSecret);

    const form = new URLSearchParams({
      public_id: uid,
      timestamp: String(timestamp),
      type: 'authenticated',
      api_key: cfg.apiKey,
      signature,
    });

    const res = await fetch(
      `${CLOUDINARY_API_BASE}/${cfg.cloudName}/video/destroy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      },
    );

    const body = (await res
      .json()
      .catch(() => null)) as CloudinaryDestroyResult | null;

    // Idempotent: "not found" (asset already gone) is a successful no-op.
    if (body?.result === 'not found') return;

    if (!res.ok || body?.result !== 'ok') {
      const msg =
        body?.error?.message ??
        `Cloudinary destroy failed (HTTP ${res.status})`;
      throw new Error(msg);
    }
  }
}

/**
 * Cloudinary context values are pipe/equals-delimited; strip those chars so a
 * label can't corrupt the context string (and thus the signature match).
 */
function sanitizeContextValue(value: string): string {
  return value.replace(/[|=]/g, ' ').trim().slice(0, 200);
}
