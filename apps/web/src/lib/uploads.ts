/**
 * Server-side validation for Cloudinary image delivery URLs that clients hand
 * back after uploading through POST /api/uploads/image.
 *
 * That endpoint's `deliveryUrl` is exactly
 *   https://res.cloudinary.com/<CLOUDINARY_CLOUD_NAME>/image/upload/<kind>/<uuid>
 * (see CloudinaryProvider.createImageUpload — `folder` is the sanitized kind
 * and `public_id` is a randomUUID). Anything else — another Cloudinary
 * account's cloud, another delivery type (notably `image/fetch/<remote-url>`,
 * which would proxy attacker-controlled content and leak every viewer's
 * request metadata), a transformation segment, a query string — is NOT a URL
 * we minted and must be rejected. A host-prefix check alone is not enough.
 */

/** node:crypto randomUUID output: lowercase hex 8-4-4-4-12. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * True iff `url` is a delivery URL our own /api/uploads/image could have
 * returned for one of the given upload kinds, on OUR configured Cloudinary
 * cloud. Exact string shape — no fetch/private/authenticated delivery types,
 * no foreign clouds, no trailing path or query. Returns false when Cloudinary
 * isn't configured (no cloud name → nothing we minted can exist).
 */
export function isOwnImageDeliveryUrl(
  url: string,
  kinds: readonly string[],
): boolean {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName) return false;
  return kinds.some((kind) => {
    const prefix = `https://res.cloudinary.com/${cloudName}/image/upload/${kind}/`;
    return url.startsWith(prefix) && UUID_RE.test(url.slice(prefix.length));
  });
}
