import { accounts } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { hashPassword } from '@/lib/password';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().max(120),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  // Mass-signup damping: 10 registrations/min per IP (in-memory, per instance).
  const limited = rateLimit({
    route: 'auth/register',
    limit: 10,
    windowMs: 60_000,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const email = parsed.data.email.toLowerCase();
  const db = getDb();

  const existing = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);
  if (existing.length > 0) return json({ error: 'email_taken' }, 409);

  const passwordHash = await hashPassword(parsed.data.password);

  let created: { id: string; email: string; displayName: string; tier: string }[];
  try {
    created = await db
      .insert(accounts)
      .values({
        email,
        passwordHash,
        displayName: parsed.data.displayName.trim(),
      })
      .returning({
        id: accounts.id,
        email: accounts.email,
        displayName: accounts.displayName,
        tier: accounts.tier,
      });
  } catch {
    // Unique-constraint race: someone registered the same email between the
    // check above and this insert.
    return json({ error: 'email_taken' }, 409);
  }

  const user = created[0];
  if (!user) return json({ error: 'invalid' }, 400);

  const token = await createSession(user.id);
  return json({ token, user }, 201);
}
