import { devicePushTokens } from '@gym/db';
import { eq } from 'drizzle-orm';
import { getDb } from './db';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PUSH_TIMEOUT_MS = 8000;

export type PushPlatform = 'ios' | 'android';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Upsert a device's Expo push token. A token maps to exactly one account, so
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

/** All Expo push tokens registered to an account (may be empty). */
export async function tokensForAccount(accountId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ token: devicePushTokens.token })
    .from(devicePushTokens)
    .where(eq(devicePushTokens.accountId, accountId));
  return rows.map((r) => r.token).filter((t): t is string => typeof t === 'string' && t.length > 0);
}

/** Best-effort cleanup: drop a token Expo reports as no longer valid. */
async function removeToken(token: string): Promise<void> {
  try {
    await getDb().delete(devicePushTokens).where(eq(devicePushTokens.token, token));
  } catch (err) {
    console.error('[push] failed to remove stale token', err);
  }
}

/**
 * Send a push to every device registered to an account. NEVER throws — a push
 * failure (bad token, Expo down, network timeout) must not break the buddy
 * action that triggered it. Safe to call fire-and-forget with `void`.
 */
export async function sendPushToAccount(accountId: string, message: PushMessage): Promise<void> {
  try {
    const tokens = await tokensForAccount(accountId);
    if (tokens.length === 0) return;

    const messages = tokens.map((to) => ({
      to,
      title: message.title,
      body: message.body,
      sound: 'default',
      channelId: 'default',
      data: message.data ?? {},
    }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(messages),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      console.error(`[push] Expo push send returned ${res.status}`);
      return;
    }

    // Inspect per-message receipts. Expo returns { data: Ticket[] } where a
    // ticket has status 'ok' | 'error'. DeviceNotRegistered → drop the token.
    const payload = (await res.json().catch(() => null)) as {
      data?: Array<{ status?: string; details?: { error?: string } }>;
    } | null;
    const tickets = payload?.data;
    if (!Array.isArray(tickets)) return;

    await Promise.all(
      tickets.map((ticket, i) => {
        if (ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          const staleToken = tokens[i];
          if (staleToken) return removeToken(staleToken);
        }
        return undefined;
      }),
    );
  } catch (err) {
    // Log and swallow — the caller (a buddy route) must still return normally.
    console.error('[push] sendPushToAccount failed', err);
  }
}
