import { NextResponse } from 'next/server';
import { CORS_HEADERS } from './http';

/**
 * In-memory sliding-window rate limiter.
 *
 * SERVERLESS CAVEAT: the window lives in module memory, so it is PER INSTANCE.
 * On Vercel/Lambda each warm instance counts independently and a cold start
 * resets the window — so the real ceiling is `limit × instances`, and this is
 * best-effort abuse damping, NOT a hard quota. That is acceptable for the
 * current scale; when it stops being acceptable, swap the Map for a shared
 * store (Upstash Redis / Vercel KV) behind the same rateLimit() signature.
 *
 * Keying: callers pass the route name plus the caller identity — the account
 * id when authenticated (limits follow the user across IPs), else the client
 * IP (first hop of x-forwarded-for; on Vercel that hop is platform-set and
 * trustworthy, but self-hosted deployments without a trusted proxy should
 * treat it as advisory since clients can forge the header).
 */

interface Bucket {
  stamps: number[];
  /** The largest window length that has keyed this bucket (its sweep horizon). */
  windowMs: number;
}

const hits = new Map<string, Bucket>();

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
let lastSweepAt = 0;

/**
 * Drop identities idle past their OWN window so the Map can't grow unbounded
 * (B12). A single global horizon (formerly 1h) was shorter than the payments
 * routes' 24h window, so an idle payment caller's stamps were swept after ~1h
 * and the "5/day" budget silently reset. Each bucket now records the widest
 * window that has keyed it and is only evicted once idle past that window.
 */
function sweep(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, bucket] of hits) {
    const newest = bucket.stamps[bucket.stamps.length - 1];
    if (newest === undefined || newest < now - bucket.windowMs) hits.delete(key);
  }
}

/** First hop of x-forwarded-for (the client), else x-real-ip, else 'unknown'. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

export interface RateLimitArgs {
  /** Route tag, e.g. 'auth/login' — separates budgets between endpoints. */
  route: string;
  /** Max requests per window. */
  limit: number;
  /** Window length in milliseconds. The sweeper evicts idle keys per-window. */
  windowMs: number;
  /** Client IP (clientIp(req)) — the key for unauthenticated endpoints. */
  ip?: string | null;
  /** Account id — when set, the budget follows the account, not the IP. */
  accountId?: string | null;
}

/**
 * Returns a ready-to-send 429 (with Retry-After) when the caller is over
 * budget, or null to continue. Usage:
 *
 *   const limited = rateLimit({ route: 'auth/login', limit: 10, windowMs: 60_000, ip: clientIp(req) });
 *   if (limited) return limited;
 */
export function rateLimit(args: RateLimitArgs): NextResponse | null {
  const now = Date.now();
  sweep(now);

  const subject = args.accountId ? `acct:${args.accountId}` : `ip:${args.ip ?? 'unknown'}`;
  const key = `${args.route}|${subject}`;
  const cutoff = now - args.windowMs;
  const prev = hits.get(key);
  const stamps = (prev?.stamps ?? []).filter((t) => t > cutoff);
  // The sweeper horizon for this key is the widest window it has ever seen, so
  // a longer-window caller's stamps survive until that window fully elapses.
  const windowMs = Math.max(prev?.windowMs ?? 0, args.windowMs);

  if (stamps.length >= args.limit) {
    hits.set(key, { stamps, windowMs });
    const oldest = stamps[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + args.windowMs - now) / 1000));
    return NextResponse.json(
      { error: 'rate_limited', retryAfterSec },
      { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': String(retryAfterSec) } },
    );
  }

  stamps.push(now);
  hits.set(key, { stamps, windowMs });
  return null;
}
