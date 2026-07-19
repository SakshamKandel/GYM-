import { NextResponse } from 'next/server';

/** The Expo web dev server runs on another port, so every response is CORS-open. */
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
