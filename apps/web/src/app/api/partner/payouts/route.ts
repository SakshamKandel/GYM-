import { mealPartners, partnerPayoutRequests } from '@gym/db';
import { validatePayoutAmount } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePartner } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp } from '@/lib/rateLimit';
import { loadPartnerHeld, loadPartnerPayoutRequests } from '@/app/partner/_data';

export const runtime = 'nodejs';

/**
 * Partner-initiated payout requests (WP-5, Pack I) — the partner half of the
 * earner payout rail, mirroring `/api/coach/payouts`.
 *
 * SELF-SCOPED and IDOR-safe (§7.2-S1): `partnerId` is ALWAYS the caller's own
 * restaurant, resolved by `requirePartner` — never the request body — so partner
 * A can never draw against partner B's ledger. The amount is validated
 * `0 < amountMinor ≤ heldMinor` (no over-draw / negative / overflow), where
 * `heldMinor` is recomputed from the ledger at request time (never trusted from
 * the client). At most ONE pending request per partner, enforced by the
 * `partner_payout_requests_one_pending` partial unique index — a concurrent
 * double-POST becomes `onConflictDoNothing` → 0 rows → 409 already_pending.
 *
 *  - POST {amountMinor} → 201 {id}. Currency is the partner's own (single).
 *  - GET → the caller's own payout-request history, newest first.
 *
 * Money is always integer minor units.
 */

/**
 * Minimum withdrawal per currency (minor units) — mirrors the coach rail. NPR
 * minor = paisa (Rs 1,000); USD minor = cents ($10). Below this the disbursement
 * fees dwarf the payout.
 */
const MIN_PAYOUT_MINOR: Record<string, number> = {
  NPR: 100_000,
  USD: 1_000,
};

const postSchema = z.object({ amountMinor: z.number().int().positive() });

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { partnerId } = guard;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { amountMinor } = parsed.data;

  const db = getDb();
  const [partner] = await db
    .select({ currency: mealPartners.currency })
    .from(mealPartners)
    .where(eq(mealPartners.id, partnerId))
    .limit(1);
  const currency = partner?.currency ?? 'NPR';

  const minimum = MIN_PAYOUT_MINOR[currency] ?? MIN_PAYOUT_MINOR.NPR;
  if (amountMinor < minimum) {
    return json({ error: 'below_minimum', minimumMinor: minimum, currency }, 400);
  }

  // Balance floor: recompute the withdrawable held balance from the ledger at
  // request time (never trust the client). `heldMinor` already nets out prior
  // payouts, so a partner cannot request money already disbursed. The admin
  // re-checks the balance authoritatively at decision time.
  const held = await loadPartnerHeld(db, partnerId, currency);
  const check = validatePayoutAmount(amountMinor, held.heldMinor);
  if (!check.ok) {
    return json({ error: 'insufficient_balance', heldMinor: held.heldMinor, currency }, 409);
  }

  // The partial unique (partner_id WHERE status='pending') is the real guard
  // against a concurrent double-POST; onConflictDoNothing turns a lost race into
  // 0 rows → already_pending.
  const inserted = await db
    .insert(partnerPayoutRequests)
    .values({ partnerId, currency, amountMinor })
    .onConflictDoNothing()
    .returning({ id: partnerPayoutRequests.id });

  const request = inserted[0];
  if (!request) return json({ error: 'already_pending' }, 409);

  await logAudit(
    guard.principal,
    'payout.request',
    'partner_payout_request',
    request.id,
    { partnerId, amountMinor, currency },
    clientIp(req),
  );

  return json({ id: request.id }, 201);
}

export async function GET(req: Request) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { partnerId } = guard;

  const requests = await loadPartnerPayoutRequests(getDb(), partnerId, 50);
  return json({ requests }, 200);
}
