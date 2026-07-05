import { accounts } from '@gym/db';
import { effectiveTier } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { verifyPassword } from '@/lib/password';

export const runtime = 'nodejs';

const bodySchema = z.object({
  email: z.string(),
  password: z.string(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const email = parsed.data.email.toLowerCase();
  const rows = await getDb()
    .select({
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      tier: accounts.tier,
      tierExpiresAt: accounts.tierExpiresAt,
      passwordHash: accounts.passwordHash,
    })
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);

  // Google-only accounts have no passwordHash — password login always fails.
  const account = rows[0];
  if (
    !account ||
    account.passwordHash === null ||
    !verifyPassword(parsed.data.password, account.passwordHash)
  ) {
    return json({ error: 'bad_credentials' }, 401);
  }

  const token = await createSession(account.id);
  return json(
    {
      token,
      user: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        // Effective tier: a lapsed paid tier logs in as 'starter' (no cron).
        tier: effectiveTier(account.tier, account.tierExpiresAt, new Date()),
      },
    },
    200,
  );
}
