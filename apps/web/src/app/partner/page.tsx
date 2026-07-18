import { ktmAddDays, ktmDateString } from '@gym/shared';
import Link from 'next/link';
import { PageHeader, type ChartPoint } from '@/components/console';
import { getDb } from '@/lib/db';
import { materializeDueOrders } from '@/lib/meals';
import { PartnerDashboardOverview } from './_components/PartnerDashboardOverview';
import { TodayBoard } from './_components/TodayBoard';
import {
  countActiveSubscriptions,
  loadActiveOrders,
  loadPartnerDashboardStats,
  loadPartnerEarnings,
  loadPartnerMenu,
  requirePartnerPage,
} from './_data';
import { formatDateLabel } from './_format';
import styles from './dashboard.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EARNINGS_RANGE_DAYS = 30;
const CHART_RANGE_DAYS = 7;

/**
 * Partner command center: materializes due subscription deliveries, then loads
 * partner-scoped fulfillment and aggregate business analytics in parallel. The
 * live queue remains on the landing page so operational actions stay one click
 * away from the higher-level sales, customer, subscription, and menu signals.
 */
export default async function PartnerDashboardPage() {
  const { partnerId, partnerName, currency } = await requirePartnerPage();
  const db = getDb();

  await materializeDueOrders(db, { kind: 'partner', partnerId });

  const today = ktmDateString(new Date());
  const sinceDate = ktmAddDays(today, -(EARNINGS_RANGE_DAYS - 1));
  const [activeOrders, earnings, activeSubscriptions, menu, stats] = await Promise.all([
    loadActiveOrders(db, partnerId),
    loadPartnerEarnings(db, partnerId, sinceDate, currency),
    countActiveSubscriptions(db, partnerId),
    loadPartnerMenu(db, partnerId),
    loadPartnerDashboardStats(db, partnerId, today, sinceDate),
  ]);

  const earningsByDate = new Map(earnings.byDay.map((day) => [day.date, day.totalMinor]));
  const chartStart = ktmAddDays(today, -(CHART_RANGE_DAYS - 1));
  const chartSeries: ChartPoint[] = [];
  for (let index = 0; index < CHART_RANGE_DAYS; index += 1) {
    const date = ktmAddDays(chartStart, index);
    chartSeries.push({
      label: formatDateLabel(date).slice(0, 3),
      value: earningsByDate.get(date) ?? 0,
    });
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Partner dashboard"
        subtitle={`${partnerName} · ${formatDateLabel(today)} · Live kitchen and business performance.`}
        secondaryAction={
          <Link href="/partner/history" className={styles.secondaryAction}>
            Order history
          </Link>
        }
        action={
          <Link href="/partner/menu" className={styles.primaryAction}>
            Manage menu
          </Link>
        }
      />

      <PartnerDashboardOverview
        activeOrders={activeOrders}
        activeSubscriptions={activeSubscriptions}
        chartSeries={chartSeries}
        currency={currency}
        earnings={earnings}
        menu={menu}
        stats={stats}
        today={today}
      />

      <section id="live-orders" className={styles.queueSection} aria-labelledby="live-orders-title">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="live-orders-title" className={styles.sectionTitle}>
              Today&apos;s board
            </h2>
            <p className={styles.sectionDescription}>
              Every order due today, split by delivery window and fulfillment stage. Advance each
              order with one tap; the board refreshes itself and flags late deliveries.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Link href="/partner/prep" className={styles.textAction}>
              Prep summary
            </Link>
            <Link href="/partner/subscriptions" className={styles.textAction}>
              Subscription deliveries
            </Link>
          </div>
        </div>

        <TodayBoard orders={activeOrders} today={today} currency={currency} />
      </section>
    </div>
  );
}
