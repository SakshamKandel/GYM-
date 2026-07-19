import { ktmAddDays } from '@gym/shared';
import Link from 'next/link';
import {
  Card,
  CardHeader,
  ChartCard,
  StatTile,
  type ChartPoint,
} from '@/components/console';
import type {
  PartnerDashboardStats,
  PartnerEarnings,
  PartnerMenuItem,
  PartnerOrderView,
} from '../_data';
import { formatMoney } from '../_format';
import styles from '../dashboard.module.css';

interface PartnerDashboardOverviewProps {
  activeOrders: PartnerOrderView[];
  activeSubscriptions: number;
  chartSeries: ChartPoint[];
  currency: string;
  earnings: PartnerEarnings;
  menu: PartnerMenuItem[];
  stats: PartnerDashboardStats;
  today: string;
}

interface PipelineRow {
  label: string;
  value: number;
  tone: string;
}

function sevenDayRevenueDelta(earnings: PartnerEarnings, today: string) {
  const byDate = new Map(earnings.byDay.map((day) => [day.date, day.totalMinor]));
  let current = 0;
  let previous = 0;

  for (let offset = 0; offset < 14; offset += 1) {
    const amount = byDate.get(ktmAddDays(today, -offset)) ?? 0;
    if (offset < 7) current += amount;
    else previous += amount;
  }

  if (current === previous) {
    return { value: 'No change vs prior 7d', direction: 'flat' as const };
  }
  if (previous === 0) {
    return {
      value: current > 0 ? 'New revenue this week' : 'No revenue this week',
      direction: current > 0 ? ('up' as const) : ('flat' as const),
    };
  }

  const percent = Math.round((Math.abs(current - previous) / previous) * 100);
  return {
    value: `${percent}% vs prior 7d`,
    direction: current > previous ? ('up' as const) : ('down' as const),
  };
}

export function PartnerDashboardOverview({
  activeOrders,
  activeSubscriptions,
  chartSeries,
  currency,
  earnings,
  menu,
  stats,
  today,
}: PartnerDashboardOverviewProps) {
  // "Live fulfillment" mirrors the Today board, which only lanes orders whose
  // delivery date is today; orders that slipped past their date are counted
  // separately as overdue so the tile total matches the board (dashboard-count
  // consistency). COD exposure still spans every open order — the cash is owed
  // regardless of date.
  const todaysOrders = activeOrders.filter((order) => order.deliveryDate === today);
  const overdueCount = activeOrders.length - todaysOrders.length;
  const pending = todaysOrders.filter((order) => order.status === 'pending').length;
  const confirmed = todaysOrders.filter((order) => order.status === 'confirmed').length;
  const preparing = todaysOrders.filter((order) => order.status === 'preparing').length;
  const enRoute = todaysOrders.filter((order) => order.status === 'out_for_delivery').length;
  const inKitchen = confirmed + preparing;
  const totalLive = todaysOrders.length;
  const lunchQueue = todaysOrders.filter((order) => order.window === 'lunch').length;
  const dinnerQueue = todaysOrders.filter((order) => order.window === 'dinner').length;
  const activeMenu = menu.filter((item) => item.isActive).length;
  const codOrders = activeOrders.filter(
    (order) => order.paymentMethod === 'cod' && order.paymentStatus !== 'paid',
  );
  const codExposureMinor = codOrders.reduce((sum, order) => sum + order.totalMinor, 0);
  const averageOrderMinor =
    earnings.deliveredCount > 0
      ? Math.round(earnings.totalMinor / earnings.deliveredCount)
      : 0;
  const completionBase = Math.max(0, stats.today.totalOrders - stats.today.cancelled);
  const completionRate = completionBase > 0 ? stats.today.delivered / completionBase : 0;
  const revenueDelta = sevenDayRevenueDelta(earnings, today);

  const pipeline: PipelineRow[] = [
    { label: 'Waiting confirmation', value: pending, tone: styles.fillWarning },
    { label: 'In the kitchen', value: inKitchen, tone: styles.fillInfo },
    { label: 'Out for delivery', value: enRoute, tone: styles.fillAccent },
  ];

  return (
    <>
      <div className={styles.kpiGrid}>
        <StatTile
          label="Orders today"
          value={stats.today.totalOrders.toLocaleString()}
          hint={`${stats.today.customers.toLocaleString()} unique customers`}
          viz={{ kind: 'ring', value: completionRate }}
        />
        <StatTile
          label="Revenue · 30 days"
          value={formatMoney(earnings.totalMinor, currency)}
          delta={revenueDelta}
          viz={{ kind: 'spark', data: chartSeries.map((point) => point.value) }}
        />
        <StatTile
          label="Active subscriptions"
          value={activeSubscriptions.toLocaleString()}
          hint="recurring meal plans"
        />
        <StatTile
          label="Customers served"
          value={stats.customersInRange.toLocaleString()}
          hint="unique · last 30 days"
          viz={{ kind: 'bars', data: earnings.byDay.slice(-7).map((day) => day.orders) }}
        />
      </div>

      <div className={styles.analyticsGrid}>
        <ChartCard
          title="Sales performance"
          caption="Delivered-order revenue · last 7 days"
          data={chartSeries}
          valueFormat={(value) => formatMoney(value, currency)}
          height={230}
          action={
            <Link href="/partner/earnings" className={styles.textAction}>
              Full earnings
            </Link>
          }
        />

        <Card padded={false} className={styles.fullHeightCard}>
          <CardHeader title="Live fulfillment" />
          <div className={styles.cardBody}>
            <ul className={styles.pipelineList}>
              {pipeline.map((row) => {
                const width = totalLive > 0 ? (row.value / totalLive) * 100 : 0;
                return (
                  <li key={row.label}>
                    <div className={styles.pipelineHeader}>
                      <span className={styles.pipelineLabel}>{row.label}</span>
                      <span className={`${styles.pipelineValue} gt-numeric`}>{row.value}</span>
                    </div>
                    <div className={styles.pipelineTrack} aria-hidden>
                      <div
                        className={`${styles.pipelineFill} ${row.tone}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className={styles.pipelineFooter}>
              <span>
                Lunch {lunchQueue} · Dinner {dinnerQueue}
              </span>
              <span className={styles.pipelineTotal}>{totalLive}</span>
            </div>
          </div>
        </Card>
      </div>

      <div className={styles.detailsGrid}>
        <Card padded={false} className={styles.fullHeightCard}>
          <CardHeader
            title="Best-selling meals · 30 days"
            action={
              <Link href="/partner/menu" className={styles.textAction}>
                View menu
              </Link>
            }
          />
          {stats.bestSellers.length === 0 ? (
            <div className={styles.emptyCard}>
              Best sellers will appear after your first delivered orders.
            </div>
          ) : (
            <ol className={styles.sellerList}>
              {stats.bestSellers.slice(0, 4).map((seller, index) => (
                <li key={seller.mealId} className={styles.sellerItem}>
                  <span className={styles.sellerRank}>{index + 1}</span>
                  {seller.imageUrl ? (
                    // Cloudinary URLs are already transformed for the meal catalog.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={seller.imageUrl}
                      alt=""
                      className={styles.sellerImage}
                      loading="lazy"
                    />
                  ) : (
                    <span className={styles.sellerImageFallback} aria-hidden>
                      {seller.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className={styles.sellerCopy}>
                    <div className={styles.sellerName}>{seller.name}</div>
                    <div className={styles.sellerMeta}>
                      {seller.units.toLocaleString()} units sold
                    </div>
                  </div>
                  <div className={styles.sellerSales}>
                    {formatMoney(seller.itemSalesMinor, currency)}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card padded={false} className={styles.fullHeightCard}>
          <CardHeader title="Business pulse" />
          <div className={styles.insightGrid}>
            <div className={styles.insightItem}>
              <div className={styles.insightLabel}>Today&apos;s sales</div>
              <div className={styles.insightValue}>
                {formatMoney(stats.today.revenueMinor, currency)}
              </div>
              <div className={styles.insightHint}>
                {stats.today.cancelled} cancelled or refused
              </div>
            </div>
            <div className={styles.insightItem}>
              <div className={styles.insightLabel}>Average order</div>
              <div className={styles.insightValue}>
                {formatMoney(averageOrderMinor, currency)}
              </div>
              <div className={styles.insightHint}>delivered orders · 30 days</div>
            </div>
            <div className={styles.insightItem}>
              <div className={styles.insightLabel}>Menu online</div>
              <div className={styles.insightValue}>
                {activeMenu}/{menu.length}
              </div>
              <div className={styles.insightHint}>active items available to members</div>
            </div>
            <div className={styles.insightItem}>
              <div className={styles.insightLabel}>COD in queue</div>
              <div className={styles.insightValue}>{formatMoney(codExposureMinor, currency)}</div>
              <div className={styles.insightHint}>
                {codOrders.length} cash {codOrders.length === 1 ? 'order' : 'orders'} to collect
              </div>
            </div>
            {overdueCount > 0 ? (
              <div className={styles.insightItem}>
                <div className={styles.insightLabel}>Needs attention</div>
                <div className={styles.insightValue}>{overdueCount.toLocaleString()}</div>
                <div className={styles.insightHint}>
                  overdue {overdueCount === 1 ? 'order' : 'orders'} on the board
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      </div>
    </>
  );
}
