import { createHash } from 'node:crypto';
import { accounts, admins } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createSession } from '@/lib/auth';
import { effectivePermissionSet, logAudit } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { verifyPassword } from '@/lib/password';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { setStaffCookie } from '@/lib/staffSession';

export const runtime = 'nodejs';

const bodySchema = z.object({
  email: z.string(),
  password: z.string(),
});

/**
 * A valid-FORMAT scrypt hash ('scrypt$<16-byte saltHex>$<32-byte hashHex>') that
 * matches no real password. On the account-miss path we run a real
 * verifyPassword against this constant so the response spends the same ~50-100ms
 * of scrypt work as a genuine wrong-password attempt — closing the timing oracle
 * that let an attacker enumerate which emails are staff (A4).
 */
const DUMMY_PASSWORD_HASH =
  'scrypt$00112233445566778899aabbccddeeff$' +
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

/** A short, non-reversible tag of the attempted email for failure audit meta. */
function emailTag(email: string): string {
  return createHash('sha256').update(email).digest('hex').slice(0, 16);
}

export function OPTIONS() {
  return preflight();
}

/**
 * Web-console login. Verifies email/password against `accounts` (same scrypt
 * verify as the mobile login), REQUIRES an `admins` row (staff only), mints a
 * session, and sets the httpOnly 'gt_staff' cookie. The same failure response
 * is returned whether the account is missing, the password is wrong, or the
 * account is not staff — no oracle for probing staff emails.
 */
export async function POST(req: Request) {
  // Staff creds are the crown jewels — same 10/min/IP damping as member login.
  const limited = rateLimit({
    route: 'staff/login',
    limit: 10,
    windowMs: 60_000,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const email = parsed.data.email.toLowerCase();
  const rows = await getDb()
    .select({
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      passwordHash: accounts.passwordHash,
      status: accounts.status,
      role: admins.role,
    })
    .from(accounts)
    .innerJoin(admins, eq(admins.accountId, accounts.id))
    .where(eq(accounts.email, email))
    .limit(1);

  const ip = clientIp(req);
  const account = rows[0];
  if (!account || account.status !== 'active' || account.passwordHash === null) {
    // Equalize timing with the success path (A4): run a real scrypt so the
    // absence of a staff account is not detectably faster than a wrong password.
    await verifyPassword(parsed.data.password, DUMMY_PASSWORD_HASH);
    // Audit the failed attempt with NO actor (we can't prove identity) and only
    // a hashed email tag — never the raw email or a staff/not-staff signal (A8).
    await logAudit(null, 'staff.login', 'account', null, { ok: false, emailTag: emailTag(email) }, ip);
    return json({ error: 'bad_credentials' }, 401);
  }
  const passwordOk = await verifyPassword(parsed.data.password, account.passwordHash);
  if (!passwordOk) {
    await logAudit(null, 'staff.login', 'account', account.id, { ok: false, emailTag: emailTag(email) }, ip);
    return json({ error: 'bad_credentials' }, 401);
  }

  let permissions: readonly string[];
  try {
    permissions = Array.from(
      await effectivePermissionSet({
        id: account.id,
        email: account.email,
        role: account.role,
      }),
    );
  } catch (error) {
    console.error('staff login permission lookup failed:', error);
    return json({ error: 'authorization_unavailable' }, 503);
  }

  const token = await createSession(account.id);
  await setStaffCookie(token);
  await logAudit({ id: account.id }, 'staff.login', 'account', account.id, { ok: true, role: account.role }, ip);
  return json(
    {
      user: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        role: account.role,
      },
      // Contract §4.3: clients gate on PERMISSIONS, never on role names.
      role: account.role,
      permissions,
    },
    200,
  );
}
