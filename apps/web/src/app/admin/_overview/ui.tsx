import { Card, CardHeader, TierChip } from '@/components/console';
import type { Tier } from './data';

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
