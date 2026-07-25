import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { devicePushTokens } from '@gym/db';
import { and, eq } from 'drizzle-orm';
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

/** Best-effort cleanup: drop a token the push service reports as gone. */
async function removeToken(token: string): Promise<void> {
  try {
    await getDb().delete(devicePushTokens).where(eq(devicePushTokens.token, token));
  } catch (err) {
    console.error('[push] failed to remove stale token', err);
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

// ── Expo push service (iPhones) ───────────────────────────────

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/** Expo accepts at most 100 messages per request. */
const EXPO_BATCH_SIZE = 100;

/** A hung push must not hold the request that triggered it. */
const EXPO_TIMEOUT_MS = 10_000;

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
 * Deliver to Expo push tokens. Same contract as the FCM path: never throws,
 * prunes addresses Expo reports as gone, and reports whether a retry could
 * help.
 */
async function sendViaExpo(tokens: string[], message: PushMessage): Promise<PushDispatch> {
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  let delivered = 0;
  let deadOnly = true;

  for (let i = 0; i < tokens.length; i += EXPO_BATCH_SIZE) {
    const batch = tokens.slice(i, i + EXPO_BATCH_SIZE);
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
      deadOnly = false;
      continue;
    }

    if (!response.ok) {
      console.error('[push] Expo push rejected the request', response.status);
      deadOnly = false;
      continue;
    }

    const parsed = expoResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success || !parsed.data.data) {
      console.error('[push] Expo push returned an unreadable reply');
      deadOnly = false;
      continue;
    }

    await Promise.all(
      parsed.data.data.map((ticket, index) => {
        if (ticket.status === 'ok') {
          delivered += 1;
          return undefined;
        }
        const reason = ticket.details?.error;
        if (reason === 'DeviceNotRegistered') {
          const stale = batch[index];
          if (stale) return removeToken(stale);
          return undefined;
        }
        // Anything else (MessageRateExceeded, MismatchSenderId, a missing
        // Apple key) is worth another attempt later.
        deadOnly = false;
        return undefined;
      }),
    );
  }

  if (delivered > 0) return 'sent';
  return deadOnly ? 'no_recipient' : 'error';
}

/** Deliver to native FCM tokens via the Firebase Admin SDK. */
async function sendViaFcm(tokens: string[], message: PushMessage): Promise<PushDispatch> {
  const app = firebaseApp();
  if (!app) return 'no_recipient'; // credential absent/invalid — nothing to send.
  const response = await getMessaging(app).sendEachForMulticast({
    tokens,
    notification: { title: message.title, body: message.body },
    data: stringifyData(message.data),
    android: {
      priority: 'high',
      notification: { channelId: 'default', sound: 'default' },
    },
  });

  // Drop tokens FCM says are dead so the table stays clean.
  await Promise.all(
    response.responses.map((r, i) => {
      if (r.success) return undefined;
      const code = r.error?.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument'
      ) {
        const stale = tokens[i];
        if (stale) return removeToken(stale);
      }
      return undefined;
    }),
  );

  if (response.successCount > 0) return 'sent';
  // Multicast issued but nothing landed. If EVERY failure was a dead/invalid
  // token (now pruned), there is no live recipient and a retry is pointless —
  // resolved. Otherwise treat it as a transient error worth a retry.
  const allDeadTokens = response.responses.every((r) => {
    if (r.success) return false;
    const code = r.error?.code;
    return (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token' ||
      code === 'messaging/invalid-argument'
    );
  });
  return allDeadTokens ? 'no_recipient' : 'error';
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

    if (unreachable.length > 0) {
      // Apple device tokens left behind by iOS builds from before the fix.
      // No sender here can ever reach them, so clear them out instead of
      // carrying a recipient that only looks like one.
      console.warn(
        `[push] dropping ${unreachable.length} stored Apple device token(s) that no sender here can reach`,
      );
      await Promise.all(unreachable.map((token) => removeToken(token)));
    }

    const results: PushDispatch[] = [];
    if (fcmTokens.length > 0) results.push(await sendViaFcm(fcmTokens, message));
    if (expoTokens.length > 0) results.push(await sendViaExpo(expoTokens, message));

    if (results.includes('sent')) return 'sent';
    if (results.includes('error')) return 'error';
    // Nothing left to try: no live recipient, so a retry cannot help.
    return 'no_recipient';
  } catch (err) {
    // Log and swallow — the caller must still return normally.
    console.error('[push] sendPushToAccount failed', err);
    return 'error';
  }
}
