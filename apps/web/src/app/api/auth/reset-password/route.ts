import { createHash } from 'node:crypto';
import { accounts, passwordResetTokens, sessions } from '@gym/db';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { hashPassword } from '@/lib/password';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * POST /api/auth/reset-password — public redemption of an admin-issued reset
 * token (P1-7). Validates token + expiry + unused (single-use CAS), sets the
 * new scrypt password, and force-signs-out every existing session for the
 * account (any attacker session dies too).
 *
 * Only the SHA-256 hash of the token is ever compared, matching how the token
 * was stored at mint time. Rate-limited per IP so a leaked-URL guessing attempt
 * can't be brute-forced. The response is deliberately uniform (invalid vs
 * expired vs already-used all collapse to one error) so the endpoint reveals
 * nothing about token state.
 */

const bodySchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  // Damp token-guessing / password-set abuse: 10 attempts/min per IP.
  const limited = rateLimit({
    route: 'auth/reset-password',
    limit: 10,
    windowMs: 60_000,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();

  // Derive the new hash BEFORE burning the token, so a crypto failure can't
  // consume a valid single-use token and leave the account unchanged.
  const passwordHash = await hashPassword(parsed.data.password);
  const tokenHash = sha256(parsed.data.token);

  // Single-use CAS: consume the token only if it is unused AND unexpired. The
  // returned accountId is the pivot — if zero rows come back the token was
  // missing, already used, or expired (all indistinguishable to the caller).
  const consumed = await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .returning({ accountId: passwordResetTokens.accountId });

  const row = consumed[0];
  if (!row) return json({ error: 'invalid_or_expired' }, 400);

  await db
    .update(accounts)
    .set({ passwordHash })
    .where(eq(accounts.id, row.accountId));

  // Force sign-out everywhere: a password reset must invalidate every existing
  // session (the member re-authenticates with the new password).
  await db.delete(sessions).where(eq(sessions.accountId, row.accountId));

  await logAudit(
    { id: row.accountId },
    'account.password_reset',
    'account',
    row.accountId,
    { via: 'admin_token' },
    clientIp(req),
  );

  return json({ ok: true }, 200);
}
