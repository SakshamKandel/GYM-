import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Local Expo dev origins allowed to call /api/* cross-origin (Expo web dev
 * server ports). Kept to an explicit localhost allowlist: the API uses Bearer
 * tokens (no ambient cookies), but there is still no reason to reflect
 * arbitrary origins. Production mobile/web traffic is same-origin or native
 * (no CORS preflight), so nothing else needs listing.
 */
const DEV_CORS_ORIGINS = new Set([
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:19006',
]);

function applyCors(res: NextResponse, origin: string): void {
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Vary', 'Origin');
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.headers.set('Access-Control-Max-Age', '86400');
}

/**
 * Two jobs:
 * 1. /api/*: answer CORS preflights and stamp allow-origin headers for the
 *    Expo web dev servers (without this, every fetch from expo web dev to the
 *    deployed API fails the preflight and floods the console).
 * 2. /coach|/admin|/partner: publish the request pathname as `x-pathname` so
 *    server components (notably coach/layout.tsx, which must let /coach/login
 *    through its auth guard without a redirect loop) can read it — request
 *    headers are otherwise unavailable to layouts in the App Router.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/api/')) {
    const origin = req.headers.get('origin');
    const allowed = origin !== null && DEV_CORS_ORIGINS.has(origin);
    if (req.method === 'OPTIONS') {
      const res = new NextResponse(null, { status: 204 });
      if (allowed && origin) applyCors(res, origin);
      return res;
    }
    const res = NextResponse.next();
    if (allowed && origin) applyCors(res, origin);
    return res;
  }

  const headers = new Headers(req.headers);
  headers.set('x-pathname', pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/coach/:path*', '/admin/:path*', '/partner/:path*', '/api/:path*'],
};
