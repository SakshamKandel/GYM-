import type { ReactNode } from 'react';
import {
  Card,
  CardHeader,
  DataTable,
  StatTile,
  type Column,
} from '@/components/console';
import type {
  AnalyticsData,
  CoachPerformance,
  CountryCount,
  CurrencyAmount,
  PromoPerformance,
  RevenueMonth,
  TierCount,
} from './data';

/**
 * Presentational layer for the analytics dashboard. No data access, no chart
 * library — every visual is a styled bar or a DataTable built from the console
 * kit, themed with the shared tokens. Server-component friendly (pure render).
 */

/** Formats a signed minor-unit amount as "NPR 12,300" (major units, rounded). */
export function formatMoney(currency: string, amountMinor: number): string {
  const major = Math.round(amountMinor / 100);
  return `${currency} ${major.toLocaleString()}`;
}

/** Joins a per-currency list into "NPR 12,300 · USD 45", or "—" when empty. */
export function formatMoneyList(list: CurrencyAmount[]): string {
  const nonZero = list.filter((a) => a.amountMinor !== 0);
  const shown = nonZero.length > 0 ? nonZero : list;
  if (shown.length === 0) return '—';
  return shown.map((a) => formatMoney(a.currency, a.amountMinor)).join(' · ');
}

/** 'YYYY-MM' → "Jul 25" for a compact axis label. */
function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  const names = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const idx = Number(m) - 1;
  const name = idx >= 0 && idx < 12 ? names[idx] : month;
  return `${name} ${y.slice(2)}`;
}

/** Derives a percent delta + semantic direction from two period figures. */
function deltaFor(
  current: number,
  prior: number,
): { value: string; direction: 'up' | 'down' | 'flat' } {
  if (prior === 0) {
    if (current === 0) return { value: '0%', direction: 'flat' };
    return { value: 'new', direction: 'up' };
  }
  const pct = ((current - prior) / Math.abs(prior)) * 100;
  const direction = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat';
  const sign = pct > 0 ? '+' : '';
  return { value: `${sign}${pct.toFixed(0)}%`, direction };
}

/** Trailing-30-day headline tiles with prior-period deltas. */
export function DeltaTiles({ deltas }: { deltas: AnalyticsData['deltas'] }) {
  const tiles = [];
  for (const r of deltas.revenue) {
    tiles.push(
      <StatTile
        key={`rev-${r.currency}`}
        label={`Revenue · ${r.currency}`}
        value={formatMoney(r.currency, r.current)}
        hint="last 30 days"
        delta={deltaFor(r.current, r.prior)}
      />,
    );
  }
  tiles.push(
    <StatTile
      key="members"
      label="New members"
      value={deltas.newMembers.current.toLocaleString()}
      hint="last 30 days"
      delta={deltaFor(deltas.newMembers.current, deltas.newMembers.prior)}
    />,
    <StatTile
      key="approvals"
      label="Approved payments"
      value={deltas.approvedPayments.current.toLocaleString()}
      hint="last 30 days"
      delta={deltaFor(deltas.approvedPayments.current, deltas.approvedPayments.prior)}
    />,
  );

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12,
        marginBottom: 24,
      }}
    >
      {tiles}
    </div>
  );
}

/** One currency's 12-month revenue as proportional horizontal bars. */
function RevenueSeries({
  currency,
  points,
}: {
  currency: string;
  points: { month: string; amountMinor: number }[];
}) {
  const max = Math.max(1, ...points.map((p) => Math.abs(p.amountMinor)));
  return (
    <Card padded={false}>
      <CardHeader title={`Revenue · ${currency}`} />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {points.map((p) => {
          const pct = Math.round((Math.abs(p.amountMinor) / max) * 100);
          const negative = p.amountMinor < 0;
          return (
            <div key={p.month} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 52,
                  flexShrink: 0,
                  fontSize: 12,
                  color: 'var(--gt-text-dim)',
                }}
              >
                {monthLabel(p.month)}
              </div>
              <div
                style={{
                  flex: 1,
                  height: 8,
                  borderRadius: 999,
                  background: 'var(--gt-border)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    borderRadius: 999,
                    background: negative ? 'rgba(255,107,96,0.6)' : 'rgba(217,178,90,0.65)',
                  }}
                />
              </div>
              <div
                className="gt-numeric"
                style={{
                  width: 96,
                  textAlign: 'right',
                  flexShrink: 0,
                  fontSize: 13,
                  color: negative ? 'var(--gt-danger)' : 'var(--gt-text)',
                }}
              >
                {formatMoney(currency, p.amountMinor)}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Splits the month buckets into one bar panel per observed currency. */
export function RevenueByMonth({
  revenueByMonth,
  currencies,
}: {
  revenueByMonth: RevenueMonth[];
  currencies: string[];
}) {
  if (currencies.length === 0) {
    return (
      <Card>
        <div style={{ padding: 8, color: 'var(--gt-text-dim)', fontSize: 14 }}>
          No approved payments in the last 12 months yet.
        </div>
      </Card>
    );
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
        gap: 16,
        alignItems: 'start',
      }}
    >
      {currencies.map((currency) => (
        <RevenueSeries
          key={currency}
          currency={currency}
          points={revenueByMonth.map((m) => ({
            month: m.month,
            amountMinor: m.totals.find((t) => t.currency === currency)?.amountMinor ?? 0,
          }))}
        />
      ))}
    </div>
  );
}

const TIER_BAR: Record<string, string> = {
  starter: 'rgba(154,157,163,0.45)',
  silver: 'rgba(199,203,209,0.55)',
  gold: 'rgba(217,178,90,0.65)',
  elite: 'rgba(201,160,232,0.65)',
};

/** Effective-tier snapshot as proportional bars (matches the overview idiom). */
export function TierSnapshot({ rows }: { rows: TierCount[] }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <Card padded={false}>
      <CardHeader title="Members by tier" />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rows.map((r) => {
          const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
          return (
            <div key={r.tier} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 64,
                  flexShrink: 0,
                  fontSize: 13,
                  textTransform: 'capitalize',
                  color: 'var(--gt-text)',
                }}
              >
                {r.tier}
              </div>
              <div
                style={{
                  flex: 1,
                  height: 8,
                  borderRadius: 999,
                  background: 'var(--gt-border)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    borderRadius: 999,
                    background: TIER_BAR[r.tier] ?? 'var(--gt-text-dim)',
                  }}
                />
              </div>
              <div
                className="gt-numeric"
                style={{
                  width: 64,
                  textAlign: 'right',
                  flexShrink: 0,
                  fontSize: 14,
                  color: 'var(--gt-text)',
                }}
              >
                {r.count}
                <span style={{ color: 'var(--gt-text-dim)', fontSize: 12, marginLeft: 6 }}>
                  {pct}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Top countries by member count as proportional bars. */
export function CountrySnapshot({ rows }: { rows: CountryCount[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card padded={false}>
      <CardHeader title="Members by country" />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.length === 0 ? (
          <div style={{ color: 'var(--gt-text-dim)', fontSize: 14 }}>No members yet.</div>
        ) : (
          rows.map((r) => {
            const pct = Math.round((r.count / max) * 100);
            return (
              <div
                key={r.country ?? 'unknown'}
                style={{ display: 'flex', alignItems: 'center', gap: 12 }}
              >
                <div
                  style={{
                    width: 72,
                    flexShrink: 0,
                    fontSize: 13,
                    color: r.country ? 'var(--gt-text)' : 'var(--gt-text-dim)',
                  }}
                >
                  {r.country ?? 'Unknown'}
                </div>
                <div
                  style={{
                    flex: 1,
                    height: 8,
                    borderRadius: 999,
                    background: 'var(--gt-border)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      borderRadius: 999,
                      background: 'rgba(122,162,247,0.55)',
                    }}
                  />
                </div>
                <div
                  className="gt-numeric"
                  style={{
                    width: 48,
                    textAlign: 'right',
                    flexShrink: 0,
                    fontSize: 14,
                    color: 'var(--gt-text)',
                  }}
                >
                  {r.count}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

const PROMO_COLUMNS: Column<PromoPerformance>[] = [
  {
    key: 'code',
    header: 'Code',
    render: (r) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span className="gt-numeric" style={{ fontWeight: 500 }}>
          {r.code}
          {!r.active ? (
            <span style={{ color: 'var(--gt-text-dim)', fontSize: 12, marginLeft: 8 }}>
              inactive
            </span>
          ) : null}
        </span>
        <span
          style={{
            fontSize: 12,
            color: 'var(--gt-text-dim)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 220,
          }}
        >
          {r.ownerName ?? 'House code'} · {r.commissionPct}% commission
        </span>
      </div>
    ),
  },
  {
    key: 'redemptions',
    header: 'Redemptions',
    align: 'right',
    render: (r) => <span className="gt-numeric">{r.redemptions.toLocaleString()}</span>,
  },
  {
    key: 'settlements',
    header: 'Settled',
    align: 'right',
    render: (r) => <span className="gt-numeric">{r.settlements.toLocaleString()}</span>,
  },
  {
    key: 'commission',
    header: 'Commission paid',
    align: 'right',
    render: (r) => <span className="gt-numeric">{formatMoneyList(r.commission)}</span>,
  },
];

export function PromoTable({ rows }: { rows: PromoPerformance[] }) {
  return (
    <DataTable
      columns={PROMO_COLUMNS}
      rows={rows}
      rowKey={(r) => r.codeId}
      empty="No promo codes yet."
    />
  );
}

const COACH_TIER_LABEL: Record<string, string> = {
  silver: 'Silver',
  gold: 'Gold',
  elite: 'Elite',
};

const COACH_COLUMNS: Column<CoachPerformance>[] = [
  {
    key: 'coach',
    header: 'Coach',
    render: (r) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 220,
          }}
        >
          {r.displayName}
        </span>
        <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          {COACH_TIER_LABEL[r.coachTier] ?? r.coachTier}
        </span>
      </div>
    ),
  },
  {
    key: 'clients',
    header: 'Active clients',
    align: 'right',
    render: (r) => <span className="gt-numeric">{r.activeClients.toLocaleString()}</span>,
  },
  {
    key: 'milestones',
    header: 'Milestones',
    align: 'right',
    render: (r) => <span className="gt-numeric">{r.totalMilestones.toLocaleString()}</span>,
  },
  {
    key: 'earned',
    header: 'Wallet earned',
    align: 'right',
    render: (r) => <span className="gt-numeric">{formatMoneyList(r.walletEarned)}</span>,
  },
];

export function CoachTable({ rows }: { rows: CoachPerformance[] }) {
  return (
    <DataTable
      columns={COACH_COLUMNS}
      rows={rows}
      rowKey={(r) => r.coachId}
      empty="No coaches yet."
    />
  );
}

/** Small section heading matching the overview page idiom. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: 'var(--font-heading)',
        fontWeight: 600,
        fontSize: 15,
        letterSpacing: '0.02em',
        color: 'var(--gt-text)',
        marginBottom: 12,
      }}
    >
      {children}
    </h2>
  );
}
