import { appleAuthNonceResponseSchema } from '@gym/shared';
import { allowedAppleClientIds } from '@/lib/apple';
import { issueAppleAuthNonce } from '@/lib/appleNonce';
import { json, preflight } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

export function OPTIONS() {
  return preflight();
}

/** Begin one native Apple authorization with a server-issued challenge. */
export async function POST(req: Request) {
  const limited = rateLimit({
    route: 'auth/apple/nonce',
    limit: 15,
    windowMs: 60_000,
    ip: clientIp(req),
  });
  if (limited) return limited;

  if (allowedAppleClientIds().length === 0) {
    return json({ error: 'not_configured' }, 503);
  }

  try {
    const body = appleAuthNonceResponseSchema.parse({ nonce: await issueAppleAuthNonce() });
    return json(body, 200);
  } catch {
    return json({ error: 'auth_unavailable' }, 503);
  }
}
