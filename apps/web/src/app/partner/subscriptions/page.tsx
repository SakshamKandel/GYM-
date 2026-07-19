import { ktmDateString } from '@gym/shared';
import {
  Badge,
  Card,
  CardHeader,
  ChartCard,
  type ChartPoint,
  type Column,
  DataTable,
  PageHeader,
  StatTile,
} from '@/components/console';
import { getDb } from '@/lib/db';
import { materializeDueOrders } from '@/lib/meals';
import { OrdersQueue } from '../_components/OrdersQueue';
import {
  loadActiveOrders,
  loadSubscriptionForecast,
  loadSubscriptionRoster,
  requirePartnerPage,
  type PartnerSubscriptionRow,
} from '../_data';
import { type BadgeTone, formatDateLabel, formatMoney, windowShort } from '../_format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FORECAST_WEEKS = 4;
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function weekLabel(weekStart: string): string {
  const [, mo, da] = weekStart.split('-').map((p) => Number(p));
  return `${MONTHS[(mo ?? 1) - 1]} ${da}`;
}

function scheduleLabel(days: number[], window: PartnerSubscriptionRow['window']): string {
  const label = days.length === 7 ? 'Every day' : days.map((d) => DOW_SHORT[d]).join(', ') || '—';
  return `${label} · ${windowShort(window)}`;
}

const SUB_STATUS_TONE: Record<PartnerSubscriptionRow['status'], BadgeTone> = {
  active: 'positive',
  paused: 'warning',
  cancelled: 'neutral',
};

const CYCLE_TONE: Record<string, BadgeTone> = {
  paid: 'positive',
  awaiting_payment: 'warning',
  open: 'info',
  void: 'neutral',
};

const CYCLE_LABEL: Record<string, string> = {
  paid: 'Paid',
  awaiting_payment: 'Awaiting payment',
  open: 'Open',
  void: 'Void',
};

/**
 * Subscriptions — the partner's standing meal-plan surface (WP-8). Three layers,
 * newest management-need first:
 *
 *  1. A masked-contact SUBSCRIBER ROSTER (schedule, plan, price, start date,
 *     status, and this-week's billing-cycle state) so the restaurant can tell an
 *     *unpaid* week apart from a *skipped/paused/cancelled* one.
 *  2. A read-only DEMAND FORECAST (scheduled slots per week) for kitchen capacity
 *     planning — derived purely from the subscription schedule, independent of the
 *     materializer's spawn horizon.
 *  3. The existing UPCOMING-DELIVERIES fulfillment queue (materialized
 *     subscription orders), unchanged.
 */
export default async function PartnerSubscriptionsPage() {
  const { partnerId } = await requirePartnerPage();
  const db = getDb();
  await materializeDueOrders(db, { kind: 'partner', partnerId });

  const today = ktmDateString(new Date());
  const [orders, roster, forecast] = await Promise.all([
    loadActiveOrders(db, partnerId, { source: 'subscription' }),
    loadSubscriptionRoster(db, partnerId, today),
    loadSubscriptionForecast(db, partnerId, today, FORECAST_WEEKS),
  ]);

  const forecastSeries: ChartPoint[] = forecast.weeks.map((w) => ({
    label: weekLabel(w.weekStart),
    value: w.slots,
  }));
  const nextWeekSlots = forecast.weeks[0]?.slots ?? 0;

  const columns: Column<PartnerSubscriptionRow>[] = [
    {
      key: 'customer',
      header: 'Subscriber',
      render: (r) => (
        <div>
          <div style={{ fontSize: 14 }}>{r.customerLabel}</div>
          <div className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
            {r.phoneMasked}
          </div>
        </div>
      ),
    },
    {
      key: 'schedule',
      header: 'Schedule',
      render: (r) => scheduleLabel(r.daysOfWeek, r.window),
    },
    {
      key: 'plan',
      header: 'Plan',
      render: (r) => (r.planType === 'partner_rotating' ? 'Rotating' : (r.mealName ?? 'Removed meal')),
    },
    {
      key: 'price',
      header: 'Price / day',
      align: 'right',
      render: (r) => (
        <span className="gt-numeric">{formatMoney(r.pricePerDayMinor, r.currency)}</span>
      ),
    },
    {
      key: 'started',
      header: 'Started',
      render: (r) => formatDateLabel(r.startDate),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <Badge tone={SUB_STATUS_TONE[r.status]}>{r.status}</Badge>,
    },
    {
      key: 'week',
      header: 'This week',
      render: (r) =>
        r.thisWeekCycle ? (
          <Badge tone={CYCLE_TONE[r.thisWeekCycle.status] ?? 'neutral'}>
            {CYCLE_LABEL[r.thisWeekCycle.status] ?? r.thisWeekCycle.status}
          </Badge>
        ) : (
          <span style={{ color: 'var(--gt-text-faint)' }}>—</span>
        ),
    },
  ];

  return (
    <div style={{ maxWidth: 1080, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        title="Subscriptions"
        subtitle="Your standing meal-plan subscribers, this week's billing state, and a forward demand forecast. Contact details are masked here — full delivery details appear on each materialized order."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 14,
        }}
      >
        <StatTile label="Active subscriptions" value={forecast.activeCount} />
        <StatTile label="Paused" value={forecast.pausedCount} />
        <StatTile label="Scheduled next 7 days" value={nextWeekSlots} hint="meals" />
        <StatTile label="Upcoming deliveries" value={orders.length} hint="materialized" />
      </div>

      {forecastSeries.length > 0 && (
        <ChartCard
          title="Demand forecast"
          caption={`Scheduled subscription meals per week · next ${FORECAST_WEEKS} weeks`}
          data={forecastSeries}
          valueFormat={(v) => `${v} meals`}
          height={200}
        />
      )}

      <Card padded={false}>
        <CardHeader
          title="Subscriber roster"
          action={
            <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
              {roster.length} {roster.length === 1 ? 'subscription' : 'subscriptions'}
            </span>
          }
        />
        <div style={{ padding: 16 }}>
          <DataTable
            columns={columns}
            rows={roster}
            rowKey={(r) => r.id}
            empty="No subscriptions yet. Members who subscribe to a recurring plan with your kitchen will appear here."
          />
        </div>
      </Card>

      <Card padded={false}>
        <CardHeader title="Upcoming deliveries" />
        <div style={{ padding: 16 }}>
          <OrdersQueue
            orders={orders}
            emptyTitle="No subscription orders yet"
            emptyDescription="When members subscribe to a recurring plan with your kitchen, their upcoming deliveries appear here automatically."
          />
        </div>
      </Card>
    </div>
  );
}
