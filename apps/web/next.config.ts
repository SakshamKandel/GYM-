import type { NextConfig } from 'next';

/** The headers every response gets, whatever the path. */
const BASE_SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  // @gym/db ships raw TypeScript (main: src/index.ts) — Next must transpile it.
  transpilePackages: ['@gym/db', '@gym/shared'],
  /**
   * Security headers, split into two rules ONLY because of framing.
   *
   * `X-Frame-Options: DENY` refuses framing from every origin including our
   * own, and one path has to be framed by us: `/anatomy/*` is the self-contained
   * 3D muscle viewer that the training page embeds in a same-origin iframe
   * (components/marketing/Anatomy3D.tsx). Under a blanket DENY that whole
   * section rendered an empty box. `SAMEORIGIN`, plus the modern
   * `frame-ancestors 'self'` that supersedes it, lets our own pages embed the
   * viewer while still refusing every other site. Everything else — the
   * consoles, the API, the marketing pages themselves — keeps DENY.
   *
   * The two sources MUST stay mutually exclusive. Next applies every matching
   * rule, so an overlap would send X-Frame-Options twice, and browsers treat a
   * doubled or conflicting value as DENY — silently undoing this fix. Hence the
   * negative lookahead on the first rule, and `:path+` (one or more segments)
   * rather than `:path*` on the second, so bare `/anatomy` matches only the
   * first rule.
   */
  async headers() {
    return [
      {
        source: '/((?!anatomy/).*)',
        headers: [...BASE_SECURITY_HEADERS, { key: 'X-Frame-Options', value: 'DENY' }],
      },
      {
        source: '/anatomy/:path+',
        headers: [
          ...BASE_SECURITY_HEADERS,
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
