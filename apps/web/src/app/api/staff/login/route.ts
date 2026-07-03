import { accounts, admins } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { verifyPassword } from '@/lib/password';
import { setStaffCookie } from '@/lib/staffSession';

export const runtime = 'nodejs';

const bodySchema = z.object({
  email: z.string(),
  password: z.string(),
});

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

  const account = rows[0];
  if (
    !account ||
    account.status !== 'active' ||
    account.passwordHash === null ||
    !verifyPassword(parsed.data.password, account.passwordHash)
  ) {
    return json({ error: 'bad_credentials' }, 401);
  }

  const token = await createSession(account.id);
  await setStaffCookie(token);
  return json(
    {
      user: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        role: account.role,
      },
    },
    200,
  );
}
