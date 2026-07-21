import { accounts } from '@gym/db';
import { effectiveTier } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { verifyPassword } from '@/lib/password';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

const bodySchema = z.object({
  email: z.string(),
  password: z.string(),
});

// Fixed decoy hash (valid 'scrypt$<salt>$<hash>' format) so login always runs
// one scrypt comparison — even when the account is missing or Google-only —
// keeping response time independent of account existence (anti-enumeration).
const DUMMY_PASSWORD_HASH =
  'scrypt$3641560fad7846eb0076eba7720d89cd$7ea23e33da09fecfc197b5895b37e7414eff348e0bf4ea36a7edbc78197bedce';

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  try {
    // Credential-stuffing damping: 10 attempts/min per IP (in-memory, per instance).
    const limited = rateLimit({
      route: 'auth/login',
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
        tier: accounts.tier,
        tierExpiresAt: accounts.tierExpiresAt,
        passwordHash: accounts.passwordHash,
      })
      .from(accounts)
      .where(eq(accounts.email, email))
      .limit(1);

    // Always run one scrypt comparison so response time doesn't reveal whether the
    // email exists. Missing / Google-only accounts (null passwordHash) verify
    // against a fixed decoy hash that can never match, then still fail with 401.
    const account = rows[0];
    const passwordHash = account?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordOk = await verifyPassword(parsed.data.password, passwordHash);
    if (!account || account.passwordHash === null || !passwordOk) {
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
  } catch (err) {
    console.error('API /api/auth/login error:', err);
    return json({ error: 'internal_error' }, 500);
  }
}
