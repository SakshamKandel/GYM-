import { accounts, devicePushTokens } from '@gym/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { classifyPushToken } from '@/lib/push';

export const runtime = 'nodejs';

/**
 * Broadcast AUDIENCE PREVIEW (P1-4 — "no audience-size preview").
 *
 * POST /api/admin/broadcast/preview { tier?, country? } → { recipients, devices,
 * unreachable, truncated } WITHOUT sending anything. Lets the composer show how
 * many members (and devices) an announcement will reach before the operator
 * commits to an irreversible fan-out.
 *
 * The audience math MUST mirror POST /api/admin/broadcast exactly, or the
 * preview would lie:
 *   - active accounts only,
 *   - EFFECTIVE tier (a lapsed paid tier collapses to 'starter'),
 *   - case-insensitive ISO-3166 alpha-2 country,
 *   - the same device query, ordering and per-send cap,
 *   - devices = registered addresses a push service can actually reach. The
 *     table still holds raw Apple device tokens from app builds made before the
 *     switch to Expo, and the send drops those instead of delivering to them, so
 *     counting them here would promise a reach that never arrives. They come
 *     back separately as `unreachable`.
 *   - recipients = distinct accounts holding at least one reachable device (a
 *     member with no device receives nothing, so is not a recipient).
 *
 * Reachability is decided by lib/push's classifyPushToken — the SAME function
 * the send routes with — so the two can never drift apart.
 *
 * Gated on the same fail-closed `broadcast.send` permission as the send route —
 * previewing an audience reveals membership counts, so it is not a weaker grant.
 * No push provider is required (nothing is sent), so this returns a real count
 * even when Firebase is unconfigured.
 */

const TIERS = ['starter', 'silver', 'gold', 'elite'] as const;

const previewSchema = z.object({
  tier: z.enum(TIERS).optional(),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'country must be a 2-letter ISO-3166 alpha-2 code (e.g. NP)')
    .optional(),
});

/**
 * Mirror of MAX_BROADCAST_TOKENS in ../route.ts — the send caps the fan-out at
 * this many devices and reports the overflow as `truncated`. The preview reports
 * the same cap so the operator learns up front that a huge audience will only be
 * partially reached in a single send. Keep in sync with the send route.
 */
const MAX_BROADCAST_TOKENS = 20_000;

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'broadcast.send');
  if (principal instanceof Response) return principal;

  const parsed = previewSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { tier, country } = parsed.data;

  const db = getDb();

  const filters = [eq(accounts.status, 'active')];
  if (tier) {
    filters.push(
      sql`(case when ${accounts.tier} <> 'starter' and ${accounts.tierExpiresAt} <= now() then 'starter' else ${accounts.tier} end) = ${tier}`,
    );
  }
  const countryCode = country?.toUpperCase();
  if (countryCode) filters.push(sql`upper(${accounts.country}) = ${countryCode}`);

  // The send's own device query, ordering and cap. Reading the addresses (not a
  // COUNT) is what lets the same classifier decide reachability here and there;
  // the cap keeps it bounded, and the send already reads exactly this much.
  const rows = await db
    .select({ token: devicePushTokens.token, accountId: devicePushTokens.accountId })
    .from(devicePushTokens)
    .innerJoin(accounts, eq(accounts.id, devicePushTokens.accountId))
    .where(and(...filters))
    .orderBy(asc(devicePushTokens.accountId))
    .limit(MAX_BROADCAST_TOKENS + 1);

  const truncated = rows.length > MAX_BROADCAST_TOKENS;
  const usable = truncated ? rows.slice(0, MAX_BROADCAST_TOKENS) : rows;

  const reachableAccounts = new Set<string>();
  let devices = 0;
  let unreachable = 0;
  for (const row of usable) {
    if (typeof row.token !== 'string' || row.token.length === 0) continue;
    // 'unknown' counts as reachable: it goes to FCM on the send, exactly as an
    // unrecognised-but-live Android address should.
    if (classifyPushToken(row.token) === 'apns') {
      unreachable += 1;
      continue;
    }
    devices += 1;
    reachableAccounts.add(row.accountId);
  }

  return json({ recipients: reachableAccounts.size, devices, unreachable, truncated }, 200);
}
