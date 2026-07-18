import { accounts } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requireStaff } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { verifyPassword } from '@/lib/password';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Staff step-up re-authentication (plan §3 item 14).
 *
 * A destructive admin action (role grant/revoke/offboard, tier override) must
 * be preceded by a fresh password re-entry. This endpoint verifies the CALLER'S
 * OWN password (the account behind the bearer token / gt_staff cookie) and, on
 * success, tells the client the step-up is fresh for `REAUTH_TTL_MS`.
 *
 * The freshness flag lives ONLY in client memory (never persisted, never a
 * server session) — this route is a stateless password check. Server routes
 * stay independently permission-guarded; re-auth is an ADDITIONAL client-side
 * friction gate, not the authorization boundary.
 *
 * NO biometrics / native deps — password re-entry only. TOTP-based 2FA for
 * roles.grant holders is noted as a deferred follow-up (plan §3 item 14).
 */

const REAUTH_TTL_MS = 5 * 60 * 1000;

const bodySchema = z.object({
  password: z.string(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  // Identify the caller FIRST — re-auth only ever verifies the signed-in staff
  // account's own password, so a session is mandatory before we touch anything.
  const principal = await requireStaff(req);
  if (principal instanceof Response) return principal;

  // Damp password guessing: 5 attempts / minute, keyed to the account so the
  // budget follows the caller across IPs (a stolen session can't brute-force a
  // password from many hops). Separate from the login route's IP budget.
  const limited = rateLimit({
    route: 'staff/reauth',
    limit: 5,
    windowMs: 60_000,
    accountId: principal.id,
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const ip = clientIp(req);
  const rows = await getDb()
    .select({ passwordHash: accounts.passwordHash })
    .from(accounts)
    .where(eq(accounts.id, principal.id))
    .limit(1);

  const passwordHash = rows[0]?.passwordHash ?? null;
  if (passwordHash === null) {
    // Google-only staff account with no password set — password step-up is
    // impossible. Distinct code so the client can explain instead of looping on
    // a "wrong password" message. (TOTP 2FA would cover this case — deferred.)
    await logAudit(principal, 'staff.reauth', 'account', principal.id, { ok: false, reason: 'no_password' }, ip);
    return json({ error: 'no_password' }, 409);
  }

  const passwordOk = await verifyPassword(parsed.data.password, passwordHash);
  if (!passwordOk) {
    await logAudit(principal, 'staff.reauth', 'account', principal.id, { ok: false }, ip);
    return json({ error: 'bad_credentials' }, 401);
  }

  await logAudit(principal, 'staff.reauth', 'account', principal.id, { ok: true }, ip);
  return json({ ok: true, expiresAt: new Date(Date.now() + REAUTH_TTL_MS).toISOString() }, 200);
}
