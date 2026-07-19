/**
 * Provider-agnostic video interface. The concrete implementation (currently
 * Cloudflare Stream) is env-gated: when its required keys are absent, methods
 * throw NotConfiguredError and callers should return 503 video_not_configured.
 *
 * Two-phase upload (direct-creator-upload): the browser uploads straight to the
 * provider using `uploadUrl`, so bytes never pass through Vercel (dodging the
 * Hobby 4.5MB body limit). Only the returned `uid` is stored in our DB.
 *
 * Playback: `signedPlaybackUrl` mints a short-lived signed HLS URL AFTER the
 * caller has done its own tier check — never store or cache this URL.
 *
 * Images (SCALE-UP-PLAN §4.5): the same interface carries a parallel image
 * upload/playback pair (`createImageUpload` / `signedImageUrl`). Today only
 * CloudinaryProvider implements them for real — CloudflareStreamProvider is
 * video-only and throws NotConfiguredError, since image support is orthogonal
 * to which host serves video and callers should 503 the same way.
 */

/** Metadata attached to a direct-creator-upload reservation. */
export interface CreateUploadMeta {
  /** Human label stored on the provider (e.g. the exercise/plan name). */
  name?: string;
  /** Max seconds the upload URL stays valid before it expires. */
  maxDurationSeconds?: number;
}

export interface CreateUploadResult {
  /** One-time URL the browser POSTs the file bytes to. */
  uploadUrl: string;
  /** Provider video id — the ONLY value we persist. Never a public URL. */
  uid: string;
  /**
   * Optional signed form fields the browser must attach alongside the file when
   * POSTing to `uploadUrl` (multipart/form-data). Present for providers that use
   * signed browser uploads (e.g. Cloudinary: api_key, timestamp, public_id,
   * type, signature — NEVER the api_secret). Absent for providers whose
   * `uploadUrl` is a self-contained one-time link (e.g. Cloudflare Stream).
   */
  upload?: Record<string, string>;
}

/** Reservation opts for a direct-creator IMAGE upload. */
export interface CreateImageUploadOpts {
  /**
   * Logical bucket the asset belongs to (e.g. 'progress_photo',
   * 'coach_avatar') — routes validate this against a fixed enum; the provider
   * treats it as an opaque folder segment (sanitized defensively).
   */
  kind: string;
  /**
   * 'public' → the asset is openly readable at `deliveryUrl` forever (avatars,
   * exercise/diet images). 'authenticated' → no public URL is ever handed
   * back; every read must go through `signedImageUrl` AFTER the caller's own
   * authorization check (progress photos, payment receipts).
   */
  access: 'public' | 'authenticated';
}

export interface CreateImageUploadResult {
  /** One-time URL the browser POSTs the file bytes to. */
  uploadUrl: string;
  /** Provider asset id — the value we persist. */
  uid: string;
  /** Signed form fields the browser must attach alongside the file (see CreateUploadResult.upload). */
  fields?: Record<string, string>;
  /**
   * Present ONLY for access:'public' uploads — the stable, unsigned delivery
   * URL, safe to store and render directly with no further signing. Absent
   * for access:'authenticated' uploads; use `signedImageUrl(uid)` instead.
   */
  deliveryUrl?: string;
}

export interface VideoProvider {
  /** Reserve a direct-creator-upload slot; returns the browser upload URL + uid. */
  createDirectUpload(meta: CreateUploadMeta): Promise<CreateUploadResult>;
  /** Mint a short-lived (~2h) signed HLS manifest URL for a stored uid. */
  signedPlaybackUrl(uid: string): Promise<string>;
  /** Permanently delete a video by uid (idempotent — missing video is a no-op). */
  deleteVideo(uid: string): Promise<void>;
  /** Reserve a direct-creator IMAGE upload slot (resource_type image). */
  createImageUpload(opts: CreateImageUploadOpts): Promise<CreateImageUploadResult>;
  /** Mint a short-lived (~2h) signed delivery URL for an authenticated-kind image uid. */
  signedImageUrl(uid: string): Promise<string>;
  /** Permanently delete an image by uid (idempotent when it is already gone). */
  deleteImage(uid: string, access: CreateImageUploadOpts['access']): Promise<void>;
}

/**
 * Thrown when required provider env vars are missing. Routes catch this and
 * return 503 { error: "video_not_configured" }. Real code that activates the
 * moment the owner adds keys — no fake data, no silent stubbing.
 */
export class NotConfiguredError extends Error {
  /** Discriminator so callers can `err instanceof NotConfiguredError` OR check `.code`. */
  readonly code = 'video_not_configured' as const;
  /** Names of the env vars that were missing, for logging/diagnostics. */
  readonly missing: string[];

  constructor(missing: string[]) {
    super(
      `Video provider not configured — missing env: ${missing.join(', ') || '(unknown)'}`,
    );
    this.name = 'NotConfiguredError';
    this.missing = missing;
  }
}
