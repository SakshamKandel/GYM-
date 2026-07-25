import { accounts } from '@gym/db';
import { maskPii } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { hashPassword } from '@/lib/password';
import { wireReferralsForNewAccount } from '@/lib/promoEconomy';
import { clientIp, rateLimitShared } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * The 120-character limit is checked on the RAW name. The mask is longer than
 * the text it replaces, so validating afterwards would reject a perfectly
 * short name that happened to contain a phone number.
 */
const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().max(120),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  try {
    // Mass-signup ceiling: 10 registrations/min per IP, counted in the shared
    // store when one is configured so concurrency can't multiply the budget.
    // No store configured (the normal local setup) → per-instance counting.
    const limited = await rateLimitShared({
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
          // The display name is shown to every coach the member ever works
          // with, so it is masked on the way in like any other free text that
          // reaches another person. Setting your name to your phone number was
          // otherwise a clean way around the chat mask.
          displayName: maskPii(parsed.data.displayName.trim()),
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

    await wireReferralsForNewAccount(user.id, email);

    const token = await createSession(user.id);
    return json({ token, user }, 201);
  } catch (err) {
    console.error('API /api/auth/register error:', err);
    return json({ error: 'internal_error' }, 500);
  }
}
