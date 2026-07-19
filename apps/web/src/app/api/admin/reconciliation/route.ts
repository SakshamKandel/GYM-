import { mealOrders, mealPartners, partnerWalletLedger } from '@gym/db';
import { ktmDateString } from '@gym/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission } from '@/lib/authz';
import { csvLine } from '@/lib/csv';
import { getDb } from '@/lib/db';
import { CORS_HEADERS, json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin — consolidated all-partner daily reconciliation (WP-5, Pack I). For a
 * single KTM delivery date it reports, per partner: cash collected at the door
 * (COD), digital money the platform holds that day, delivered/refused counts,
 * and the running lifetime `owedMinor` (net held — decrements as payouts post).
 * This closes the reconciliation loop finance was missing.
 *
 *  - GET ?date=YYYY-MM-DD           → JSON { date, partners[], totals }.
 *  - GET ?date=YYYY-MM-DD&format=csv → CSV download (bounded — one row/partner).
 *
 * Guarded by requirePermission('partners.manage') (super/main bypass), mirroring
 * the per-partner revenue route. Every figure is integer minor units.
 */

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

interface ReconRow {
  partnerId: string;
  name: string;
  currency: string;
  codCollectedMinor: number;
  digitalHeldMinor: number;
  delivered: number;
  refused: number;
  /** Lifetime net held (owed) — decrements as payouts post. */
  owedMinor: number;
}

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'partners.manage');
  if (principal instanceof Response) return principal;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    date: url.searchParams.get('date') ?? undefined,
    format: url.searchParams.get('format') ?? undefined,
  });
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const date = parsed.data.date ?? ktmDateString(new Date());
  const db = getDb();

  const partners = await db
    .select({ id: mealPartners.id, name: mealPartners.name, currency: mealPartners.currency })
    .from(mealPartners);

  const rows: ReconRow[] = [];
  if (partners.length > 0) {
    const partnerIds = partners.map((p) => p.id);

    // One grouped pass for the date's delivered/refused split.
    const dayRows = await db
      .select({
        partnerId: mealOrders.partnerId,
        delivered: sql<string>`count(*) filter (where ${mealOrders.status} = 'delivered')::text`,
        refused: sql<string>`count(*) filter (where ${mealOrders.status} = 'refused')::text`,
        cod: sql<string>`coalesce(sum(${mealOrders.totalMinor}) filter (where ${mealOrders.status} = 'delivered' and ${mealOrders.paymentMethod} = 'cod' and ${mealOrders.paymentStatus} <> 'refunded'), 0)::text`,
        digital: sql<string>`coalesce(sum(${mealOrders.totalMinor}) filter (where ${mealOrders.status} = 'delivered' and ${mealOrders.paymentMethod} in ('esewa','khalti') and ${mealOrders.paymentStatus} = 'paid'), 0)::text`,
      })
      .from(mealOrders)
      .where(eq(mealOrders.deliveryDate, date))
      .groupBy(mealOrders.partnerId);
    const dayByPartner = new Map(dayRows.map((r) => [r.partnerId, r]));

    // Lifetime live digital-held (delivered, paid) per partner — the earned base
    // when the ledger flag is off.
    const allTimeRows = await db
      .select({
        partnerId: mealOrders.partnerId,
        digital: sql<string>`coalesce(sum(${mealOrders.totalMinor}) filter (where ${mealOrders.paymentMethod} in ('esewa','khalti') and ${mealOrders.paymentStatus} = 'paid'), 0)::text`,
      })
      .from(mealOrders)
      .where(eq(mealOrders.status, 'delivered'))
      .groupBy(mealOrders.partnerId);
    const allTimeByPartner = new Map(allTimeRows.map((r) => [r.partnerId, Number(r.digital)]));

    // Ledger folds per partner (earning / adjustment / payout).
    const ledgerRows = await db
      .select({
        partnerId: partnerWalletLedger.partnerId,
        earning: sql<string>`coalesce(sum(${partnerWalletLedger.amountMinor}) filter (where ${partnerWalletLedger.type} = 'earning'), 0)::text`,
        adjustment: sql<string>`coalesce(sum(${partnerWalletLedger.amountMinor}) filter (where ${partnerWalletLedger.type} = 'adjustment'), 0)::text`,
        payout: sql<string>`coalesce(sum(${partnerWalletLedger.amountMinor}) filter (where ${partnerWalletLedger.type} = 'payout'), 0)::text`,
      })
      .from(partnerWalletLedger)
      .where(inArray(partnerWalletLedger.partnerId, partnerIds))
      .groupBy(partnerWalletLedger.partnerId);
    const ledgerByPartner = new Map(
      ledgerRows.map((r) => [
        r.partnerId,
        { earning: Number(r.earning), adjustment: Number(r.adjustment), payout: Number(r.payout) },
      ]),
    );

    for (const p of partners) {
      const day = dayByPartner.get(p.id);
      const ledger = ledgerByPartner.get(p.id) ?? { earning: 0, adjustment: 0, payout: 0 };
      // Earned base is ALWAYS the live delivered-digital-paid sum — the ledger
      // `earning` fold never accrues at runtime (only the one-time backfill writes
      // it), so a ledger-derived base would freeze and understate owed. The live
      // sum stays current; the ledger supplies only adjustment/payout movements.
      const earnedBase = allTimeByPartner.get(p.id) ?? 0;
      // `partnerBalance` convention: payout rows carry a POSITIVE magnitude that
      // is SUBTRACTED → owed = earned + adjustment − payout.
      const owedMinor = earnedBase + ledger.adjustment - ledger.payout;
      rows.push({
        partnerId: p.id,
        name: p.name,
        currency: p.currency,
        codCollectedMinor: Number(day?.cod ?? '0'),
        digitalHeldMinor: Number(day?.digital ?? '0'),
        delivered: Number(day?.delivered ?? '0'),
        refused: Number(day?.refused ?? '0'),
        owedMinor,
      });
    }
    rows.sort((a, b) => b.owedMinor - a.owedMinor);
  }

  if (parsed.data.format === 'csv') {
    let body = csvLine([
      'partner_id',
      'name',
      'currency',
      'delivered',
      'refused',
      'cod_collected_minor',
      'digital_held_minor',
      'owed_minor',
    ]);
    for (const r of rows) {
      body += csvLine([
        r.partnerId,
        r.name,
        r.currency,
        r.delivered,
        r.refused,
        r.codCollectedMinor,
        r.digitalHeldMinor,
        r.owedMinor,
      ]);
    }
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="reconciliation-${date}.csv"`,
        'Cache-Control': 'no-store',
        ...CORS_HEADERS,
      },
    });
  }

  const totals = rows.reduce(
    (acc, r) => {
      acc.codCollectedMinor += r.codCollectedMinor;
      acc.digitalHeldMinor += r.digitalHeldMinor;
      acc.delivered += r.delivered;
      acc.refused += r.refused;
      acc.owedMinor += r.owedMinor;
      return acc;
    },
    { codCollectedMinor: 0, digitalHeldMinor: 0, delivered: 0, refused: 0, owedMinor: 0 },
  );

  // `ledgerDerived` retained for response compatibility; always false — owed is
  // computed from the live delivered-paid sum, never the (non-accruing) ledger fold.
  return json({ date, ledgerDerived: false, partners: rows, totals }, 200);
}
