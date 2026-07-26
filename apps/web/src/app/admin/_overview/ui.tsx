import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card, CardHeader, TierChip } from '@/components/console';
import type { ChartPoint } from '@/components/console/ChartCard';
import type { HeatRow } from '@/components/console/HeatGrid';
import { formatMoney } from '@/lib/format';
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

/**
 * The one band heading on this page. Every block used to hand-roll its own h2
 * at a slightly different size, so the page read as a pile of cards rather than
 * three ranked answers: what needs doing, what is moving, what the platform
 * looks like. `hint` carries the one-line answer for the band, so an operator
 * can stop reading at the heading when nothing is wrong.
 */
export function SectionTitle({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2
          style={{
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            fontSize: 'var(--gt-fs-h2)',
            letterSpacing: '0.01em',
            color: 'var(--gt-text)',
          }}
        >
          {title}
        </h2>
        {hint ? (
          <span style={{ fontSize: 'var(--gt-fs-meta)', color: 'var(--gt-text-dim)' }}>
            {hint}
          </span>
        ) : null}
      </div>
      {action ?? null}
    </div>
  );
}

/**
 * Pending-work tiles (P0-6). Each tile links to the queue that resolves it and
 * only renders when the caller holds the permission (its value is non-null —
 * the loader never even queries a section the caller can't see, A3). Returns
 * null when the caller has no ops permissions at all.
 *
 * Queues with work sort to the front and keep full-strength ink, a firmer
 * border and a status dot; a queue at zero drops to the faint ink and says so.
 * Before this every tile looked identical whether it held nine receipts or
 * none, so the one question this page exists to answer — is anything waiting —
 * took a read of five numbers instead of a glance. The accent is deliberately
 * NOT spent here: it belongs to the single most important thing on screen, and
 * five outlined tiles would mean five of those.
 */
export function OpsTiles({ ops }: { ops: OpsQueue }) {
  const tiles: { href: string; label: string; value: number; hint: string }[] = [];
  if (ops.pendingApplications != null) {
    tiles.push({
      href: '/admin/applications',
      label: 'Coach applications',
      value: ops.pendingApplications,
      hint: 'waiting to be reviewed',
    });
  }
  if (ops.pendingTierRequests != null) {
    tiles.push({
      href: '/admin/coaches',
      label: 'Tier requests',
      value: ops.pendingTierRequests,
      hint: 'waiting to be reviewed',
    });
  }
  if (ops.pendingPayments != null) {
    tiles.push({
      href: '/admin/payments',
      label: 'Membership payments',
      value: ops.pendingPayments,
      hint: 'receipts to approve',
    });
  }
  if (ops.pendingMealPayments != null) {
    tiles.push({
      href: '/admin/meal-payments',
      label: 'Meal payments',
      value: ops.pendingMealPayments,
      hint: 'receipts to approve',
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

  if (tiles.length === 0) return null;

  // Work first, quiet queues after. Array#sort is stable, so tiles keep their
  // declared order inside each group.
  const ordered = [...tiles].sort((a, b) => Number(b.value > 0) - Number(a.value > 0));
  const waiting = tiles.filter((t) => t.value > 0).length;

  return (
    <section style={{ marginBottom: 24 }}>
      <SectionTitle
        title="Needs attention"
        hint={
          waiting === 0
            ? 'Nothing is waiting right now'
            : waiting === 1
              ? '1 queue has work waiting'
              : `${waiting} queues have work waiting`
        }
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        {ordered.map((t) => {
          const active = t.value > 0;
          return (
            <Link
              key={t.href + t.label}
              href={t.href}
              className="gt-card gt-inbox-row"
              style={{
                padding: 18,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                textDecoration: 'none',
                color: 'inherit',
                borderColor: active ? 'var(--gt-border-strong)' : undefined,
              }}
            >
              <span
                style={{
                  fontSize: 'var(--gt-fs-micro)',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: active ? 'var(--gt-text-dim)' : 'var(--gt-text-faint)',
                  fontFamily: 'var(--font-heading)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {/* Always rendered, transparent when the queue is clear, so the
                    labels across the row stay on one line. */}
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 'var(--gt-radius-pill)',
                    background: active ? 'var(--gt-warning)' : 'transparent',
                    flexShrink: 0,
                  }}
                />
                {t.label}
              </span>
              <span
                className="gt-numeric"
                style={{
                  fontSize: 'var(--gt-fs-display)',
                  lineHeight: 1,
                  color: active ? 'var(--gt-text)' : 'var(--gt-text-faint)',
                }}
              >
                {t.value.toLocaleString()}
              </span>
              <span
                style={{
                  fontSize: 'var(--gt-fs-micro)',
                  color: active ? 'var(--gt-text-dim)' : 'var(--gt-text-faint)',
                  minHeight: 16,
                }}
              >
                {active ? t.hint : 'Nothing waiting'}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Money taken this month, one line per currency.
 *
 * It used to sit in the "needs attention" grid dressed as a queue tile, so a
 * figure nobody can act on competed with five that need clearing. It also
 * rounded every currency to whole units by hand, which quietly dropped the
 * cents off every dollar amount. Same numbers, now through the console's one
 * money formatter, so each line carries its own currency.
 */
export function RevenueCard({
  rows,
}: {
  rows: { currency: string; amountMinor: number }[];
}) {
  return (
    <Card padded={false}>
      <CardHeader title="Money this month" />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.length === 0 ? (
          <span style={{ fontSize: 'var(--gt-fs-meta)', color: 'var(--gt-text-dim)' }}>
            Nothing has been taken yet this month.
          </span>
        ) : (
          // One line per currency, each carrying its own code or symbol —
          // never a single mixed total, which would be meaningless the day a
          // dollar payment lands beside a rupee one.
          rows.map((r) => (
            <div
              key={r.currency}
              className="gt-numeric"
              style={{
                fontSize: 'var(--gt-fs-h1)',
                lineHeight: 1.2,
                color: 'var(--gt-text)',
              }}
            >
              {formatMoney(r.amountMinor, r.currency)}
            </div>
          ))
        )}
        <span style={{ fontSize: 'var(--gt-fs-micro)', color: 'var(--gt-text-faint)' }}>
          Payments that went through, less refunds.
        </span>
      </div>
    </Card>
  );
}

/**
 * Horizontal tier distribution: a chip per tier with its count and a thin
 * proportional bar. The bar carries the same per-tier colour as the chip's ink
 * (no accent — that stays reserved for the primary action and the charts).
 *
 * These were translucent pale fills tuned for the old charcoal console. On the
 * light repaint they landed a shade or two off the #ececE6 track they sit in,
 * so the bars were there and could not be seen: an 80% starter share and a 4%
 * elite share looked the same. Solid, and matched to the tier chip beside them.
 */
const TIER_BAR: Record<Tier, string> = {
  starter: '#83888f',
  silver: '#5a6270',
  gold: '#a87d1c',
  elite: '#8257bd',
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
                  borderRadius: 'var(--gt-radius-pill)',
                  background: 'var(--gt-border)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: TIER_BAR[r.tier],
                    borderRadius: 'var(--gt-radius-pill)',
                  }}
                />
              </div>
              <div
                className="gt-numeric"
                style={{
                  width: 72,
                  textAlign: 'right',
                  flexShrink: 0,
                  fontSize: 'var(--gt-fs-meta)',
                  color: 'var(--gt-text)',
                }}
              >
                {r.count.toLocaleString()}
                <span
                  style={{
                    color: 'var(--gt-text-faint)',
                    fontSize: 'var(--gt-fs-micro)',
                    marginLeft: 6,
                  }}
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
