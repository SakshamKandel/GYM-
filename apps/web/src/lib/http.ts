import { NextResponse } from 'next/server';

/**
 * The Expo web dev server runs on another port, so every response is CORS-open.
 *
 * This is layer 2 of the policy written out in full in src/lib/cors.ts: it
 * covers whatever the middleware allowlist does not stamp. Note that for /api/*
 * the middleware answers OPTIONS itself, so `preflight()` below only actually
 * runs for the handful of routes outside that prefix.
 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store',
  Vary: 'Origin, Authorization',
};

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return (await req.json()) as unknown;
  } catch {
    return null;
  }
}
