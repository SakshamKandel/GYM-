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

// Tones read from the semantic status tokens (fg + weak wash) so a theme flip
// recolours every badge with zero edits. Borders derive from the fg via
// color-mix, keeping the outline in-family without a second hardcoded value.
const TONE_STYLES: Record<Tone, { fg: string; bg: string; border: string }> = {
  neutral: {
    fg: 'var(--gt-text-dim)',
    bg: 'transparent',
    border: 'var(--gt-border-strong)',
  },
  positive: {
    fg: 'var(--gt-success)',
    bg: 'var(--gt-success-weak)',
    border: 'color-mix(in srgb, var(--gt-success) 32%, transparent)',
  },
  warning: {
    fg: 'var(--gt-warning)',
    bg: 'var(--gt-warning-weak)',
    border: 'color-mix(in srgb, var(--gt-warning) 32%, transparent)',
  },
  critical: {
    fg: 'var(--gt-danger)',
    bg: 'var(--gt-danger-weak)',
    border: 'color-mix(in srgb, var(--gt-danger) 32%, transparent)',
  },
  info: {
    fg: 'var(--gt-info)',
    bg: 'var(--gt-info-weak)',
    border: 'color-mix(in srgb, var(--gt-info) 32%, transparent)',
  },
};

// Membership-tier tints — legible on the light surface (AA fg on white). These
// are decorative brand tints, not semantic status, so they stay bespoke but are
// tuned for the light theme rather than the old charcoal one.
const TIER_STYLES: Record<Tier, { fg: string; bg: string; border: string }> = {
  starter: { fg: 'var(--gt-text-dim)', bg: 'transparent', border: 'var(--gt-border-strong)' },
  silver: { fg: '#5a6270', bg: '#f1f2f4', border: '#dadde2' },
  gold: { fg: '#8a6212', bg: '#fbf1dd', border: '#ebd9a8' },
  elite: { fg: '#6b3fa0', bg: '#f1e9fa', border: '#dfccf2' },
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
