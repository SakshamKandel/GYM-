import type { ReactNode } from 'react';

/**
 * Pill chip for tiers and statuses. Two families:
 *  - TIER: starter | silver | gold | elite — a subtle metallic tint per tier.
 *  - STATUS: active | suspended | ended | live | pending — semantic color.
 * The --gt-red accent is deliberately NOT used here; a red chip would fight the
 * one-red rule, so 'suspended' uses a warm orange-red tint rather than the
 * signal red. Pass `tone` directly for anything outside these, or `children`
 * for custom text with a preset variant.
 */

type Tier = 'starter' | 'silver' | 'gold' | 'elite';
type Status = 'active' | 'suspended' | 'ended' | 'live' | 'pending';
type Tone = 'neutral' | 'positive' | 'warning' | 'critical' | 'info';

const TONE_STYLES: Record<Tone, { fg: string; bg: string; border: string }> = {
  neutral: { fg: 'var(--gt-text-dim)', bg: 'transparent', border: 'var(--gt-border)' },
  positive: { fg: '#4cc264', bg: 'rgba(63,185,80,0.10)', border: 'rgba(63,185,80,0.30)' },
  warning: { fg: '#e0a34a', bg: 'rgba(224,163,74,0.10)', border: 'rgba(224,163,74,0.30)' },
  critical: { fg: '#ff8178', bg: 'rgba(255,107,96,0.10)', border: 'rgba(255,107,96,0.30)' },
  info: { fg: '#7aa2d6', bg: 'rgba(122,162,214,0.10)', border: 'rgba(122,162,214,0.30)' },
};

const TIER_STYLES: Record<Tier, { fg: string; bg: string; border: string }> = {
  starter: { fg: '#9a9da3', bg: 'transparent', border: 'var(--gt-border)' },
  silver: { fg: '#c7cbd1', bg: 'rgba(199,203,209,0.08)', border: 'rgba(199,203,209,0.22)' },
  gold: { fg: '#d9b25a', bg: 'rgba(217,178,90,0.10)', border: 'rgba(217,178,90,0.28)' },
  elite: { fg: '#c9a0e8', bg: 'rgba(201,160,232,0.10)', border: 'rgba(201,160,232,0.28)' },
};

const STATUS_TONE: Record<Status, Tone> = {
  active: 'positive',
  suspended: 'critical',
  ended: 'neutral',
  live: 'positive',
  pending: 'warning',
};

function Pill({
  fg,
  bg,
  border,
  children,
}: {
  fg: string;
  bg: string;
  border: string;
  children: ReactNode;
}) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        border: `1px solid ${border}`,
        background: bg,
        color: fg,
        fontFamily: 'var(--font-numeric)',
        fontSize: 12,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        lineHeight: 1.6,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  const s = TONE_STYLES[tone];
  return <Pill {...s}>{children}</Pill>;
}

/** Membership tier chip with a per-tier metallic tint. */
export function TierChip({ tier }: { tier: Tier }) {
  const s = TIER_STYLES[tier];
  return <Pill {...s}>{tier}</Pill>;
}

/** Account / assignment / content status chip mapped to a semantic tone. */
export function StatusChip({
  status,
  label,
}: {
  status: Status;
  label?: string;
}) {
  const s = TONE_STYLES[STATUS_TONE[status]];
  return <Pill {...s}>{label ?? status}</Pill>;
}
