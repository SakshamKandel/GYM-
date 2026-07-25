import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { json, preflight, readJson } from '@/lib/http';
import { classifyPushToken, registerToken } from '@/lib/push';
import { clientIp, rateLimitShared } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * A device registers on cold start, on sign-in, after a permission grant and
 * when the push service rotates its token — a handful of calls a day for a
 * member with several devices. This ceiling sits far above that and stops one
 * account from filling device_push_tokens one made-up address at a time.
 */
const REGISTER_LIMIT = 20;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;

/** No real push address is anywhere near this long; anything longer is noise. */
const MAX_TOKEN_LENGTH = 1024;

const bodySchema = z.object({
  token: z.string().min(1).max(MAX_TOKEN_LENGTH),
  platform: z.enum(['ios', 'android']).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const limited = await rateLimitShared({
    route: 'push/register',
    limit: REGISTER_LIMIT,
    windowMs: REGISTER_WINDOW_MS,
    accountId: me.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  // Only the two address shapes this app can actually deliver to are stored:
  // an Expo push token (iPhones) and a native FCM token (Android). A raw Apple
  // device token has no sender here, and anything else is not an address at
  // all, so both are refused rather than parked in the table as a recipient
  // nothing could ever reach. Registration is best-effort on the phone, so a
  // refusal here is quiet on the client and the next attempt is unaffected.
  const kind = classifyPushToken(parsed.data.token);
  if (kind !== 'expo' && kind !== 'fcm') {
    return json({ error: 'unsupported_token' }, 400);
  }

  const admission = await registerToken(me.id, parsed.data.token, parsed.data.platform);
  if (admission === 'unusable') return json({ error: 'unsupported_token' }, 400);

  return json({ ok: true }, 200);
}
