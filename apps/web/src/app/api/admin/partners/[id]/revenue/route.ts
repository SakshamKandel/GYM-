import { mealOrders, mealPartners } from '@gym/db';
import { ktmDateString } from '@gym/shared';
import { and, eq, gte, sql } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin — per-partner revenue breakdown (read-only). Guarded by
 * `partners.manage` (super_admin/main_admin bypass only), mirroring the rest of
 * the `/api/admin/partners` surface.
 *
 * Splits delivered-order money the way it actually flows so ops/finance can see
 * what a restaurant is owed vs. what it already holds:
 *  - `codCollectedMinor` — cash the partner took at the door (COD, non-refunded);
 *  - `digitalHeldMinor`  — eSewa/Khalti money the PLATFORM holds (`paid` only)
 *    and still owes the partner — the payout precursor.
 * Only `delivered` orders count toward earned figures; an order later
 * **refunded** is excluded from gross/COD/digital and reported separately via
 * `refundedMinor`. Every figure is integer minor units. Two windows are
 * returned: `thisMonth` (KTM calendar month to date) and `allTime`.
 */

interface RevenueBucket {
  deliveredOrders: number;
  grossMinor: number;
  codCollectedMinor: number;
  digitalHeldMinor: number;
  refundedOrders: number;
  refundedMinor: number;
}

/**
 * Aggregate delivered-order money for one partner, optionally from a KTM
 * `YYYY-MM-DD` start date (inclusive). Refunds are netted out of every earned
 * figure; only `paid` digital counts as platform-held.
 */
async function loadRevenueBucket(
  db: ReturnType<typeof getDb>,
  partnerId: string,
  sinceDate: string | null,
): Promise<RevenueBucket> {
  const predicates = [eq(mealOrders.partnerId, partnerId), eq(mealOrders.status, 'delivered')];
  if (sinceDate) predicates.push(gte(mealOrders.deliveryDate, sinceDate));

  const [row] = await db
    .select({
      deliveredOrders: sql<string>`count(*) filter (where ${mealOrders.paymentStatus} <> 'refunded')::text`,
      grossMinor: sql<string>`coalesce(sum(${mealOrders.totalMinor}) filter (where ${mealOrders.paymentStatus} <> 'refunded'), 0)::text`,
      codCollectedMinor: sql<string>`coalesce(sum(${mealOrders.totalMinor}) filter (where ${mealOrders.paymentMethod} = 'cod' and ${mealOrders.paymentStatus} <> 'refunded'), 0)::text`,
      digitalHeldMinor: sql<string>`coalesce(sum(${mealOrders.totalMinor}) filter (where ${mealOrders.paymentMethod} in ('esewa','khalti') and ${mealOrders.paymentStatus} = 'paid'), 0)::text`,
      refundedOrders: sql<string>`count(*) filter (where ${mealOrders.paymentStatus} = 'refunded')::text`,
      refundedMinor: sql<string>`coalesce(sum(${mealOrders.totalMinor}) filter (where ${mealOrders.paymentStatus} = 'refunded'), 0)::text`,
    })
    .from(mealOrders)
    .where(and(...predicates));

  return {
    deliveredOrders: Number(row?.deliveredOrders ?? '0'),
    grossMinor: Number(row?.grossMinor ?? '0'),
    codCollectedMinor: Number(row?.codCollectedMinor ?? '0'),
    digitalHeldMinor: Number(row?.digitalHeldMinor ?? '0'),
    refundedOrders: Number(row?.refundedOrders ?? '0'),
    refundedMinor: Number(row?.refundedMinor ?? '0'),
  };
}

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'partners.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const db = getDb();

  const [partner] = await db
    .select({ id: mealPartners.id, name: mealPartners.name, currency: mealPartners.currency })
    .from(mealPartners)
    .where(eq(mealPartners.id, id))
    .limit(1);
  if (!partner) return json({ error: 'not_found' }, 404);

  // KTM calendar-month start (first-of-month in Kathmandu wall-clock).
  const today = ktmDateString(new Date());
  const monthStart = `${today.slice(0, 7)}-01`;

  const [thisMonth, allTime] = await Promise.all([
    loadRevenueBucket(db, id, monthStart),
    loadRevenueBucket(db, id, null),
  ]);

  return json(
    {
      partnerId: partner.id,
      currency: partner.currency,
      thisMonth,
      allTime,
    },
    200,
  );
}
