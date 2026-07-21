/**
 * Local Expo dev origins allowed to call /api/* cross-origin. Matched by
 * pattern rather than a fixed port list: Metro auto-assigns a random port
 * whenever its default (8081) is busy (see apps/mobile — `expo start --port 0`
 * in .claude/launch.json), so a hardcoded allowlist broke on every restart.
 * Safe to widen to any localhost port: the API uses Bearer tokens (no ambient
 * cookies) and a browser can only send `Origin: http://localhost:*` when the
 * calling page is itself served from localhost — no external site can spoof
 * it. Production mobile/web traffic is same-origin or native (no preflight).
 */
export function isAllowedDevOrigin(origin: string): boolean {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin);
}
