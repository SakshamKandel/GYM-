import { accounts, devicePushTokens } from '@gym/db';
import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';
// Raise the Vercel serverless ceiling for this route: a large fan-out issues
// many 500-token FCM batches and MUST finish inside one invocation so the
// post-send audit row is always reached (a mid-fan-out timeout would deliver
// real pushes but leave zero trace). Vercel clamps this to the plan's max.
export const maxDuration = 300;

/**
 * Admin broadcast / announcements (gap build P0-4).
 *
 *  - POST → send a push notification to every device registered to accounts
 *           matching an optional { tier, country } filter. Fans out over
 *           device_push_tokens in batches (FCM multicast caps at 500 tokens per
 *           call), prunes tokens FCM reports dead, and writes ONE audit row
 *           carrying the recipient count.
 *
 * Gated on the effective `broadcast.send` permission (role preset plus explicit
 * account overrides) through the same fail-closed guard as every admin API.
 *
 * Fan-out is implemented here (not via lib/push's per-account sender) because a
 * broadcast addresses tokens in bulk. It reuses an already-initialized
 * firebase-admin app when present, else initializes from
 * FIREBASE_SERVICE_ACCOUNT_B64; when that credential is absent it returns 503
 * push_not_configured so the operator gets an honest signal instead of a silent
 * no-op.
 */

const TIERS = ['starter', 'silver', 'gold', 'elite'] as const;

const broadcastSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(500),
  // Optional audience filters. `tier` matches the member's EFFECTIVE tier
  // (a lapsed paid tier collapses to starter — see the CASE below), not the
  // raw stored accounts.tier. `country` is an ISO-3166 alpha-2 code matched
  // case-insensitively against accounts.country (stored as an uppercased
  // alpha-2 hint, e.g. 'NP'); a human-readable country like 'Nepal' is
  // rejected up front rather than silently matching zero recipients.
  tier: z.enum(TIERS).optional(),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'country must be a 2-letter ISO-3166 alpha-2 code (e.g. NP)')
    .optional(),
});

/** FCM multicast hard limit per call. */
const FCM_MULTICAST_BATCH = 500;

/**
 * Upper bound on device tokens loaded and sent in a single broadcast
 * invocation. Both filters are optional, so an unfiltered send would otherwise
 * pull EVERY registered token into memory and fan out over an unbounded number
 * of sequential batches — at scale that overruns the serverless ceiling and the
 * send goes out with no audit trace. Capping the load bounds memory and
 * wall-clock; audiences past the cap are reported `truncated` (an honest signal
 * to narrow the filter) instead of a silent partial send.
 */
const MAX_BROADCAST_TOKENS = 20_000;

/** How many 500-token FCM batches to dispatch concurrently (bounds wall-clock). */
const SEND_CONCURRENCY = 8;

/** Best-effort caller IP for the audit trail (proxy header, first hop). */
function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip');
}

/**
 * Resolve a firebase-admin App, reusing one another module already initialized
 * (lib/push) so we never double-init. Returns null when the credential env is
 * absent or malformed — the caller 503s.
 */
function resolveFirebaseApp(): App | null {
  const existing = getApps()[0];
  if (existing) return existing;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) return null;
  try {
    const raw = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as {
      project_id: string;
      client_email: string;
      private_key: string;
    };
    const serviceAccount: ServiceAccount = {
      projectId: raw.project_id,
      clientEmail: raw.client_email,
      privateKey: raw.private_key,
    };
    return initializeApp({ credential: cert(serviceAccount) });
  } catch (err) {
    console.error('[broadcast] firebase init failed', err);
    return null;
  }
}

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'broadcast.send');
  if (principal instanceof Response) return principal;

  const parsed = broadcastSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { title, body, tier, country } = parsed.data;

  const app = resolveFirebaseApp();
  if (!app) return json({ error: 'push_not_configured' }, 503);

  const db = getDb();

  // Collect the target tokens: active accounts matching the optional filters,
  // joined to their registered devices.
  const filters = [eq(accounts.status, 'active')];
  // Match EFFECTIVE tier, not the raw column: a paid tier whose window has
  // lapsed (tierExpiresAt in the past) collapses to 'starter' — mirrors the
  // effectiveTier() helper so an expired member is not counted as still paid.
  // A null tierExpiresAt (permanent/free) yields NULL <= now() → falsy → the
  // stored tier stands.
  if (tier) {
    filters.push(
      sql`(case when ${accounts.tier} <> 'starter' and ${accounts.tierExpiresAt} <= now() then 'starter' else ${accounts.tier} end) = ${tier}`,
    );
  }
  // Country is normalized to uppercase and compared case-insensitively so a
  // lowercase 'np' hint still matches stored 'NP'.
  const countryCode = country?.toUpperCase();
  if (countryCode) filters.push(sql`upper(${accounts.country}) = ${countryCode}`);

  // Load at most MAX_BROADCAST_TOKENS+1 rows: the +1 lets us detect (and report)
  // an audience that exceeds the cap without unbounded memory growth.
  const rows = await db
    .select({ token: devicePushTokens.token, accountId: devicePushTokens.accountId })
    .from(devicePushTokens)
    .innerJoin(accounts, eq(accounts.id, devicePushTokens.accountId))
    .where(and(...filters))
    .limit(MAX_BROADCAST_TOKENS + 1);

  const truncated = rows.length > MAX_BROADCAST_TOKENS;
  const usableRows = truncated ? rows.slice(0, MAX_BROADCAST_TOKENS) : rows;

  const tokens = usableRows
    .map((r) => r.token)
    .filter((t): t is string => typeof t === 'string' && t.length > 0);
  const accountCount = new Set(usableRows.map((r) => r.accountId)).size;

  // Split into ≤500-token batches, then dispatch up to SEND_CONCURRENCY of them
  // at a time. Bounded concurrency keeps the total fan-out well inside the
  // serverless budget (vs. one slow sequential await chain) so the audit row is
  // always reached; the cap above guarantees a finite batch count.
  const batches: string[][] = [];
  for (let i = 0; i < tokens.length; i += FCM_MULTICAST_BATCH) {
    batches.push(tokens.slice(i, i + FCM_MULTICAST_BATCH));
  }

  let delivered = 0;
  let failed = 0;
  const staleTokens: string[] = [];
  const messaging = getMessaging(app);

  let cursor = 0;
  const sendBatch = async (): Promise<void> => {
    // `batches[cursor++]` reads-and-increments with no intervening await, so the
    // single-threaded event loop hands each worker a distinct batch.
    while (cursor < batches.length) {
      const batch = batches[cursor++]!;
      try {
        const res = await messaging.sendEachForMulticast({
          tokens: batch,
          notification: { title, body },
          data: { type: 'broadcast' },
          android: { priority: 'high', notification: { channelId: 'default', sound: 'default' } },
        });
        delivered += res.successCount;
        failed += res.failureCount;
        res.responses.forEach((r, idx) => {
          if (r.success) return;
          const code = r.error?.code;
          if (
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/invalid-argument'
          ) {
            const stale = batch[idx];
            if (stale) staleTokens.push(stale);
          }
        });
      } catch (err) {
        console.error('[broadcast] batch send failed', err);
        failed += batch.length;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SEND_CONCURRENCY, batches.length) }, () => sendBatch()),
  );

  if (staleTokens.length > 0) {
    try {
      await db.delete(devicePushTokens).where(inArray(devicePushTokens.token, staleTokens));
    } catch (err) {
      console.error('[broadcast] stale-token prune failed', err);
    }
  }

  // One audit row per broadcast, carrying the recipient count (P0-4 / §4.12).
  await logAudit(
    principal,
    'broadcast.send',
    'broadcast',
    null,
    {
      title,
      tier: tier ?? null,
      country: countryCode ?? null,
      recipients: accountCount,
      devices: tokens.length,
      delivered,
      failed,
      truncated,
    },
    clientIp(req),
  );

  return json(
    { ok: true, recipients: accountCount, devices: tokens.length, delivered, failed, truncated },
    200,
  );
}
