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
 * Playback: `signedPlaybackUrl` mints a signed, authenticated delivery URL. When
 * a URL-signing key is configured (CLOUDINARY_URL_SIGNING_KEY) the URL also
 * carries a Cloudinary auth token (`__cld_token__`) with a hard `exp`, so the
 * link self-expires after PLAYBACK_TTL_SECONDS; without that key Cloudinary
 * offers no per-request expiry on the signed-URL scheme (see the method body).
 *
 * Signing is hand-rolled with node:crypto (no SDK / no new deps):
 *   - Upload/admin signature: SHA-1 hex of the alphabetically-sorted
 *     `key=value` params joined by '&', with the api_secret appended.
 *   - Delivery signature (`s--<sig>--`): SHA-1 of "<transformation>/<public_id.ext>"
 *     with the api_secret appended, base64url-encoded, truncated to 8 chars —
 *     Cloudinary's default signed-URL scheme.
 *   - Auth token: HMAC-SHA256 (key from hex) over "exp=<ts>~url=<escaped>",
 *     Cloudinary's token-based authentication scheme.
 *
 * Images (SCALE-UP-PLAN §4.5): `createImageUpload` mirrors createDirectUpload
 * but resource_type=image and a `folder` per kind. `type: 'upload'` (public
 * kinds — avatars, exercise/diet images) is readable at a stable unsigned URL
 * the instant the upload lands. `type: 'authenticated'` (progress photos,
 * payment receipts) has no public URL; `signedImageUrl` mints one on demand
 * with the SAME signed-delivery scheme as `signedPlaybackUrl`, just resource_
 * type=image and a `f_auto,q_auto` transformation instead of an HLS manifest
 * (the `.jpg` extension in the signed path is a URL-syntax requirement only —
 * f_auto makes Cloudinary negotiate the real stored format regardless).
 * Unlike `signedPlaybackUrl`, `signedImageUrl` REQUIRES CLOUDINARY_URL_SIGNING_KEY
 * (throws NotConfiguredError without it) — authenticated images are progress
 * photos and payment receipts, sensitive enough that a non-expiring link is
 * not an acceptable default the way it arguably is for video.
 */

import { createHash, createHmac, randomUUID } from 'node:crypto';
import type {
  CreateImageUploadOpts,
  CreateImageUploadResult,
  CreateUploadMeta,
  CreateUploadResult,
  VideoProvider,
} from './types.ts';
import { NotConfiguredError } from './types.ts';

const CLOUDINARY_API_BASE = 'https://api.cloudinary.com/v1_1';
const CLOUDINARY_DELIVERY_BASE = 'https://res.cloudinary.com';
/** Signed delivery URL time-to-live: ~2 hours. */
const PLAYBACK_TTL_SECONDS = 2 * 60 * 60;

/**
 * Formats a signed direct-upload slot is allowed to accept (defect F4). Sent as
 * a *signed* `allowed_formats` param so a client can't POST an arbitrary file
 * (script, HTML, oversized raw) to the reserved slot: Cloudinary rejects the
 * upload if the real file format is not in this list. Covers the container
 * formats phones and desktops actually produce for form-check clips.
 */
const ALLOWED_VIDEO_FORMATS = 'mp4,mov,m4v,webm,mkv,avi,3gp,hevc';

interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  /**
   * Optional hex URL-signing key for Cloudinary token-based authentication.
   * Present only on plans/accounts that enable it (private CDN add-on). When
   * set, delivery URLs get a hard-expiring `__cld_token__`; when absent we fall
   * back to a plain signed URL that has no per-request expiry.
   */
  urlSigningKey?: string;
}

/** Read + validate env. Throws NotConfiguredError listing every missing var. */
function loadConfig(): CloudinaryConfig {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  // Optional — its absence must NOT fail configuration.
  const urlSigningKey = process.env.CLOUDINARY_URL_SIGNING_KEY;

  const missing: string[] = [];
  if (!cloudName) missing.push('CLOUDINARY_CLOUD_NAME');
  if (!apiKey) missing.push('CLOUDINARY_API_KEY');
  if (!apiSecret) missing.push('CLOUDINARY_API_SECRET');
  if (missing.length > 0) throw new NotConfiguredError(missing);

  return {
    cloudName: cloudName!,
    apiKey: apiKey!,
    apiSecret: apiSecret!,
    urlSigningKey: urlSigningKey || undefined,
  };
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
 * Per Cloudinary's default signed-URL scheme, the string to sign is everything
 * after the delivery type in the URL path — i.e. "<transformation>/<public_id.ext>"
 * (transformation omitted when empty) — with the api_secret appended. The SHA-1
 * digest is base64-encoded (URL-safe: '/'→'_', '+'→'-') and truncated to the
 * first 8 chars. (Accounts explicitly configured for long/SHA-256 signatures
 * would instead emit the full 32-char SHA-256 digest — not the default here.)
 */
function signDeliveryComponent(toSign: string, apiSecret: string): string {
  const digest = createHash('sha1')
    .update(toSign + apiSecret)
    .digest();
  return base64url(digest).slice(0, 8);
}

/**
 * Cloudinary's token escaper (`escapeToLower`): percent-encode a fixed set of
 * unsafe chars, then lowercase the resulting `%XX` hex. Applied to the `url`
 * that scopes an auth token. Input here is a pure-ASCII delivery URL.
 */
function escapeToLower(value: string): string {
  return value
    .replace(/([ "#%&'/:;<=>?@[\]^`{|}~]+)/g, (run) =>
      run
        .split('')
        .map((c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
        .join(''),
    )
    .replace(/%../g, (m) => m.toLowerCase());
}

/**
 * Mint a Cloudinary auth token (`__cld_token__`) scoped to one exact delivery
 * URL with a hard expiry. Signing message is "exp=<ts>~url=<escaped-url>"; the
 * emitted token carries only `exp` + `hmac` (Cloudinary reconstructs the url
 * from the request). HMAC-SHA256 keyed by the hex-decoded URL-signing key.
 *
 * @param baseUrl delivery URL WITHOUT any query string.
 * @param signingKey hex-encoded URL-signing key.
 * @param ttlSeconds seconds until the token expires.
 */
function authTokenQuery(
  baseUrl: string,
  signingKey: string,
  ttlSeconds: number,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const toSign = `exp=${exp}~url=${escapeToLower(baseUrl)}`;
  const hmac = createHmac('sha256', Buffer.from(signingKey, 'hex'))
    .update(toSign)
    .digest('hex');
  return `__cld_token__=exp=${exp}~hmac=${hmac}`;
}

/** Narrow shape of the Cloudinary destroy response we depend on. */
interface CloudinaryDestroyResult {
  result?: string; // "ok" | "not found"
  error?: { message?: string };
}

/**
 * Safe Cloudinary `folder` segment for an image kind. Every real caller
 * validates `kind` against a fixed zod enum before it reaches the provider,
 * but the provider treats it as opaque input and sanitizes defensively rather
 * than trusting that boundary.
 */
function sanitizeFolder(kind: string): string {
  const cleaned = kind.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  return cleaned || 'misc';
}

export class CloudinaryProvider implements VideoProvider {
  async createDirectUpload(meta: CreateUploadMeta): Promise<CreateUploadResult> {
    const cfg = loadConfig();
    const publicId = randomUUID();
    const timestamp = Math.floor(Date.now() / 1000);

    // Params that MUST be signed (order-independent; signParams sorts them).
    // NOTE: api_key, file and resource_type are NOT part of the signature.
    // `allowed_formats` is signed so the browser can't drop it — Cloudinary
    // rejects the upload when the file's real format isn't in the list (F4).
    const signed: Record<string, string | number> = {
      allowed_formats: ALLOWED_VIDEO_FORMATS,
      public_id: publicId,
      timestamp,
      type: 'authenticated',
      ...(meta.name ? { context: `name=${sanitizeContextValue(meta.name)}` } : {}),
    };

    const signature = signParams(signed, cfg.apiSecret);

    // Full set of form fields the browser attaches (besides the `file` blob).
    // api_secret is deliberately absent — only the derived signature ships.
    // Every signed param above (except the derived signature) must be echoed
    // back verbatim or the signature won't match.
    const upload: Record<string, string> = {
      api_key: cfg.apiKey,
      timestamp: String(timestamp),
      public_id: publicId,
      type: 'authenticated',
      allowed_formats: ALLOWED_VIDEO_FORMATS,
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
    // Cloudinary's default signing scheme (SHA-1 over the path + secret). The
    // tier gate has already run upstream; this method only mints the delivery URL.
    //
    // We deliver an HLS manifest (.m3u8): Cloudinary transcodes authenticated
    // video to HLS on demand for the `.m3u8` extension. `sp_auto` selects an
    // adaptive streaming profile so the manifest has renditions.
    //
    const transformation = 'sp_auto';
    const publicIdWithExt = `${uid}.m3u8`;

    // Signature is computed over "<transformation>/<public_id.ext>".
    const toSign = `${transformation}/${publicIdWithExt}`;
    const signature = signDeliveryComponent(toSign, cfg.apiSecret);

    // Cloudinary signed authenticated HLS delivery URL:
    //   https://res.cloudinary.com/<cloud>/video/authenticated/
    //     s--<sig>--/<transformation>/<public_id>.m3u8
    const baseUrl =
      `${CLOUDINARY_DELIVERY_BASE}/${cfg.cloudName}/video/authenticated/` +
      `s--${signature}--/${transformation}/${publicIdWithExt}`;

    // Hard per-request expiry lives on Cloudinary's token-based auth
    // (`__cld_token__`), which needs a URL-signing key (private-CDN add-on). When
    // CLOUDINARY_URL_SIGNING_KEY is set we scope a token to THIS exact URL with
    // an `exp` = now + PLAYBACK_TTL_SECONDS, so a leaked link stops streaming
    // after the window. Without that key Cloudinary's signed-URL scheme has NO
    // per-request expiry — a leaked link stays valid until the asset is deleted;
    // set the signing key to close that exposure.
    if (cfg.urlSigningKey) {
      const token = authTokenQuery(
        baseUrl,
        cfg.urlSigningKey,
        PLAYBACK_TTL_SECONDS,
      );
      return `${baseUrl}?${token}`;
    }

    return baseUrl;
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

  async createImageUpload(
    opts: CreateImageUploadOpts,
  ): Promise<CreateImageUploadResult> {
    const cfg = loadConfig();
    const publicId = randomUUID();
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = sanitizeFolder(opts.kind);
    const type = opts.access === 'authenticated' ? 'authenticated' : 'upload';

    // Params that MUST be signed (order-independent; signParams sorts them).
    const signed: Record<string, string | number> = {
      folder,
      public_id: publicId,
      timestamp,
      type,
    };
    const signature = signParams(signed, cfg.apiSecret);

    // Full set of form fields the browser attaches (besides the `file` blob).
    // api_secret is deliberately absent — only the derived signature ships.
    const fields: Record<string, string> = {
      api_key: cfg.apiKey,
      timestamp: String(timestamp),
      public_id: publicId,
      folder,
      type,
      signature,
    };

    const uploadUrl = `${CLOUDINARY_API_BASE}/${cfg.cloudName}/image/upload`;
    // Cloudinary's true public_id is `folder/public_id` once a folder is set —
    // that combined string is what signedImageUrl and delivery URLs need, so
    // it's what we persist.
    const uid = `${folder}/${publicId}`;

    // Public assets (type=upload) are readable at a stable, unsigned URL the
    // moment the upload completes — hand it back so the caller can store it
    // with no further signing round-trip. Authenticated assets (progress
    // photos / receipts) have NO public URL; playback always goes through
    // signedImageUrl().
    const deliveryUrl =
      type === 'upload'
        ? `${CLOUDINARY_DELIVERY_BASE}/${cfg.cloudName}/image/upload/${uid}`
        : undefined;

    return { uploadUrl, uid, fields, deliveryUrl };
  }

  async deleteImage(
    uid: string,
    access: CreateImageUploadOpts['access'],
  ): Promise<void> {
    const cfg = loadConfig();
    const timestamp = Math.floor(Date.now() / 1000);
    const type = access === 'authenticated' ? 'authenticated' : 'upload';

    const signed: Record<string, string | number> = {
      public_id: uid,
      timestamp,
      type,
    };
    const signature = signParams(signed, cfg.apiSecret);
    const form = new URLSearchParams({
      public_id: uid,
      timestamp: String(timestamp),
      type,
      api_key: cfg.apiKey,
      signature,
    });

    const res = await fetch(
      `${CLOUDINARY_API_BASE}/${cfg.cloudName}/image/destroy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      },
    );
    const body = (await res
      .json()
      .catch(() => null)) as CloudinaryDestroyResult | null;

    if (body?.result === 'not found') return;
    if (!res.ok || body?.result !== 'ok') {
      const msg =
        body?.error?.message ??
        `Cloudinary image destroy failed (HTTP ${res.status})`;
      throw new Error(msg);
    }
  }

  async signedImageUrl(uid: string): Promise<string> {
    const cfg = loadConfig();

    // Authenticated images are progress photos and payment receipts —
    // near-nude body imagery and financial documents. Cloudinary's default
    // signed-URL scheme (the s--<sig>-- below) has NO per-request expiry, so
    // without the private-CDN url-signing key there is no way to make the
    // link ever stop working short of deleting the asset: a single capture
    // (proxy/CDN log, mobile image cache, browser history, a shared
    // screenshot of the address bar) would grant indefinite access. Treat the
    // signing key as a hard prerequisite for this method rather than quietly
    // degrading to a non-expiring link.
    if (!cfg.urlSigningKey) throw new NotConfiguredError(['CLOUDINARY_URL_SIGNING_KEY']);

    // Same signed-delivery scheme as signedPlaybackUrl, but resource_type=
    // image and a f_auto,q_auto transformation instead of an HLS profile. The
    // `.jpg` extension is a URL-syntax requirement, not a format directive —
    // f_auto negotiates the real stored format (png/heic/webp/etc) regardless.
    const transformation = 'f_auto,q_auto';
    const publicIdWithExt = `${uid}.jpg`;

    const toSign = `${transformation}/${publicIdWithExt}`;
    const signature = signDeliveryComponent(toSign, cfg.apiSecret);

    // Cloudinary signed authenticated image delivery URL:
    //   https://res.cloudinary.com/<cloud>/image/authenticated/
    //     s--<sig>--/<transformation>/<public_id>.jpg
    const baseUrl =
      `${CLOUDINARY_DELIVERY_BASE}/${cfg.cloudName}/image/authenticated/` +
      `s--${signature}--/${transformation}/${publicIdWithExt}`;

    const token = authTokenQuery(baseUrl, cfg.urlSigningKey, PLAYBACK_TTL_SECONDS);
    return `${baseUrl}?${token}`;
  }
}

/**
 * Cloudinary context values are pipe/equals-delimited; strip those chars so a
 * label can't corrupt the context string (and thus the signature match).
 */
function sanitizeContextValue(value: string): string {
  return value.replace(/[|=]/g, ' ').trim().slice(0, 200);
}

/**
 * Verify (via the Cloudinary Admin API) that an authenticated video asset with
 * `uid` has actually been uploaded before the console flips the row to 'ready'
 * (defect F4). The direct-creator-upload confirm step is otherwise a bare
 * client-trusted `{status:'ready'}` — a caller could mark a video ready that
 * was never uploaded (or whose upload failed), leaving paying members with a
 * broken player.
 *
 * Not part of the VideoProvider interface: this is a Cloudinary-only check the
 * admin video route calls directly for cloudinary-hosted rows. Uses HTTP Basic
 * auth (api_key:api_secret) over the resource-details endpoint.
 *
 * Returns true when the asset exists, false on a definitive 404 (not uploaded).
 * Throws NotConfiguredError when Cloudinary env is absent, or a generic Error
 * on an ambiguous/transient failure — the caller decides whether to fail open.
 */
export async function verifyCloudinaryAsset(uid: string): Promise<boolean> {
  const cfg = loadConfig();
  const auth = Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString('base64');
  // GET /resources/{resource_type}/{type}/{public_id} → 200 with details when
  // the asset exists, 404 when it does not. public_id here is a plain UUID.
  const url =
    `${CLOUDINARY_API_BASE}/${cfg.cloudName}/resources/video/authenticated/` +
    encodeURIComponent(uid);

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}` },
  });

  if (res.ok) return true;
  if (res.status === 404) return false;
  throw new Error(`Cloudinary resource check failed (HTTP ${res.status})`);
}
