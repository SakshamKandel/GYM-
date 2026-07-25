import { accounts, devicePushTokens, notificationPrefs, notifications } from '@gym/db';
import {
  notificationDelivery,
  type NotificationEvent,
  type NotificationPrefs,
} from '@gym/shared';
import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditIp, logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { ktmMinuteOfDay } from '@/lib/notify';

export const runtime = 'nodejs';
// Raise the Vercel serverless ceiling for this route: a large fan-out writes
// many chunked inbox inserts and issues many 500-token FCM batches, and MUST
// finish inside one invocation so the post-send audit row is always reached (a
// mid-fan-out timeout would deliver real pushes but leave zero trace). Vercel
// clamps this to the plan's max.
export const maxDuration = 300;

/**
 * Admin broadcast / announcements (gap build P0-4).
 *
 *  - POST → announce to every account matching an optional { tier, country }
 *           filter. Each recipient gets the SAME treatment notify() gives a
 *           single account: the shared prefs/quiet-hours decision, a durable
 *           inbox row, then the push. Fans out over device_push_tokens in
 *           batches (FCM multicast caps at 500 tokens per call), prunes tokens
 *           FCM reports dead, and writes ONE audit row carrying the tallies.
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
 *
 * The inbox rows are written already-resolved (sentAt stamped): this invocation
 * owns the push leg, so `retry-unsent` must never adopt them.
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

/** The one event key this route sends under (its category is `engagement`). */
const BROADCAST_EVENT: NotificationEvent = 'broadcast';

/**
 * The deep-link payload, identical on the inbox row and the FCM message so the
 * mobile router keys on the same `type` whichever path delivered it.
 */
const BROADCAST_DATA = { type: 'broadcast' } as const;

/** FCM multicast hard limit per call. */
const FCM_MULTICAST_BATCH = 500;

/** Rows per inbox insert / stale-token delete — keeps bind parameters bounded. */
const INBOX_INSERT_CHUNK = 500;

/**
 * Upper bound on ACCOUNTS addressed in a single broadcast invocation. Both
 * filters are optional, so an unfiltered send would otherwise pull every
 * account into memory before a single row is written. Audiences past the cap
 * are reported `truncated` (an honest signal to narrow the filter) instead of
 * a silent partial send.
 */
const MAX_BROADCAST_RECIPIENTS = 20_000;

/**
 * Upper bound on device tokens loaded and sent in a single broadcast
 * invocation. At scale an unbounded load overruns the serverless ceiling and
 * the send goes out with no audit trace. Capping bounds memory and wall-clock;
 * the overflow is reported as `truncated`, same as the recipient cap.
 */
const MAX_BROADCAST_TOKENS = 20_000;

/** How many 500-token FCM batches to dispatch concurrently (bounds wall-clock). */
const SEND_CONCURRENCY = 8;

/** Is per-account preference + quiet-hours gating enforced? (default: yes.) */
function prefsEnforced(): boolean {
  return process.env.NOTIF_PREFS_ENFORCED !== 'false';
}

/** Splits `items` into consecutive slices of at most `size`. */
function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
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

  // ── 1. Audience ────────────────────────────────────────────────
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

  // Every matching account — NOT only the ones with a registered device. A
  // member who denied push permission still reads the inbox, and that row is the
  // whole point of routing through the pipeline. Ordered by id and capped at
  // MAX_BROADCAST_RECIPIENTS+1 so the overflow is detectable without unbounded
  // memory; the deterministic order also keeps this slice and the token slice
  // below covering the same accounts.
  const audienceRows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(...filters))
    .orderBy(asc(accounts.id))
    .limit(MAX_BROADCAST_RECIPIENTS + 1);

  const recipientsTruncated = audienceRows.length > MAX_BROADCAST_RECIPIENTS;
  const audienceIds = (
    recipientsTruncated ? audienceRows.slice(0, MAX_BROADCAST_RECIPIENTS) : audienceRows
  ).map((r) => r.id);

  // ── 2. Preferences (one set-based read, not one per member) ────
  // Only accounts that HAVE a prefs row come back; a missing row is all-on, which
  // is exactly what notificationDelivery(null, …) already means. Joined on the
  // same audience filters (no giant IN list) and ordered/capped the same way.
  const prefsById = new Map<string, NotificationPrefs>();
  if (audienceIds.length > 0 && prefsEnforced()) {
    const prefRows = await db
      .select({
        accountId: notificationPrefs.accountId,
        categories: notificationPrefs.categories,
        quietHoursStart: notificationPrefs.quietHoursStart,
        quietHoursEnd: notificationPrefs.quietHoursEnd,
      })
      .from(notificationPrefs)
      .innerJoin(accounts, eq(accounts.id, notificationPrefs.accountId))
      .where(and(...filters))
      .orderBy(asc(notificationPrefs.accountId))
      .limit(MAX_BROADCAST_RECIPIENTS);
    for (const row of prefRows) {
      prefsById.set(row.accountId, {
        categories: (row.categories ?? {}) as NotificationPrefs['categories'],
        quietHoursStart: row.quietHoursStart,
        quietHoursEnd: row.quietHoursEnd,
      });
    }
  }

  // ── 3. The shared delivery decision, per account ───────────────
  // One KTM wall-clock reading for the whole send (quiet hours are evaluated on
  // Nepal's fixed offset, same as notify()).
  const nowMinutes = ktmMinuteOfDay(new Date());
  const enforced = prefsEnforced();
  const inboxIds: string[] = [];
  const pushableIds = new Set<string>();
  let suppressed = 0; // category off → nothing written, nothing sent
  let quietHeld = 0; // inside quiet hours → inbox row only

  for (const accountId of audienceIds) {
    const delivery = enforced
      ? notificationDelivery(prefsById.get(accountId) ?? null, BROADCAST_EVENT, nowMinutes)
      : { writeInbox: true, sendPush: true };
    if (!delivery.writeInbox) {
      suppressed += 1;
      continue;
    }
    inboxIds.push(accountId);
    if (delivery.sendPush) pushableIds.add(accountId);
    else quietHeld += 1;
  }

  // ── 4. Durable inbox rows FIRST, chunked ───────────────────────
  // Written already-resolved (sentAt=now): this invocation owns the push leg, so
  // `retry-unsent` must never adopt these rows (see the header note). Best-effort
  // per chunk — a failed chunk is logged and the rest still land, mirroring
  // notify()'s "one bad recipient can't block the others".
  const sentAt = new Date();
  let inboxWritten = 0;
  let inboxFailed = 0;
  for (const ids of chunked(inboxIds, INBOX_INSERT_CHUNK)) {
    try {
      await db.insert(notifications).values(
        ids.map((accountId) => ({
          accountId,
          event: BROADCAST_EVENT,
          title,
          body,
          data: { ...BROADCAST_DATA },
          dedupeKey: null,
          sentAt,
        })),
      );
      inboxWritten += ids.length;
    } catch (err) {
      // Same rule as notify(): no durable row → no push. A pushed announcement
      // whose deep-link opens an inbox that doesn't contain it is worse than a
      // missed one, and the tally below reports the shortfall honestly.
      inboxFailed += ids.length;
      for (const accountId of ids) pushableIds.delete(accountId);
      console.error('[broadcast] inbox insert chunk failed', err);
    }
  }

  // ── 5. Devices of the accounts that are due a push ─────────────
  // Same audience join as before (an indexed join beats a 20k-item IN list),
  // ordered by account id so a truncated slice covers the same accounts as the
  // audience slice, then filtered to the push-eligible set in memory.
  const tokenRows: { token: string; accountId: string }[] =
    pushableIds.size === 0
      ? []
      : await db
          .select({ token: devicePushTokens.token, accountId: devicePushTokens.accountId })
          .from(devicePushTokens)
          .innerJoin(accounts, eq(accounts.id, devicePushTokens.accountId))
          .where(and(...filters))
          .orderBy(asc(devicePushTokens.accountId))
          .limit(MAX_BROADCAST_TOKENS + 1);

  const tokensTruncated = tokenRows.length > MAX_BROADCAST_TOKENS;
  const usableRows = tokensTruncated ? tokenRows.slice(0, MAX_BROADCAST_TOKENS) : tokenRows;
  const truncated = recipientsTruncated || tokensTruncated;

  const tokens = usableRows
    .filter((r) => pushableIds.has(r.accountId))
    .map((r) => r.token)
    .filter((t): t is string => typeof t === 'string' && t.length > 0);

  // ── 6. Bulk push ───────────────────────────────────────────────
  // Split into ≤500-token batches, then dispatch up to SEND_CONCURRENCY of them
  // at a time. Bounded concurrency keeps the total fan-out well inside the
  // serverless budget (vs. one slow sequential await chain) so the audit row is
  // always reached; the cap above guarantees a finite batch count.
  const batches = chunked(tokens, FCM_MULTICAST_BATCH);

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
          // `event` rides alongside `type` exactly as notify() sends it, so the
          // mobile deep-link switch and the notification center key on the same
          // fields whichever path delivered the message.
          data: { ...BROADCAST_DATA, event: BROADCAST_EVENT },
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
      // Chunked: a single delete with 20k bind parameters can blow the statement
      // limit on a large fan-out.
      for (const ids of chunked(staleTokens, INBOX_INSERT_CHUNK)) {
        await db.delete(devicePushTokens).where(inArray(devicePushTokens.token, ids));
      }
    } catch (err) {
      console.error('[broadcast] stale-token prune failed', err);
    }
  }

  // One audit row per broadcast, carrying the recipient count (P0-4 / §4.12).
  // `recipients` = inbox rows written (the durable reach); `devices` = tokens the
  // push actually went to. The prefs/quiet-hours tallies are additive keys the
  // history view ignores until it wants them.
  await logAudit(
    principal,
    'broadcast.send',
    'broadcast',
    null,
    {
      title,
      tier: tier ?? null,
      country: countryCode ?? null,
      recipients: inboxWritten,
      devices: tokens.length,
      delivered,
      failed,
      truncated,
      suppressed,
      quietHours: quietHeld,
      inboxFailed,
    },
    auditIp(req),
  );

  return json(
    {
      ok: true,
      recipients: inboxWritten,
      devices: tokens.length,
      delivered,
      failed,
      truncated,
      suppressed,
      quietHours: quietHeld,
    },
    200,
  );
}
