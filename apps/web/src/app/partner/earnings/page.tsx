import { ktmAddDays, ktmDateString } from '@gym/shared';
import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
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
  loadPartnerLedger,
  loadPartnerPayoutRequests,
  requirePartnerPage,
} from '../_data';
import { formatMoney } from '../_format';
import { PartnerWalletView } from './_components/PartnerWalletView';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Earnings' };
export const dynamic = 'force-dynamic';

const RANGE_DAYS = 30;
const WEEKS = 8;
const WEEK_SPAN_DAYS = WEEKS * 7;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TILE_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 14,
};

function shortLabel(dateStr: string): string {
  const [, mo, da] = dateStr.split('-').map((p) => Number(p));
  return `${MONTHS[(mo ?? 1) - 1]} ${da}`;
}

/**
 * Earnings — the partner's ONE money page. It used to be two: /partner/earnings
 * showed gross delivered-order revenue while /partner/wallet showed the
 * withdrawable balance, so "how much am I owed" had two answers with different
 * numbers. The balance, the payout request and the payout history now sit at the
 * top (that is what the partner actually receives); sales sit underneath as
 * performance, clearly labelled as sales rather than as money in hand.
 *
 * Only `delivered` orders count toward sales (cancelled / refused never do), and
 * every read is scoped to the caller's own restaurant.
 */
export default async function PartnerEarningsPage() {
  const { partnerId, currency } = await requirePartnerPage();
  const db = getDb();

  const today = ktmDateString(new Date());
  const monthStart = ktmAddDays(today, -(RANGE_DAYS - 1));
  const weekWindowStart = ktmAddDays(today, -(WEEK_SPAN_DAYS - 1));

  const [earnings, weekEarnings, stats, allTime, held, ledger, requests] = await Promise.all([
    loadPartnerEarnings(db, partnerId, monthStart, currency),
    loadPartnerEarnings(db, partnerId, weekWindowStart, currency),
    loadPartnerDashboardStats(db, partnerId, today, monthStart),
    loadPartnerAllTime(db, partnerId),
    loadPartnerHeld(db, partnerId, currency),
    loadPartnerLedger(db, partnerId, 50),
    loadPartnerPayoutRequests(db, partnerId, 25),
  ]);

  const pending = requests.find((r) => r.status === 'pending') ?? null;

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
        subtitle="What you can withdraw now, and how sales are going. Cash paid at the door is already yours, so it is not part of the balance."
      />

      {/*
        The answer to "how much am I owed" — balance, payout request, payout
        history. First on the page, and the only place that figure is stated.
      */}
      <PartnerWalletView
        currency={currency}
        heldMinor={held.heldMinor}
        earnedMinor={held.earnedMinor}
        paidOutMinor={held.paidOutMinor}
        ledger={ledger}
        requests={requests}
        initialPending={pending}
      />

      {/*
        Sales, deliberately below the balance: gross delivered-order revenue is
        NOT all money the restaurant is waiting on. Cash on delivery is already
        in its hands; digital (eSewa/Khalti) is what feeds the balance above.
        Refunds are already netted out of every figure and shown for clarity.
      */}
      <Card padded={false}>
        <CardHeader title={`Sales · last ${RANGE_DAYS} days`} />
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={TILE_GRID}>
            <StatTile
              label="Sales"
              value={formatMoney(earnings.totalMinor, currency)}
              viz={{ kind: 'bars', data: revenueSeries.map((p) => p.value) }}
            />
            <StatTile label="Delivered orders" value={earnings.deliveredCount} />
            <StatTile label="Average order" value={formatMoney(avgPerOrder, currency)} />
            <StatTile
              label="Weekly average"
              value={formatMoney(weeklyAvg, currency)}
              hint={`over ${WEEKS} weeks`}
            />
          </div>
          <div style={TILE_GRID}>
            <StatTile
              label="Cash you collected"
              value={formatMoney(earnings.codCollectedMinor, currency)}
              hint="Paid at the door, already yours"
            />
            <StatTile
              label="Added to your balance"
              value={formatMoney(earnings.digitalHeldMinor, currency)}
              hint="eSewa and Khalti, paid out to you"
            />
            {earnings.refundedCount > 0 ? (
              <StatTile
                label="Refunded"
                value={formatMoney(earnings.refundedMinor, currency)}
                hint={`${earnings.refundedCount} order${earnings.refundedCount === 1 ? '' : 's'}, not counted`}
              />
            ) : null}
          </div>
        </div>
      </Card>

      {/*
        Lifetime money truth (B28 — the old route capped at 90 days, so a partner
        could never see lifetime figures). The withdrawable balance is NOT
        repeated here: it is stated once, at the top of the page.
      */}
      <Card padded={false}>
        <CardHeader title="All time" />
        <div style={{ padding: 18, ...TILE_GRID }}>
          <StatTile
            label="Cash you collected"
            value={formatMoney(allTime.codMinor, currency)}
            hint={`${allTime.deliveredCount} delivered order${allTime.deliveredCount === 1 ? '' : 's'}`}
          />
          <StatTile
            label="Added to your balance"
            value={formatMoney(allTime.digitalMinor, currency)}
            hint="eSewa and Khalti, all time"
          />
          {allTime.refundedMinor > 0 ? (
            <StatTile
              label="Refunded"
              value={formatMoney(allTime.refundedMinor, currency)}
              hint="Not counted above"
            />
          ) : null}
        </div>
      </Card>

      <ChartCard
        title="Sales by week"
        caption={`Delivered orders only · last ${WEEKS} weeks`}
        data={revenueSeries}
        valueFormat={(v) => formatMoney(v, currency)}
        height={230}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <Card padded={false}>
          <CardHeader title="Orders by week" />
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
