import Link from 'next/link';
import { Card, CardHeader, TierChip } from '@/components/console';
import type { ChartPoint } from '@/components/console/ChartCard';
import type { HeatRow } from '@/components/console/HeatGrid';
import type { OpsQueue, SignupDayCount, Tier } from './data';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Slices the last 14 days of `dailySignups28` into ChartCard points. */
export function buildSignupTrend(daily: SignupDayCount[]): ChartPoint[] {
  return daily.slice(-14).map((d) => ({
    label: new Date(`${d.date}T00:00:00Z`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }),
    value: d.count,
  }));
}

/**
 * Buckets `dailySignups28` into real Sun–Sat weekly rows × 7 weekday columns
 * for HeatGrid (calendar-aligned, not just "every 7 entries" — a day's actual
 * weekday always lands under its matching column).
 */
export function buildSignupHeatmap(daily: SignupDayCount[]): HeatRow[] {
  const byWeekStart = new Map<string, number[]>();
  for (const d of daily) {
    const date = new Date(`${d.date}T00:00:00Z`);
    const dow = date.getUTCDay(); // 0=Sun..6=Sat
    const weekStart = new Date(date);
    weekStart.setUTCDate(weekStart.getUTCDate() - dow);
    const key = weekStart.toISOString().slice(0, 10);
    const row = byWeekStart.get(key) ?? new Array(7).fill(0);
    row[dow] = d.count;
    byWeekStart.set(key, row);
  }
  const weekStarts = Array.from(byWeekStart.keys()).sort();
  return weekStarts.map((key, i) => ({
    label:
      i === weekStarts.length - 1
        ? 'This wk'
        : new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
          }),
    values: byWeekStart.get(key) ?? new Array(7).fill(0),
  }));
}

export { WEEKDAY_LABELS };

/** Formats a past Date as a compact relative label ("3m ago", "2h ago"). */
export function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

/** Formats minor-unit sums per currency into a compact "NPR 12,300 · USD 45" line. */
function formatRevenue(rows: { currency: string; amountMinor: number }[]): string {
  if (rows.length === 0) return '—';
  return rows
    .map((r) => `${r.currency} ${Math.round(r.amountMinor / 100).toLocaleString()}`)
    .join(' · ');
}

/**
 * Pending-work tiles (P0-6). Each tile links to the queue that resolves it and
 * only renders when the caller holds the permission (its value is non-null —
 * the loader never even queries a section the caller can't see, A3). A tile with
 * outstanding work gets a subtle accent so the operator sees the queue at a
 * glance. Returns null when the caller has no ops permissions at all.
 */
export function OpsTiles({ ops }: { ops: OpsQueue }) {
  const tiles: { href: string; label: string; value: number; hint?: string }[] = [];
  if (ops.pendingApplications != null) {
    tiles.push({
      href: '/admin/applications',
      label: 'Coach applications',
      value: ops.pendingApplications,
      hint: 'pending review',
    });
  }
  if (ops.pendingTierRequests != null) {
    tiles.push({
      href: '/admin/coaches',
      label: 'Tier requests',
      value: ops.pendingTierRequests,
      hint: 'pending review',
    });
  }
  if (ops.pendingPayments != null) {
    tiles.push({
      href: '/admin/payments',
      label: 'Payment requests',
      value: ops.pendingPayments,
      hint: 'awaiting approval',
    });
  }
  if (ops.unreadSupport != null) {
    tiles.push({
      href: '/admin/support',
      label: 'Support threads',
      value: ops.unreadSupport,
      hint: 'unread',
    });
  }

  const showRevenue = ops.revenueThisMonth != null;
  if (tiles.length === 0 && !showRevenue) return null;

  return (
    <section style={{ marginBottom: 24 }}>
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
        Needs attention
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        {tiles.map((t) => {
          const active = t.value > 0;
          return (
            <Link
              key={t.href + t.label}
              href={t.href}
              className="gt-card"
              style={{
                padding: 18,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                textDecoration: 'none',
                color: 'inherit',
                border: active ? '1px solid var(--gt-red)' : undefined,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: 'var(--gt-text-dim)',
                  fontFamily: 'var(--font-heading)',
                }}
              >
                {t.label}
              </span>
              <span
                className="gt-numeric"
                style={{
                  fontSize: 34,
                  lineHeight: 1,
                  color: active ? 'var(--gt-text)' : 'var(--gt-text-dim)',
                }}
              >
                {t.value.toLocaleString()}
              </span>
              <span style={{ fontSize: 12, color: 'var(--gt-text-dim)', minHeight: 16 }}>
                {t.hint}
              </span>
            </Link>
          );
        })}
        {showRevenue ? (
          <div
            className="gt-card"
            style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <span
              style={{
                fontSize: 12,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--gt-text-dim)',
                fontFamily: 'var(--font-heading)',
              }}
            >
              Revenue this month
            </span>
            <span
              className="gt-numeric"
              style={{ fontSize: 22, lineHeight: 1.2, color: 'var(--gt-text)' }}
            >
              {formatRevenue(ops.revenueThisMonth ?? [])}
            </span>
            <span style={{ fontSize: 12, color: 'var(--gt-text-dim)', minHeight: 16 }}>
              approved payments
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Horizontal tier distribution: a chip per tier with its count and a thin
 * proportional bar. The bar uses the same subtle per-tier tint as the chip
 * (no accent red — that stays reserved for primary actions).
 */
const TIER_BAR: Record<Tier, string> = {
  starter: 'rgba(154,157,163,0.45)',
  silver: 'rgba(199,203,209,0.55)',
  gold: 'rgba(217,178,90,0.65)',
  elite: 'rgba(201,160,232,0.65)',
};

export function TierBreakdown({
  rows,
}: {
  rows: { tier: Tier; count: number }[];
}) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return (
    <Card padded={false}>
      <CardHeader title="Members by tier" />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rows.map((r) => {
          const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
          return (
            <div
              key={r.tier}
              style={{ display: 'flex', alignItems: 'center', gap: 12 }}
            >
              <div style={{ width: 72, flexShrink: 0 }}>
                <TierChip tier={r.tier} />
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
                    background: TIER_BAR[r.tier],
                    borderRadius: 999,
                  }}
                />
              </div>
              <div
                className="gt-numeric"
                style={{
                  width: 56,
                  textAlign: 'right',
                  flexShrink: 0,
                  fontSize: 14,
                  color: 'var(--gt-text)',
                }}
              >
                {r.count}
                <span
                  style={{ color: 'var(--gt-text-dim)', fontSize: 12, marginLeft: 6 }}
                >
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
