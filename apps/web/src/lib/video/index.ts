/**
 * Video provider entry point.
 *
 * `getVideoProvider()` returns the configured provider. Selection is env-driven:
 *   - VIDEO_PROVIDER='cloudinary' → CloudinaryProvider
 *   - VIDEO_PROVIDER='cf_stream'  → CloudflareStreamProvider
 *   - unset → default to 'cloudinary' when CLOUDINARY_* keys are present,
 *             otherwise fall back to 'cf_stream'.
 * It always returns an instance — construction is cheap and env is only read
 * (and validated) when a method is actually called, so callers get a typed
 * NotConfiguredError at call time rather than at import time. This keeps
 * `next build` from requiring keys.
 *
 * `isVideoConfigured()` is a cheap boolean check (no network) for feature-
 * gating UI or short-circuiting routes before doing work. It reflects the
 * SELECTED provider's env.
 *
 * `isImageConfigured()` is the image-side equivalent, BUT unlike video it is
 * NOT selection-dependent: only Cloudinary implements images today (Cloudflare
 * Stream is video-only, see cloudflareStream.ts), so this simply reports
 * whether the Cloudinary env is present. A route should still catch
 * NotConfiguredError around the real call — if VIDEO_PROVIDER is pinned to
 * 'cf_stream' while Cloudinary keys also happen to exist, getVideoProvider()
 * returns the Cloudflare instance and image calls will still throw even
 * though this check reports true — this is a cheap early-exit UI hint, not
 * the enforcement point.
 */

import { CloudflareStreamProvider } from './cloudflareStream';
import { CloudinaryProvider } from './cloudinaryProvider';
import type { VideoProvider } from './types';

export type {
  VideoProvider,
  CreateUploadMeta,
  CreateUploadResult,
  CreateImageUploadOpts,
  CreateImageUploadResult,
} from './types';
export { NotConfiguredError } from './types';

type ProviderKind = 'cloudinary' | 'cf_stream';

/** True when all Cloudinary env vars are present. */
function hasCloudinaryEnv(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  );
}

/** True when all Cloudflare Stream env vars are present. */
function hasCfStreamEnv(): boolean {
  return Boolean(
    process.env.CF_STREAM_ACCOUNT_ID &&
      process.env.CF_STREAM_API_TOKEN &&
      process.env.CF_STREAM_KEY_ID &&
      process.env.CF_STREAM_JWK,
  );
}

/**
 * Resolve which provider is active. Explicit VIDEO_PROVIDER wins; otherwise
 * prefer Cloudinary when its keys exist, else Cloudflare Stream.
 */
function selectedProviderKind(): ProviderKind {
  const explicit = process.env.VIDEO_PROVIDER?.trim().toLowerCase();
  if (explicit === 'cloudinary') return 'cloudinary';
  if (explicit === 'cf_stream') return 'cf_stream';
  return hasCloudinaryEnv() ? 'cloudinary' : 'cf_stream';
}

let provider: VideoProvider | null = null;
let providerKind: ProviderKind | null = null;
let imageProvider: VideoProvider | null = null;

/** Configured video provider. Singleton; methods do the env check at call time. */
export function getVideoProvider(): VideoProvider {
  const kind = selectedProviderKind();
  // Rebuild if the selection changed (e.g. env mutated between calls in tests).
  if (!provider || providerKind !== kind) {
    provider =
      kind === 'cloudinary'
        ? new CloudinaryProvider()
        : new CloudflareStreamProvider();
    providerKind = kind;
  }
  return provider;
}

/**
 * Image operations always use Cloudinary. They must not inherit VIDEO_PROVIDER:
 * video can be served by Cloudflare Stream while private images stay in
 * Cloudinary.
 */
export function getImageProvider(): VideoProvider {
  imageProvider ??= new CloudinaryProvider();
  return imageProvider;
}

/**
 * True when every env var the SELECTED provider needs is present. Does NOT
 * validate secret contents or hit the network — use for UI gating / early 503s.
 */
export function isVideoConfigured(): boolean {
  return selectedProviderKind() === 'cloudinary'
    ? hasCloudinaryEnv()
    : hasCfStreamEnv();
}

/**
 * True when the Cloudinary env (the only image-capable provider today) is
 * present. See the module doc comment above for the selection-mismatch
 * caveat — routes still catch NotConfiguredError around the real call.
 */
export function isImageConfigured(): boolean {
  return hasCloudinaryEnv();
}
