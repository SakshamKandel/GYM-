import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Publishes the request pathname as `x-pathname` so server components (notably
 * coach/layout.tsx, which must let /coach/login through its auth guard without
 * a redirect loop) can read it. Request headers are otherwise unavailable to
 * layouts in the App Router. Scoped to /coach/* and /admin/* (both use the same
 * login-escape trick in their layout guard) to stay out of the mobile API.
 */
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set('x-pathname', req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/coach/:path*', '/admin/:path*'],
};
