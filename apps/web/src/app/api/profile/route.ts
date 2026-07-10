import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { accountProfiles } from '@gym/db';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Cloud profile backup. GET restores the app's profile store on sign-in
 * (so returning users never re-run onboarding); PUT upserts it on change.
 *
 * SECURITY: the profile blob is CLIENT-OWNED and untrusted. It may still carry
 * a `tier` field for the app's own rendering, but it is NEVER mirrored onto
 * accounts.tier — the old mirror let any signed-in user grant themselves Elite
 * with a single PUT. accounts.tier is written exclusively by setAccountTier()
 * (admin/coach console overrides, POST /api/subscription/tier, buddy trial),
 * every path audited.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const rows = await getDb()
    .select({ data: accountProfiles.data, updatedAt: accountProfiles.updatedAt })
    .from(accountProfiles)
    .where(eq(accountProfiles.accountId, user.id))
    .limit(1);

  const row = rows[0];
  return json({ profile: row?.data ?? null, updatedAt: row?.updatedAt ?? null }, 200);
}

const putSchema = z.object({
  // The mobile profile store, stored opaquely — the app owns the shape.
  profile: z.record(z.string(), z.unknown()),
});

export async function PUT(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const parsed = putSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { profile } = parsed.data;
  // Guardrail: the profile blob is small; reject anything bloated.
  if (JSON.stringify(profile).length > 20_000) return json({ error: 'invalid' }, 400);

  await getDb()
    .insert(accountProfiles)
    .values({ accountId: user.id, data: profile, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: accountProfiles.accountId,
      set: { data: profile, updatedAt: new Date() },
    });

  // NOTE: deliberately no accounts.tier write here — see the header comment.

  return json({ ok: true }, 200);
}
