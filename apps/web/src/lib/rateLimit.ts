import { NextResponse } from 'next/server';
import { CORS_HEADERS } from './http';

/**
 * Rate limiting in two flavours.
 *
 * `rateLimit()` is the synchronous in-memory sliding window most routes use.
 * Its window lives in module memory, so it is PER INSTANCE: on Vercel/Lambda
 * each warm instance counts independently and a cold start resets the window,
 * which makes the real ceiling `limit × instances` — best-effort abuse damping,
 * not a hard quota. Fine for the read paths it guards.
 *
 * `rateLimitShared()` is the durable version for the routes where the ceiling
 * has to actually hold. When a Redis REST store is configured it counts in that
 * store, so every instance shares one budget; with no store configured — and
 * whenever the store is too slow or unreachable — it delegates straight to
 * `rateLimit()`, so local development and any un-migrated route behave exactly
 * as before. It is async, which is why it is a separate
 * export rather than a change to `rateLimit()` — that one is called from ~50
 * places and must keep its synchronous signature.
 *
 * Wired into every credential path: /api/auth/login, /api/auth/register,
 * /api/auth/google, /api/auth/apple (+ its nonce), /api/auth/forgot-password
 * (both the per-IP and the per-address budget), /api/auth/reset-password,
 * /api/auth/logout-all and /api/staff/login. NOT yet wired into
 * /api/staff/reauth or /api/payments/requests — both still count per instance;
 * they are owned elsewhere and want the same one-line swap.
 *
 * Both return the SAME 429 body: { error: 'rate_limited', retryAfterSec } with
 * a Retry-After header.
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
    return tooManyRequests(retryAfterSec);
  }

  stamps.push(now);
  hits.set(key, { stamps, windowMs });
  return null;
}

/** The 429 every limiter returns. Shape is fixed — shipped clients parse it. */
function tooManyRequests(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: 'rate_limited', retryAfterSec },
    { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': String(retryAfterSec) } },
  );
}

interface SharedStore {
  url: string;
  token: string;
}

/**
 * Redis REST credentials, if any. Accepts both the Upstash names and the names
 * Vercel's KV integration injects, so either provisioning route works with no
 * code change. Nothing configured (the normal local setup) → null → the
 * in-memory limiter.
 */
function sharedStore(): SharedStore | null {
  const url = (process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? '')
    .trim()
    .replace(/\/+$/, '');
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? '').trim();
  if (!url || !token) return null;
  return { url, token };
}

/**
 * How long the shared store may hold up ONE limiter check, counted across both
 * commands a check can issue rather than per request, so the worst case a
 * caller waits is this budget and not a multiple of it.
 *
 * It is deliberately short. `rateLimitShared` is the FIRST await on every
 * credential path (sign-in, registration, staff login, password reset), so this
 * number is the delay a member would feel on the way to signing in if the store
 * ever stopped answering. A healthy Redis REST round trip is single-digit
 * milliseconds, so anything past a second is already an outage, not slowness.
 */
const STORE_BUDGET_MS = 1_000;

/**
 * One Upstash-style REST pipeline call, abandoned once `deadline` passes.
 * Throws on any transport/protocol problem, including the timeout — the caller
 * treats every throw the same way (see `rateLimitShared`).
 */
async function pipeline(
  store: SharedStore,
  commands: readonly (readonly (string | number)[])[],
  deadline: number,
): Promise<unknown[]> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error('rate-limit store ran out of time');
  const res = await fetch(`${store.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${store.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
    cache: 'no-store',
    // Without this the fetch has NO timeout of its own: a store that accepts
    // the connection and then stalls would hang sign-in for as long as the
    // platform allows the request to live.
    signal: AbortSignal.timeout(remainingMs),
  });
  if (!res.ok) throw new Error(`rate-limit store responded ${res.status}`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error('rate-limit store returned an unexpected shape');
  return body;
}

/** Reads one pipeline entry as an integer, surfacing a per-command error. */
function integerAt(entries: readonly unknown[], index: number): number {
  const entry = entries[index];
  if (typeof entry !== 'object' || entry === null) {
    throw new Error('rate-limit store returned an unexpected entry');
  }
  const record = entry as { result?: unknown; error?: unknown };
  if (typeof record.error === 'string') throw new Error(record.error);
  if (typeof record.result === 'number') return record.result;
  if (typeof record.result === 'string') {
    const parsed = Number(record.result);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error('rate-limit store returned a non-numeric count');
}

/**
 * Durable counterpart to `rateLimit()` — same args, same 429, same null-means-
 * continue contract, but the count lives in a shared Redis store so warm
 * instances cannot each hand out a fresh budget.
 *
 * Fixed window rather than sliding: the window index is baked into the key, so
 * the counter rolls over on its own even if the expiry command is lost.
 *
 * IT FAILS OPEN, ON PURPOSE. A store that is unreachable, slow, or answering
 * nonsense costs us the SHARED ceiling, not the ability to sign in: we log,
 * then hand the check to the in-memory limiter, which still damps abuse per
 * instance. Failing closed would turn one dependency's bad afternoon into a
 * total lockout of sign-in, registration and password reset for everyone, which
 * is a far worse outcome than a temporarily looser limit. `STORE_BUDGET_MS`
 * caps how long that decision may take, so a store that hangs degrades the
 * protection quickly instead of dragging every credential request down with it.
 */
export async function rateLimitShared(args: RateLimitArgs): Promise<NextResponse | null> {
  const store = sharedStore();
  if (!store) return rateLimit(args);

  const windowMs = Math.max(1, Math.floor(args.windowMs));
  const subject = args.accountId ? `acct:${args.accountId}` : `ip:${args.ip ?? 'unknown'}`;
  const windowIndex = Math.floor(Date.now() / windowMs);
  const key = `rl:${args.route}|${subject}|${windowIndex}`;
  const deadline = Date.now() + STORE_BUDGET_MS;

  let count: number;
  let ttlMs: number;
  try {
    const entries = await pipeline(
      store,
      [
        ['INCR', key],
        ['PTTL', key],
      ],
      deadline,
    );
    count = integerAt(entries, 0);
    ttlMs = integerAt(entries, 1);
    // -1 = key with no expiry (we just created it), -2 = already gone.
    if (ttlMs < 0) {
      // Best effort, and separately caught: the count is already known and the
      // window index is baked into the key, so a lost expiry only leaves one
      // key behind for the store to evict. It must not discard a real count.
      try {
        await pipeline(store, [['PEXPIRE', key, windowMs]], deadline);
      } catch (err) {
        console.error(`[rateLimit] could not set expiry for ${args.route}:`, err);
      }
      ttlMs = windowMs;
    }
  } catch (err) {
    // FAIL OPEN — see the note above. Timeout, outage or garbage response, the
    // answer is the same: keep the door open and count per instance instead.
    console.error(
      `[rateLimit] shared store unavailable for ${args.route}; counting per-instance instead:`,
      err,
    );
    return rateLimit(args);
  }

  if (count > args.limit) {
    return tooManyRequests(Math.max(1, Math.ceil(ttlMs / 1000)));
  }
  return null;
}
