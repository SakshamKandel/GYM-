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
 */

import { CloudflareStreamProvider } from './cloudflareStream';
import { CloudinaryProvider } from './cloudinaryProvider';
import type { VideoProvider } from './types';

export type {
  VideoProvider,
  CreateUploadMeta,
  CreateUploadResult,
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
 * True when every env var the SELECTED provider needs is present. Does NOT
 * validate secret contents or hit the network — use for UI gating / early 503s.
 */
export function isVideoConfigured(): boolean {
  return selectedProviderKind() === 'cloudinary'
    ? hasCloudinaryEnv()
    : hasCfStreamEnv();
}
