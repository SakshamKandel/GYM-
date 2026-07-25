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
 * SECURITY: the profile blob is CLIENT-OWNED and untrusted. It is NEVER
 * mirrored onto accounts.tier — the old mirror let any signed-in user grant
 * themselves Elite with a single PUT. accounts.tier is written exclusively by
 * setAccountTier() (admin/coach console overrides, POST /api/subscription/tier,
 * buddy trial), every path audited.
 *
 * TIER IS DERIVED, NOT STORED-AND-TRUSTED. The blob still carries a `tier` key
 * (shipped clients spread the whole store, so the key must stay in the response
 * shape), but it is now a one-way projection of accounts.tier:
 *  - PUT strips whatever tier the client sent and re-stamps the server's value,
 *    so a client round-tripping a STALE profile can no longer clobber the
 *    mirror that setAccountTier() maintains.
 *  - GET re-stamps it again on the way out, so even a historically drifted row
 *    reads back correct.
 * That leaves setAccountTier() as the single writer of the authoritative value
 * and makes the mirrored key unable to disagree with accounts.tier. The value
 * used is `user.tier` — already collapsed to the EFFECTIVE tier by
 * userForToken() — so it matches exactly what GET /api/me hands the mobile
 * auth store, which is what useEffectiveTier()/hasEntitlement() actually gate on.
 */

/**
 * Blob keys owned by `accounts`, never by the client. Stripped from every PUT
 * before the blob is persisted so no client write can influence them. `tier` is
 * the money-bearing one (it decides entitlements); the window/provenance keys
 * are listed defensively — the app has never sent them, and if it ever starts,
 * they must not become a second, unaudited tier record.
 */
const SERVER_OWNED_PROFILE_KEYS: ReadonlySet<string> = new Set([
  'tier',
  'tierExpiresAt',
  'tierSource',
  'tierSourceId',
]);

function stripServerOwnedKeys(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!SERVER_OWNED_PROFILE_KEYS.has(key)) out[key] = value;
  }
  return out;
}

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
  // Response shape unchanged (`profile` is still the whole blob, or null for an
  // account that has never synced) — only `tier` is overridden, from the account
  // row rather than from storage. A null profile stays null: the client treats
  // it as "no cloud backup" and checks `onboarded`, so stamping a lone tier key
  // into an empty object would read as a restorable profile.
  const profile = row ? { ...row.data, tier: user.tier } : null;
  return json({ profile, updatedAt: row?.updatedAt ?? null }, 200);
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
  // Guardrail: the profile blob is small; reject anything bloated. Measured on
  // the blob AS RECEIVED (before stripping) so the size contract is unchanged.
  if (JSON.stringify(profile).length > 20_000) return json({ error: 'invalid' }, 400);

  // Drop the client's tier claim and re-stamp the account's own value, so the
  // stored mirror can only ever agree with accounts.tier. Before this, a client
  // that round-tripped a profile it had read minutes (or an app-launch) earlier
  // silently overwrote a tier granted in the meantime by an admin, the coach
  // console, a manual payment approval or the RevenueCat webhook.
  const data = { ...stripServerOwnedKeys(profile), tier: user.tier };

  await getDb()
    .insert(accountProfiles)
    .values({ accountId: user.id, data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: accountProfiles.accountId,
      set: { data, updatedAt: new Date() },
    });

  // NOTE: deliberately no accounts.tier write here — see the header comment.

  return json({ ok: true }, 200);
}
