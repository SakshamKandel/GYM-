import { accounts } from '@gym/db';
import { effectiveTier, type Tier } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePartner } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * POST /api/partner/verify-member {code} — restaurant staff verify the member
 * code a customer shows from the app's /membership-card screen, to apply the
 * in-person member discount.
 *
 * The code is the member's account id with dashes stripped and uppercased
 * (exactly what the card screen renders, spaces/grouping tolerated). Response
 * is PII-minimal: FIRST name only + effective tier + validity — never email,
 * full name, or ids. Any miss (malformed code, unknown account) is a uniform
 * `not_found` so the endpoint can't be used as an account-enumeration oracle,
 * and lookups are rate-limited per partner account (30/min) to keep brute
 * force uninteresting (32-hex codes are unguessable anyway).
 */

const bodySchema = z.object({ code: z.string().min(1).max(64) });

/** 32 hex chars (grouping/spacing tolerated) → canonical lowercase uuid. */
function codeToAccountId(raw: string): string | null {
  const hex = raw.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** First name only — the partner needs a greeting, not an identity record. */
function firstName(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0];
  return first || 'Member';
}

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;

  const limited = rateLimit({
    route: 'partner/verify-member',
    limit: 30,
    windowMs: 60_000,
    ip: guard.principal.id,
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const accountId = codeToAccountId(parsed.data.code);
  if (!accountId) return json({ error: 'not_found' }, 404);

  const rows = await getDb()
    .select({
      displayName: accounts.displayName,
      tier: accounts.tier,
      tierExpiresAt: accounts.tierExpiresAt,
    })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  const row = rows[0];
  if (!row) return json({ error: 'not_found' }, 404);

  const tier: Tier = effectiveTier(row.tier, row.tierExpiresAt, new Date());
  return json({
    member: {
      name: firstName(row.displayName),
      tier,
      // Paid member right now — the condition for the in-person discount.
      active: tier !== 'starter',
      validThru: tier !== 'starter' && row.tierExpiresAt ? row.tierExpiresAt.toISOString() : null,
    },
  });
}
