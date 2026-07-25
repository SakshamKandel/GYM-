import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { devicePushTokens } from '@gym/db';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from './db';

/**
 * Push delivery. A phone registers ONE address, and its shape says which
 * service can reach it:
 *
 *  - `fcm`  — a native Firebase Cloud Messaging token (Android). Sent via the
 *             Firebase Admin SDK, credential in FIREBASE_SERVICE_ACCOUNT_B64
 *             (base64 of the JSON key, so it drops into a Vercel env var with
 *             no escaping). Absent credential = nothing is sent, and the
 *             business action that triggered the push still succeeds.
 *  - `expo` — an Expo push token (`ExponentPushToken[...]`, registered by
 *             iPhones). Sent through Expo's push service, which hands it to
 *             Apple for us.
 *  - `apns` — a raw Apple device token. Firebase Cloud Messaging rejects
 *             these, and we have no direct Apple sender, so they are refused
 *             at registration instead of being stored as a recipient that can
 *             never be delivered to. Older iOS builds registered one of these
 *             for every iPhone, which is why iOS push was silent.
 */

export type PushPlatform = 'ios' | 'android';

/** Which sender (if any) can reach an address of this shape. */
export type PushTokenKind = 'fcm' | 'expo' | 'apns' | 'unknown';

/**
 * Expo's own token format. Both spellings are issued in the wild, so accept
 * either rather than dropping a live recipient.
 */
const EXPO_TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;

/**
 * Apple device tokens are pure hexadecimal, 64 characters for the classic
 * form and longer for newer ones. FCM tokens always carry a ':' and Expo
 * tokens their bracket prefix, so neither can be mistaken for one.
 */
const APNS_TOKEN_RE = /^[0-9a-f]{64,}$/i;

export function classifyPushToken(token: string): PushTokenKind {
  const value = token.trim();
  if (EXPO_TOKEN_RE.test(value)) return 'expo';
  if (APNS_TOKEN_RE.test(value)) return 'apns';
  // FCM registration tokens are long and contain a ':' separator.
  if (value.includes(':') && value.length >= 32) return 'fcm';
  return 'unknown';
}

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Outcome of a single-account push dispatch — the signal `notify()`'s durable
 * outbox uses to decide `notifications.sentAt` (§8.2, E2):
 *  - `sent`          → at least one device received it; flip `sentAt=now`.
 *  - `no_recipient`  → nothing to deliver (sender unconfigured, no registered
 *                      tokens, or every token was dead & pruned). RESOLVED —
 *                      a retry can't help, so `notify` still sets `sentAt` and
 *                      the `retry-unsent` cron leaves it alone.
 *  - `error`         → a transient failure (a sender threw, or it accepted the
 *                      batch but nothing landed for a non-token reason). NOT resolved —
 *                      `sentAt` stays null so `retry-unsent` re-attempts within
 *                      its bounded window.
 */
export type PushDispatch = 'sent' | 'no_recipient' | 'error';

// ── Firebase Admin singleton ──────────────────────────────────

let cachedApp: App | null = null;
let initFailed = false;

function firebaseApp(): App | null {
  if (cachedApp) return cachedApp;
  if (initFailed) return null;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) {
    console.warn('[push] FIREBASE_SERVICE_ACCOUNT_B64 not set — push disabled');
    initFailed = true;
    return null;
  }
  try {
    const existing = getApps()[0];
    if (existing) {
      cachedApp = existing;
      return cachedApp;
    }
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const raw = JSON.parse(json) as {
      project_id: string;
      client_email: string;
      private_key: string;
    };
    const serviceAccount: ServiceAccount = {
      projectId: raw.project_id,
      clientEmail: raw.client_email,
      privateKey: raw.private_key,
    };
    cachedApp = initializeApp({ credential: cert(serviceAccount) });
    return cachedApp;
  } catch (err) {
    console.error('[push] Firebase Admin init failed', err);
    initFailed = true;
    return null;
  }
}

/**
 * Whether the FCM leg has a usable credential. A caller that wants to refuse a
 * bulk send up front (rather than report zero deliveries afterwards) asks here
 * instead of standing up a second Firebase app of its own — two apps would mean
 * two token-routing rules, and the one that only spoke FCM would delete every
 * iPhone's Expo address as "invalid".
 */
export function isFcmConfigured(): boolean {
  return firebaseApp() !== null;
}

// ── Token storage (FCM tokens from Android, Expo tokens from iOS) ──

/**
 * Whether an address was taken on. `unusable` means we recognised it as one
 * no sender here can reach, so it was deliberately NOT stored — callers
 * should tell the client rather than answer OK to a registration that could
 * only ever be silent.
 */
export type PushTokenAdmission = 'stored' | 'unusable';

/**
 * Upsert a device's push token. A token maps to exactly one account, so
 * re-registering the same token (e.g. a device switching accounts) updates the
 * owning account, platform, and timestamp rather than creating a duplicate.
 *
 * Raw Apple device tokens are refused: no sender here speaks APNs directly,
 * so storing one would quietly park an unreachable recipient in the table.
 */
export async function registerToken(
  accountId: string,
  token: string,
  platform?: PushPlatform,
): Promise<PushTokenAdmission> {
  if (classifyPushToken(token) === 'apns') {
    console.warn(
      '[push] refused an Apple device token: FCM cannot deliver to it and there is no direct APNs sender. The app should register an Expo push token on iOS.',
    );
    return 'unusable';
  }
  await getDb()
    .insert(devicePushTokens)
    .values({ accountId, token, platform: platform ?? null })
    .onConflictDoUpdate({
      target: devicePushTokens.token,
      set: { accountId, platform: platform ?? null, updatedAt: new Date() },
    });
  return 'stored';
}

/**
 * Sign-out counterpart to registerToken: drop the device's mapping so the
 * account stops receiving pushes there. Scoped to the calling account so one
 * user can never evict a mapping that now belongs to someone else.
 */
export async function unregisterToken(accountId: string, token: string): Promise<void> {
  await getDb()
    .delete(devicePushTokens)
    .where(and(eq(devicePushTokens.token, token), eq(devicePushTokens.accountId, accountId)));
}

/** Every push address registered to an account (may be empty). */
export async function tokensForAccount(accountId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ token: devicePushTokens.token })
    .from(devicePushTokens)
    .where(eq(devicePushTokens.accountId, accountId));
  return rows.map((r) => r.token).filter((t): t is string => typeof t === 'string' && t.length > 0);
}

/** Rows per delete — keeps bind parameters bounded on a large fan-out. */
const PRUNE_CHUNK = 500;

/** Splits `items` into consecutive slices of at most `size`. */
function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Best-effort cleanup: drop addresses the push service reports as gone. Always
 * called with tokens the sender that OWNS them declared dead — never with an
 * address one service rejected merely because it belongs to the other.
 */
async function removeTokens(tokens: readonly string[]): Promise<void> {
  if (tokens.length === 0) return;
  for (const batch of chunked(tokens, PRUNE_CHUNK)) {
    try {
      await getDb().delete(devicePushTokens).where(inArray(devicePushTokens.token, batch));
    } catch (err) {
      console.error('[push] failed to remove stale tokens', err);
    }
  }
}

/** Both services take data as string→string. */
function stringifyData(data?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data) return out;
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

// ── Batch senders ─────────────────────────────────────────────

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/** Expo accepts at most 100 messages per request. */
const EXPO_BATCH_SIZE = 100;

/** FCM's hard limit per multicast call. */
const FCM_MULTICAST_BATCH = 500;

/** A hung push must not hold the request that triggered it. */
const EXPO_TIMEOUT_MS = 10_000;

/**
 * How many batches are in flight at once, across BOTH legs. A broadcast hands
 * this module thousands of addresses; walking them one batch at a time (each
 * Expo request waiting out its own ten second ceiling) would run past the
 * serverless budget and the caller would lose its audit row. Both legs share
 * one pool so the total in-flight work stays bounded either way.
 */
const SEND_CONCURRENCY = 8;

/** What one batch of addresses did. */
interface SendTally {
  /** Addresses the sender accepted for delivery. */
  delivered: number;
  /** Addresses the sender tried and could not reach. */
  failed: number;
  /** Addresses the sender that OWNS them reported as gone — safe to drop. */
  stale: string[];
  /** True when something a later attempt could fix went wrong. */
  transient: boolean;
}

function emptyTally(): SendTally {
  return { delivered: 0, failed: 0, stale: [], transient: false };
}

/** FCM verdicts that mean "this address is dead", as opposed to "try later". */
function isDeadFcmCode(code: string | undefined): boolean {
  return (
    code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token' ||
    code === 'messaging/invalid-argument'
  );
}

/**
 * Expo answers with one ticket per message, in order. Only the fields we act
 * on are described; anything else is ignored so a richer reply still parses.
 */
const expoTicketSchema = z.object({
  status: z.enum(['ok', 'error']),
  details: z.object({ error: z.string().optional() }).optional(),
});

const expoResponseSchema = z.object({
  data: z.array(expoTicketSchema).optional(),
  errors: z.array(z.object({ message: z.string().optional() })).optional(),
});

/**
 * Deliver ONE batch of at most EXPO_BATCH_SIZE Expo addresses. Never throws:
 * a batch that fails is reported in the tally so the rest of the fan-out
 * carries on. Reports stale addresses rather than deleting them, so the caller
 * can prune once for the whole send.
 */
async function sendExpoBatch(batch: readonly string[], message: PushMessage): Promise<SendTally> {
  const tally = emptyTally();
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  const body = batch.map((to) => ({
    to,
    title: message.title,
    body: message.body,
    data: stringifyData(message.data),
    sound: 'default',
    priority: 'high',
    channelId: 'default',
  }));

  let response: Response;
  try {
    response = await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : null),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(EXPO_TIMEOUT_MS),
    });
  } catch (err) {
    console.error('[push] Expo push request failed', err);
    tally.failed += batch.length;
    tally.transient = true;
    return tally;
  }

  if (!response.ok) {
    console.error('[push] Expo push rejected the request', response.status);
    tally.failed += batch.length;
    tally.transient = true;
    return tally;
  }

  const parsed = expoResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success || !parsed.data.data) {
    console.error('[push] Expo push returned an unreadable reply');
    tally.failed += batch.length;
    tally.transient = true;
    return tally;
  }

  const tickets = parsed.data.data;
  tickets.forEach((ticket, index) => {
    if (ticket.status === 'ok') {
      tally.delivered += 1;
      return;
    }
    tally.failed += 1;
    if (ticket.details?.error === 'DeviceNotRegistered') {
      const stale = batch[index];
      if (stale) tally.stale.push(stale);
      return;
    }
    // Anything else (MessageRateExceeded, MismatchSenderId, a missing Apple
    // key) is worth another attempt later.
    tally.transient = true;
  });

  // One ticket per message is the contract. A short reply means some addresses
  // got no verdict at all, which is a retryable gap, not a dead device.
  const unanswered = batch.length - tickets.length;
  if (unanswered > 0) {
    tally.failed += unanswered;
    tally.transient = true;
  }
  return tally;
}

/**
 * Deliver ONE batch of at most FCM_MULTICAST_BATCH native FCM addresses. Never
 * throws, for the same reason as the Expo batch above.
 */
async function sendFcmBatch(
  app: App,
  batch: readonly string[],
  message: PushMessage,
): Promise<SendTally> {
  const tally = emptyTally();
  try {
    const response = await getMessaging(app).sendEachForMulticast({
      tokens: [...batch],
      notification: { title: message.title, body: message.body },
      data: stringifyData(message.data),
      android: {
        priority: 'high',
        notification: { channelId: 'default', sound: 'default' },
      },
    });
    tally.delivered += response.successCount;
    tally.failed += response.failureCount;
    response.responses.forEach((r, i) => {
      if (r.success) return;
      if (isDeadFcmCode(r.error?.code)) {
        const stale = batch[i];
        if (stale) tally.stale.push(stale);
        return;
      }
      // Not a verdict on the address itself (quota, auth, FCM having a bad
      // day) — worth another attempt later.
      tally.transient = true;
    });
  } catch (err) {
    console.error('[push] FCM batch send failed', err);
    tally.failed += batch.length;
    tally.transient = true;
  }
  return tally;
}

/** A whole fan-out: the merged tally plus the addresses nobody here can reach. */
interface FanOutTally extends SendTally {
  /** Addresses actually handed to a sender. */
  attempted: number;
  /** Stored addresses no sender here speaks to (legacy Apple device tokens). */
  unreachable: string[];
}

/**
 * THE routing rule, shared by every sender in the app: classify each address,
 * hand it to the service that owns its shape, and let only that service decide
 * whether it is dead. Sending an Expo address to FCM gets it rejected as
 * invalid, and pruning on that verdict would deregister every iPhone in the
 * audience.
 *
 * Batches from both legs run through one bounded pool, so a fan-out of any size
 * finishes in a predictable wall-clock rather than a long sequential chain.
 * Never throws; a leg that fails is reported, not raised.
 */
async function fanOut(tokens: readonly string[], message: PushMessage): Promise<FanOutTally> {
  const expoTokens: string[] = [];
  const fcmTokens: string[] = [];
  const unreachable: string[] = [];
  for (const token of tokens) {
    const kind = classifyPushToken(token);
    if (kind === 'expo') expoTokens.push(token);
    // 'unknown' goes to FCM: an unrecognised-but-live Android token must
    // keep working, and FCM's own reply prunes it if it really is dead.
    else if (kind === 'fcm' || kind === 'unknown') fcmTokens.push(token);
    else unreachable.push(token);
  }

  // Credential absent/invalid — the FCM leg has nothing to send with, so those
  // addresses are not attempted at all (and are NOT counted as failures).
  const app = fcmTokens.length > 0 ? firebaseApp() : null;

  const jobs: (() => Promise<SendTally>)[] = [];
  if (app) {
    for (const batch of chunked(fcmTokens, FCM_MULTICAST_BATCH)) {
      jobs.push(() => sendFcmBatch(app, batch, message));
    }
  }
  for (const batch of chunked(expoTokens, EXPO_BATCH_SIZE)) {
    jobs.push(() => sendExpoBatch(batch, message));
  }

  const total: FanOutTally = {
    ...emptyTally(),
    attempted: (app ? fcmTokens.length : 0) + expoTokens.length,
    unreachable,
  };

  let cursor = 0;
  const lane = async (): Promise<void> => {
    // `jobs[cursor++]` reads-and-increments with no intervening await, so the
    // single-threaded event loop hands each lane a distinct batch.
    while (cursor < jobs.length) {
      const job = jobs[cursor++]!;
      const tally = await job();
      total.delivered += tally.delivered;
      total.failed += tally.failed;
      if (tally.transient) total.transient = true;
      for (const stale of tally.stale) total.stale.push(stale);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, jobs.length) }, () => lane()));

  if (unreachable.length > 0) {
    // Apple device tokens left behind by iOS builds from before the fix.
    // No sender here can ever reach them, so clear them out instead of
    // carrying a recipient that only looks like one.
    console.warn(
      `[push] dropping ${unreachable.length} stored Apple device token(s) that no sender here can reach`,
    );
  }
  await removeTokens([...total.stale, ...unreachable]);
  return total;
}

/**
 * What a bulk fan-out did, for an audit trail. `attempted` is the number of
 * addresses a sender actually took on, so `delivered + failed === attempted`
 * and an iPhone is never booked as a failure just because it is an iPhone.
 */
export interface BulkPushResult {
  /** Addresses handed to a sender. */
  attempted: number;
  /** Addresses a sender accepted for delivery. */
  delivered: number;
  /** Addresses a sender tried and could not reach. */
  failed: number;
  /** Stored addresses no sender here speaks to; dropped, never a failure. */
  unreachable: number;
  /** Addresses the owning sender reported as gone; removed from the table. */
  pruned: number;
}

/**
 * Send one message to a list of already-loaded addresses (a broadcast). Same
 * routing, batching and pruning as the per-account sender, so a bulk caller
 * never has to build a second sender of its own. NEVER throws.
 */
export async function sendPushToTokens(
  tokens: readonly string[],
  message: PushMessage,
): Promise<BulkPushResult> {
  if (tokens.length === 0) {
    return { attempted: 0, delivered: 0, failed: 0, unreachable: 0, pruned: 0 };
  }
  try {
    const result = await fanOut(tokens, message);
    return {
      attempted: result.attempted,
      delivered: result.delivered,
      failed: result.failed,
      unreachable: result.unreachable.length,
      pruned: result.stale.length,
    };
  } catch (err) {
    console.error('[push] sendPushToTokens failed', err);
    return {
      attempted: tokens.length,
      delivered: 0,
      failed: tokens.length,
      unreachable: 0,
      pruned: 0,
    };
  }
}

/**
 * Send a push to every device registered to an account. NEVER throws — a push
 * failure (bad token, a push service down, misconfigured credential) must not
 * break the business action that triggered it. Safe to call fire-and-forget
 * with `void`.
 *
 * Returns a `PushDispatch` so the `notify()` outbox can distinguish "delivered"
 * / "nothing to deliver" (both RESOLVED) from a "transient failure" (retryable).
 * Existing fire-and-forget callers ignore the return value unchanged.
 */
export async function sendPushToAccount(
  accountId: string,
  message: PushMessage,
): Promise<PushDispatch> {
  try {
    const tokens = await tokensForAccount(accountId);
    if (tokens.length === 0) return 'no_recipient';

    const result = await fanOut(tokens, message);
    if (result.delivered > 0) return 'sent';
    // Nothing landed. A transient failure is worth retrying; anything else
    // means there was no live recipient and a retry cannot help.
    return result.transient ? 'error' : 'no_recipient';
  } catch (err) {
    // Log and swallow — the caller must still return normally.
    console.error('[push] sendPushToAccount failed', err);
    return 'error';
  }
}
