import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { devicePushTokens } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { getDb } from './db';

/**
 * Push delivery via the Firebase Admin SDK (FCM). The mobile app registers
 * its NATIVE FCM device token, and we send to it directly — no Expo/EAS
 * account in the loop.
 *
 * The service-account credential is read from FIREBASE_SERVICE_ACCOUNT_B64
 * (base64 of the JSON key) so it drops cleanly into a Vercel env var with no
 * escaping. When it's absent, sending no-ops (buddy actions still succeed).
 */

export type PushPlatform = 'ios' | 'android';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Outcome of a single-account push dispatch — the signal `notify()`'s durable
 * outbox uses to decide `notifications.sentAt` (§8.2, E2):
 *  - `sent`          → at least one device received it; flip `sentAt=now`.
 *  - `no_recipient`  → nothing to deliver (FCM unconfigured, no registered
 *                      tokens, or every token was dead & pruned). RESOLVED —
 *                      a retry can't help, so `notify` still sets `sentAt` and
 *                      the `retry-unsent` cron leaves it alone.
 *  - `error`         → a transient failure (FCM threw / multicast issued but
 *                      zero delivered for a non-token reason). NOT resolved —
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

// ── Token storage (unchanged: now holds native FCM tokens) ────

/**
 * Upsert a device's FCM token. A token maps to exactly one account, so
 * re-registering the same token (e.g. a device switching accounts) updates the
 * owning account, platform, and timestamp rather than creating a duplicate.
 */
export async function registerToken(
  accountId: string,
  token: string,
  platform?: PushPlatform,
): Promise<void> {
  await getDb()
    .insert(devicePushTokens)
    .values({ accountId, token, platform: platform ?? null })
    .onConflictDoUpdate({
      target: devicePushTokens.token,
      set: { accountId, platform: platform ?? null, updatedAt: new Date() },
    });
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

/** All FCM tokens registered to an account (may be empty). */
export async function tokensForAccount(accountId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ token: devicePushTokens.token })
    .from(devicePushTokens)
    .where(eq(devicePushTokens.accountId, accountId));
  return rows.map((r) => r.token).filter((t): t is string => typeof t === 'string' && t.length > 0);
}

/** Best-effort cleanup: drop a token FCM reports as no longer valid. */
async function removeToken(token: string): Promise<void> {
  try {
    await getDb().delete(devicePushTokens).where(eq(devicePushTokens.token, token));
  } catch (err) {
    console.error('[push] failed to remove stale token', err);
  }
}

/** FCM data payloads must be string→string. */
function stringifyData(data?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data) return out;
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

/**
 * Send a push to every device registered to an account. NEVER throws — a push
 * failure (bad token, FCM down, misconfigured credential) must not break the
 * business action that triggered it. Safe to call fire-and-forget with `void`.
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
    const app = firebaseApp();
    if (!app) return 'no_recipient'; // credential absent/invalid — nothing to send.

    const tokens = await tokensForAccount(accountId);
    if (tokens.length === 0) return 'no_recipient';

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
  } catch (err) {
    // Log and swallow — the caller must still return normally.
    console.error('[push] sendPushToAccount failed', err);
    return 'error';
  }
}
