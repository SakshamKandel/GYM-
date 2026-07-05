/**
 * Subscription-tier shield — pure membership identity, rendered wherever a
 * coach needs to see "is this person a paying member" at a glance. This is
 * NOT a gamification surface: it never reflects XP, rank, or leaderboard
 * position (design law — see CLAUDE.md rule 5 / packages/shared entitlements).
 *
 * Flat everywhere else in the console (TierChip in ./Badge.tsx stays as the
 * text pill); this is the one deliberately metallic exception — a subtle
 * vertical sheen via SVG linearGradient plus a thin highlight arc. No
 * filters, no animation, no drop-shadow. `starter` renders nothing (free
 * tier has no shield).
 *
 * Stop values mirror the mobile source of truth
 * (apps/mobile/src/components/ui/tierPalette.ts) — keep them in sync.
 *
 * Plain inline-SVG, no hooks — safe to render from a server component.
 */

type Tier = 'starter' | 'silver' | 'gold' | 'elite';

interface ShieldSpec {
  label: string;
  glyph: string;
  /** Vertical gradient stops at offsets 0% / 45% / 62% / 100% (top-lit). */
  stops: readonly [string, string, string, string];
  border: string;
  highlight: string;
  /** Glyph fill — tuned for legibility at 16px. */
  glyphFill: string;
}

const STOP_OFFSETS = ['0%', '45%', '62%', '100%'] as const;

const SHIELD_SPEC: Record<Exclude<Tier, 'starter'>, ShieldSpec> = {
  silver: {
    label: 'Silver',
    glyph: 'S',
    stops: ['#F0F2F5', '#B9BEC6', '#8F949C', '#6B7078'],
    border: '#565B63',
    highlight: '#F7F9FB',
    glyphFill: '#454A52',
  },
  gold: {
    label: 'Gold',
    glyph: 'G',
    stops: ['#F7DF9B', '#DDB55E', '#BE9440', '#9C742C'],
    border: '#8A6A2B',
    highlight: '#FBEBBB',
    glyphFill: '#7A5C22',
  },
  elite: {
    label: 'Elite',
    glyph: 'E',
    stops: ['#B02A21', '#5A1713', '#331211', '#180B0A'],
    border: '#D9B25A', // gold edge — Elite's one distinguishing accent
    highlight: '#E8C878',
    glyphFill: '#E8C878', // gold glyph to match the edge; legible on the dark field
  },
};

/** Height in px; width follows the 24:28 shield aspect ratio. */
export function TierBadge({ tier, size = 16 }: { tier: Tier; size?: number }) {
  if (tier === 'starter') return null;
  const spec = SHIELD_SPEC[tier];
  const width = (size * 24) / 28;
  const gradientId = `gt-tier-shield-${tier}`;
  // Strokes are in viewBox units; scale so the edge renders ~1 CSS px at any
  // size (16 → 1.75 units, 20 → 1.4, 28 → 1) instead of aliasing away.
  const edgeWidth = Math.max(1, 28 / size);
  const highlightWidth = edgeWidth * 0.85;

  return (
    <svg
      width={width}
      height={size}
      viewBox="0 0 24 28"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`${spec.label} member`}
      style={{ flexShrink: 0, display: 'inline-block' }}
    >
      <title>{`${spec.label} member`}</title>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          {spec.stops.map((color, i) => (
            <stop key={STOP_OFFSETS[i]} offset={STOP_OFFSETS[i]} stopColor={color} />
          ))}
        </linearGradient>
      </defs>
      <path
        d="M12 1 L22 5 V14 C22 21 17.5 25.5 12 27 C6.5 25.5 2 21 2 14 V5 Z"
        fill={`url(#${gradientId})`}
        stroke={spec.border}
        strokeWidth={edgeWidth}
      />
      <path
        d="M5 5.5 L12 2.8 L19 5.5"
        fill="none"
        stroke={spec.highlight}
        strokeWidth={highlightWidth}
        strokeOpacity={0.9}
        strokeLinecap="round"
      />
      <text
        x="12"
        y="17.5"
        textAnchor="middle"
        fontSize={28 * 0.42}
        fontWeight={700}
        fill={spec.glyphFill}
        fontFamily="var(--font-heading, sans-serif)"
      >
        {spec.glyph}
      </text>
    </svg>
  );
}
