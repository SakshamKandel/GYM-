/**
 * CORS lives in TWO layers, and this is the whole policy in one place.
 *
 *  1. src/middleware.ts (this allowlist). Runs before every /api/* request.
 *     It ANSWERS the preflight itself — an OPTIONS to /api/* never reaches the
 *     route handler — and stamps allow-origin headers on the real response,
 *     but only when the caller's Origin is a loopback dev server. Because
 *     middleware headers are set before the handler runs, and Next only adds a
 *     route's header when one isn't already there, these values win wherever
 *     they are stamped.
 *  2. src/lib/http.ts CORS_HEADERS (`Access-Control-Allow-Origin: *`), spread
 *     into every json()/preflight()/csv response. It governs whatever layer 1
 *     leaves alone: requests with no Origin, non-loopback origins, and the few
 *     routes outside the /api prefix whose own OPTIONS handler still runs.
 *
 * Net effect: loopback dev origins get an exact-origin echo, everything else
 * gets `*`. Both are safe for this API — it authenticates with Bearer tokens
 * only, never ambient cookies, so a wide allow-origin grants a third-party page
 * nothing it could not already fetch server-side.
 *
 * Matched by pattern rather than a fixed port list: Metro auto-assigns a random
 * port whenever its default (8081) is busy (see apps/mobile — `expo start
 * --port 0` in .claude/launch.json), so a hardcoded allowlist broke on every
 * restart. Safe to widen to any localhost port: a browser can only send
 * `Origin: http://localhost:*` when the calling page is itself served from
 * localhost. Production mobile/web traffic is same-origin or native.
 */
export function isAllowedDevOrigin(origin: string): boolean {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin);
}
