import { accounts, devicePushTokens, notificationPrefs, notifications } from '@gym/db';
import {
  notificationDelivery,
  type NotificationEvent,
  type NotificationPrefs,
} from '@gym/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditIp, logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { ktmMinuteOfDay } from '@/lib/notify';
import { isFcmConfigured, sendPushToTokens } from '@/lib/push';

export const runtime = 'nodejs';
// Raise the Vercel serverless ceiling for this route: a large fan-out writes
// many chunked inbox inserts and hands thousands of addresses to the push
// senders, and MUST finish inside one invocation so the post-send audit row is
// always reached (a mid-fan-out timeout would deliver real pushes but leave
// zero trace). Vercel clamps this to the plan's max.
export const maxDuration = 300;

/**
 * Admin broadcast / announcements (gap build P0-4).
 *
 *  - POST → announce to every account matching an optional { tier, country }
 *           filter. Each recipient gets the SAME treatment notify() gives a
 *           single account: the shared prefs/quiet-hours decision, a durable
 *           inbox row, then the push. Devices are loaded in bulk and handed to
 *           lib/push's sendPushToTokens, which writes ONE audit row's worth of
 *           tallies back here.
 *
 * Gated on the effective `broadcast.send` permission (role preset plus explicit
 * account overrides) through the same fail-closed guard as every admin API.
 *
 * DELIVERY IS NOT IMPLEMENTED HERE. lib/push owns the one routing rule in the
 * app: an Android address goes to Firebase Cloud Messaging, an iPhone's Expo
 * address goes to Expo, and only the service that owns an address may declare
 * it dead. A second sender that only spoke FCM would have every iPhone rejected
 * as invalid and then deleted, so one broadcast would silence exactly the
 * members it was aimed at. lib/push also owns the batching and the bounded
 * concurrency, so a large fan-out still lands inside the serverless budget.
 *
 * When the Firebase credential is absent the route returns 503
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

/** Rows per inbox insert — keeps bind parameters bounded. */
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

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'broadcast.send');
  if (principal instanceof Response) return principal;

  const parsed = broadcastSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { title, body, tier, country } = parsed.data;

  // Same singleton lib/push sends with, so there is exactly one Firebase app in
  // the process and exactly one place that decides an address is dead.
  if (!isFcmConfigured()) return json({ error: 'push_not_configured' }, 503);

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
  // Hand the whole list to the shared sender. It classifies each address, sends
  // Android over FCM multicast and iPhones over Expo, batches both legs through
  // one bounded pool so the fan-out stays inside the serverless budget, and
  // removes only the addresses the service that owns them called dead.
  const push = await sendPushToTokens(tokens, {
    title,
    body,
    // `event` rides alongside `type` exactly as notify() sends it, so the
    // mobile deep-link switch and the notification center key on the same
    // fields whichever path delivered the message.
    data: { ...BROADCAST_DATA, event: BROADCAST_EVENT },
  });

  // One audit row per broadcast, carrying the recipient count (P0-4 / §4.12).
  // `recipients` = inbox rows written (the durable reach); `devices` = the
  // addresses a push service actually took on, so `delivered + failed` adds up
  // and no device is booked as a failure it never had a chance at. `unreachable`
  // is the leftover addresses from old app builds that no service here speaks
  // to; they are dropped, not counted as people who missed the message. The
  // prefs/quiet-hours tallies are additive keys the history view ignores until
  // it wants them.
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
      devices: push.attempted,
      delivered: push.delivered,
      failed: push.failed,
      truncated,
      suppressed,
      quietHours: quietHeld,
      inboxFailed,
      unreachable: push.unreachable,
    },
    auditIp(req),
  );

  return json(
    {
      ok: true,
      recipients: inboxWritten,
      devices: push.attempted,
      delivered: push.delivered,
      failed: push.failed,
      truncated,
      suppressed,
      quietHours: quietHeld,
      unreachable: push.unreachable,
    },
    200,
  );
}
