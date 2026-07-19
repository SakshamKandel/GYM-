import { ktmAddDays, ktmDateString } from '@gym/shared';
import Link from 'next/link';
import {
  Card,
  CardHeader,
  ChartCard,
  type ChartPoint,
  EmptyState,
  PageHeader,
  StatTile,
} from '@/components/console';
import { getDb } from '@/lib/db';
import {
  loadPartnerAllTime,
  loadPartnerDashboardStats,
  loadPartnerEarnings,
  loadPartnerHeld,
  requirePartnerPage,
} from '../_data';
import { formatMoney } from '../_format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RANGE_DAYS = 30;
const WEEKS = 8;
const WEEK_SPAN_DAYS = WEEKS * 7;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortLabel(dateStr: string): string {
  const [, mo, da] = dateStr.split('-').map((p) => Number(p));
  return `${MONTHS[(mo ?? 1) - 1]} ${da}`;
}

/**
 * Earnings — delivered-order revenue analytics for the partner. Adds a weekly
 * revenue + order-count rollup (last 8 weeks) on top of the 30-day totals, plus
 * the best-selling items over the trailing 30 days. Only `delivered` orders ever
 * count toward earnings (cancelled / refused never do); every read is scoped to
 * the caller's own restaurant.
 */
export default async function PartnerEarningsPage() {
  const { partnerId, currency } = await requirePartnerPage();
  const db = getDb();

  const today = ktmDateString(new Date());
  const monthStart = ktmAddDays(today, -(RANGE_DAYS - 1));
  const weekWindowStart = ktmAddDays(today, -(WEEK_SPAN_DAYS - 1));

  const [earnings, weekEarnings, stats, allTime, held] = await Promise.all([
    loadPartnerEarnings(db, partnerId, monthStart, currency),
    loadPartnerEarnings(db, partnerId, weekWindowStart, currency),
    loadPartnerDashboardStats(db, partnerId, today, monthStart),
    loadPartnerAllTime(db, partnerId),
    loadPartnerHeld(db, partnerId, currency),
  ]);

  const byDateRevenue = new Map(weekEarnings.byDay.map((d) => [d.date, d.totalMinor]));
  const byDateOrders = new Map(weekEarnings.byDay.map((d) => [d.date, d.orders]));

  // Bucket the trailing window into 8 calendar-week columns, oldest → newest.
  const revenueSeries: ChartPoint[] = [];
  const ordersSeries: ChartPoint[] = [];
  for (let w = WEEKS - 1; w >= 0; w -= 1) {
    const start = ktmAddDays(today, -(w * 7 + 6));
    let revenue = 0;
    let orders = 0;
    for (let d = 0; d < 7; d += 1) {
      const date = ktmAddDays(start, d);
      revenue += byDateRevenue.get(date) ?? 0;
      orders += byDateOrders.get(date) ?? 0;
    }
    revenueSeries.push({ label: shortLabel(start), value: revenue });
    ordersSeries.push({ label: shortLabel(start), value: orders });
  }

  const avgPerOrder =
    earnings.deliveredCount > 0 ? Math.round(earnings.totalMinor / earnings.deliveredCount) : 0;
  const weekTotal = weekEarnings.totalMinor;
  const weeklyAvg = Math.round(weekTotal / WEEKS);
  const maxOrders = Math.max(1, ...ordersSeries.map((p) => p.value));

  return (
    <div style={{ maxWidth: 1080, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        title="Earnings"
        subtitle={`Delivered-order revenue — 30-day totals and an ${WEEKS}-week trend.`}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 14,
        }}
      >
        <StatTile
          label={`Earnings (${RANGE_DAYS}d)`}
          value={formatMoney(earnings.totalMinor, currency)}
          viz={{ kind: 'bars', data: revenueSeries.map((p) => p.value) }}
        />
        <StatTile label="Delivered orders" value={earnings.deliveredCount} hint={`last ${RANGE_DAYS} days`} />
        <StatTile label="Avg per order" value={formatMoney(avgPerOrder, currency)} />
        <StatTile label="Weekly average" value={formatMoney(weeklyAvg, currency)} hint={`over ${WEEKS} weeks`} />
      </div>

      {/*
        Payment split (last 30d). The gross earnings above are NOT all money in
        the restaurant's hands: COD is cash it already collected at the door,
        while digital (eSewa/Khalti) is held by the platform and paid out later.
        Refunds are already netted out of every earned figure and shown here only
        for transparency.
      */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 14,
        }}
      >
        <StatTile
          label={`Collected at door (${RANGE_DAYS}d)`}
          value={formatMoney(earnings.codCollectedMinor, currency)}
          hint="Cash on delivery"
        />
        <StatTile
          label={`Held by platform (${RANGE_DAYS}d)`}
          value={formatMoney(earnings.digitalHeldMinor, currency)}
          hint="Digital — paid out later"
        />
        {earnings.refundedCount > 0 ? (
          <StatTile
            label={`Refunded (${RANGE_DAYS}d)`}
            value={formatMoney(earnings.refundedMinor, currency)}
            hint={`${earnings.refundedCount} order${earnings.refundedCount === 1 ? '' : 's'} — not counted`}
          />
        ) : null}
      </div>

      {/*
        Lifetime money truth (B28 — the old route capped at 90 days, so a
        partner could never see lifetime figures). `heldMinor` is the ledger-
        derived WITHDRAWABLE balance (B27 — decrements as payouts post, unlike
        the old permanently-inflated live sum) and doubles as the payout floor
        on the Wallet page.
      */}
      <Card padded={false}>
        <CardHeader
          title="Lifetime"
          action={
            <Link
              href="/partner/wallet"
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--gt-accent-strong)', textDecoration: 'none' }}
            >
              Wallet & payouts →
            </Link>
          }
        />
        <div
          style={{
            padding: 18,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 14,
          }}
        >
          <StatTile
            label="Lifetime collected at door"
            value={formatMoney(allTime.codMinor, currency)}
            hint={`${allTime.deliveredCount} delivered order${allTime.deliveredCount === 1 ? '' : 's'}`}
          />
          <StatTile
            label="Lifetime digital revenue"
            value={formatMoney(allTime.digitalMinor, currency)}
            hint="eSewa / Khalti, all time"
          />
          <StatTile
            label="Held by platform now"
            value={formatMoney(held.heldMinor, currency)}
            hint="Withdrawable — decrements as payouts post"
          />
          {allTime.refundedMinor > 0 ? (
            <StatTile
              label="Lifetime refunded"
              value={formatMoney(allTime.refundedMinor, currency)}
              hint="Not counted above"
            />
          ) : null}
        </div>
      </Card>

      <ChartCard
        title="Weekly revenue"
        caption={`Delivered-order revenue per week · last ${WEEKS} weeks`}
        data={revenueSeries}
        valueFormat={(v) => formatMoney(v, currency)}
        height={230}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <Card padded={false}>
          <CardHeader title="Weekly orders" />
          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ordersSeries.map((p) => (
              <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 52, fontSize: 12, color: 'var(--gt-text-dim)' }}>{p.label}</span>
                <div style={{ flex: 1, height: 10, background: 'var(--gt-surface-sunken)', borderRadius: 999 }}>
                  <div
                    style={{
                      width: `${(p.value / maxOrders) * 100}%`,
                      height: '100%',
                      background: 'var(--gt-accent-strong)',
                      borderRadius: 999,
                    }}
                  />
                </div>
                <span className="gt-numeric" style={{ width: 32, textAlign: 'right', fontSize: 13 }}>
                  {p.value}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card padded={false}>
          <CardHeader title={`Best sellers · ${RANGE_DAYS}d`} />
          {stats.bestSellers.length === 0 ? (
            <div style={{ padding: 18 }}>
              <EmptyState
                title="No sales yet"
                description="Best-selling dishes appear after your first delivered orders."
              />
            </div>
          ) : (
            <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {stats.bestSellers.map((seller, index) => (
                <li
                  key={seller.mealId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 18px',
                    borderBottom: '1px solid var(--gt-border)',
                  }}
                >
                  <span
                    className="gt-numeric"
                    style={{ width: 20, color: 'var(--gt-text-faint)', fontSize: 14 }}
                  >
                    {index + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {seller.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                      {seller.units.toLocaleString()} units
                    </div>
                  </div>
                  <strong className="gt-numeric" style={{ fontSize: 14 }}>
                    {formatMoney(seller.itemSalesMinor, currency)}
                  </strong>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
