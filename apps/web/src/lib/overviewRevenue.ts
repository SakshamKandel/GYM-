import 'server-only';
import { paymentRequests } from '@gym/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from './db';

/**
 * lib/overviewRevenue.ts — the ONE definition of "revenue this month" for the
 * admin dashboard, shared by the server-rendered page (admin/_overview/data.ts)
 * and its API twin (api/admin/overview/route.ts).
 *
 * These two surfaces used to compute the figure separately and had already
 * drifted into showing different numbers for the same month: the page summed
 * `status='approved'` rows over a UTC month, the API summed settled rows minus
 * refunds over a Nepal month. Finance read whichever screen they happened to
 * open. Both now call this module, which adopts the API's basis as the correct
 * one:
 *
 *  - Nepal month boundary (UTC+05:45, no DST). The product bills Nepal, so a
 *    payment settled just after local midnight on the 1st belongs to the new
 *    month; a UTC boundary misattributes every near-midnight NPT transaction.
 *  - Settled minus refunded. `settledAt` is stamped once when a request's money
 *    side effects land and is never rewritten by a later refund, so a
 *    prior-month sale refunded this month is not re-counted as this month's
 *    gross. Refunds are cash that LEFT this month (`status='refunded'` with
 *    `decidedAt` in the month), so they subtract instead of silently vanishing —
 *    which is what an approved-only sum did.
 *
 * Server-only: it opens a Neon connection through getDb, so importing it into a
 * client bundle is a build error rather than a runtime surprise.
 */

/** Nepal Time is a fixed UTC+05:45 offset (no DST) — see @gym/shared KTM helpers. */
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

/** One currency's net recognized revenue, in integer minor units (paisa/cents). */
export interface RevenueByCurrency {
  currency: string;
  /** Settled minus refunded. May be negative in a month of net refunds. */
  amountMinor: number;
}

/**
 * The UTC instant at which the current Nepal calendar month began.
 *
 * Shift into Nepal wall-clock, truncate to the 1st at 00:00 there, then shift
 * back — so the returned Date is a real UTC instant usable directly in a
 * timestamptz comparison.
 */
export function nepalMonthStart(now: Date): Date {
  const nowNepal = new Date(now.getTime() + NEPAL_OFFSET_MS);
  return new Date(
    Date.UTC(nowNepal.getUTCFullYear(), nowNepal.getUTCMonth(), 1) - NEPAL_OFFSET_MS,
  );
}

/**
 * Net revenue for the Nepal calendar month containing `now`, grouped by
 * currency and sorted by currency code so both surfaces render the same order.
 *
 * Sums are cast to text before `Number()` — a raw `::int` sum overflows past
 * ~21.4M minor units (E12).
 */
export async function loadMonthlyRevenue(now: Date = new Date()): Promise<RevenueByCurrency[]> {
  const db = getDb();
  const monthStart = nepalMonthStart(now);

  const [gross, refunds] = await Promise.all([
    db
      .select({
        currency: paymentRequests.currency,
        total: sql<string>`sum(${paymentRequests.amountMinor})::text`,
      })
      .from(paymentRequests)
      .where(gte(paymentRequests.settledAt, monthStart))
      .groupBy(paymentRequests.currency),
    db
      .select({
        currency: paymentRequests.currency,
        total: sql<string>`sum(${paymentRequests.amountMinor})::text`,
      })
      .from(paymentRequests)
      .where(
        and(eq(paymentRequests.status, 'refunded'), gte(paymentRequests.decidedAt, monthStart)),
      )
      .groupBy(paymentRequests.currency),
  ]);

  const netByCurrency = new Map<string, number>();
  for (const row of gross) netByCurrency.set(row.currency, Number(row.total ?? 0));
  for (const row of refunds) {
    netByCurrency.set(
      row.currency,
      (netByCurrency.get(row.currency) ?? 0) - Number(row.total ?? 0),
    );
  }

  return Array.from(netByCurrency, ([currency, amountMinor]) => ({ currency, amountMinor })).sort(
    (a, b) => a.currency.localeCompare(b.currency),
  );
}
