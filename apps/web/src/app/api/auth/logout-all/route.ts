import { sessions } from '@gym/db';
import { eq } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { logAudit } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { clientIp, rateLimitShared } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * POST /api/auth/logout-all (Bearer) — "sign out everywhere": deletes EVERY
 * session for the signed-in account, including the one making this call.
 * The panic button after a lost phone or a leaked token. Audited.
 */

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  // Wiping every session for an account is the one thing a stolen token can do
  // that hurts, so the 5/min budget has to be one budget: shared store when
  // configured, per instance when not.
  const limited = await rateLimitShared({
    route: 'auth/logout-all',
    limit: 5,
    windowMs: 60_000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  await getDb().delete(sessions).where(eq(sessions.accountId, user.id));
  await logAudit({ id: user.id }, 'auth.logout_all', 'account', user.id, { self: true });

  return json({ ok: true }, 200);
}
