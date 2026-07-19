import { ktmAddDays, ktmDateString } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { mealPartners } from '@gym/db';
import { requirePartner } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import {
  loadPartnerAllTime,
  loadPartnerEarnings,
  loadPartnerHeld,
  loadPartnerLedger,
} from '@/app/partner/_data';

export const runtime = 'nodejs';

/**
 * Partner earnings summary (§3 / §8 / WP-5, Pack I). Scoped by the
 * requirePartner-derived partnerId — never a body/param — so one restaurant can
 * never read another's money.
 *
 * The response follows the money in three layers:
 *  - `window`  — the selected trailing range (COD-vs-digital split, bucketed by
 *    delivery date) for the earnings chart;
 *  - `allTime` — the same split with NO date cap, so a partner can finally see
 *    lifetime figures (fixes B28 — the old route capped at 90 days);
 *  - `heldMinor` — the WITHDRAWABLE balance. Unlike the old B27 live-sum, this
 *    decrements as `partner_wallet_ledger` payout rows post, so a real
 *    disbursement no longer reads as permanently-owed.
 *  - `ledger`  — recent wallet-ledger rows (payout/adjustment history).
 *
 * All figures are integer minor units.
 */

const querySchema = z.object({ range: z.enum(['7', '30', '90']).default('30') });

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { partnerId } = guard;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ range: url.searchParams.get('range') ?? undefined });
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const days = Number(parsed.data.range);

  const db = getDb();
  const [partner] = await db
    .select({ currency: mealPartners.currency })
    .from(mealPartners)
    .where(and(eq(mealPartners.id, partnerId)))
    .limit(1);
  const currency = partner?.currency ?? 'NPR';

  const today = ktmDateString(new Date());
  const sinceDate = ktmAddDays(today, -(days - 1));

  const [windowEarnings, allTime, held, ledger] = await Promise.all([
    loadPartnerEarnings(db, partnerId, sinceDate, currency),
    loadPartnerAllTime(db, partnerId),
    loadPartnerHeld(db, partnerId, currency),
    loadPartnerLedger(db, partnerId, 50),
  ]);

  return json(
    {
      currency,
      window: {
        days,
        codMinor: windowEarnings.codCollectedMinor,
        digitalMinor: windowEarnings.digitalHeldMinor,
        totalMinor: windowEarnings.totalMinor,
        deliveredCount: windowEarnings.deliveredCount,
        refundedMinor: windowEarnings.refundedMinor,
        refundedCount: windowEarnings.refundedCount,
        byDay: windowEarnings.byDay,
      },
      allTime: {
        codMinor: allTime.codMinor,
        digitalMinor: allTime.digitalMinor,
        deliveredCount: allTime.deliveredCount,
        refundedMinor: allTime.refundedMinor,
      },
      // Withdrawable balance — decrements on payout (fixes B27).
      heldMinor: held.heldMinor,
      earnedMinor: held.earnedMinor,
      paidOutMinor: held.paidOutMinor,
      adjustmentMinor: held.adjustmentMinor,
      ledgerDerived: held.ledgerDerived,
      ledger,
    },
    200,
  );
}
