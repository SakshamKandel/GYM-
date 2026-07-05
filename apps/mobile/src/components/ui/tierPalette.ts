import type { Tier } from '@gym/shared';

/**
 * Subscription-tier metallic palettes — the single source of truth for every
 * tier-identity finish in the mobile app (TierBadge shield + TierAvatarFrame
 * ring). Static gradient stops only: no filters, no animation, no glow
 * (design law). The web console TierBadge mirrors the badge values by hand
 * (apps/web/src/components/console/TierBadge.tsx) — keep them in sync.
 *
 * Light direction is consistent everywhere: lit from the top (y1=0 → y2=1),
 * brightest stop first, darkest last, with one subtle re-lift band near the
 * bottom of the 5-stop frame gradients to suggest a brushed reflection.
 */

export type MetallicTier = Exclude<Tier, 'starter'>;

/** Shield-badge finish (TierBadge, mobile + web mirror). */
export interface TierBadgePalette {
  /** Vertical gradient stops at offsets 0% / 45% / 62% / 100%. */
  stops: readonly [string, string, string, string];
  /** 1px outer edge stroke. */
  border: string;
  /** Fine top highlight arc. */
  highlight: string;
  /** Tier-initial glyph fill — tuned for legibility at 16px. */
  glyph: string;
}

/** Offsets paired with `TierBadgePalette.stops`. */
export const BADGE_STOP_OFFSETS = ['0%', '45%', '62%', '100%'] as const;

export const TIER_PALETTE: Record<MetallicTier, TierBadgePalette> = {
  silver: {
    stops: ['#F0F2F5', '#B9BEC6', '#8F949C', '#6B7078'],
    border: '#565B63',
    highlight: '#F7F9FB',
    glyph: '#454A52',
  },
  gold: {
    stops: ['#F7DF9B', '#DDB55E', '#BE9440', '#9C742C'],
    border: '#8A6A2B',
    highlight: '#FBEBBB',
    glyph: '#7A5C22',
  },
  elite: {
    stops: ['#B02A21', '#5A1713', '#331211', '#180B0A'],
    border: '#D9B25A', // gold edge — Elite's distinguishing mark
    highlight: '#E8C878',
    glyph: '#E8C878', // gold glyph to match the edge; legible on the dark field
  },
};

/** Avatar-frame finish (TierAvatarFrame) — deeper 5-stop brushed gradient. */
export interface TierFramePalette {
  /** Vertical gradient stops at offsets 0% / 30% / 55% / 76% / 100%. */
  stops: readonly [string, string, string, string, string];
  /** 1px outer edge circle. */
  edge: string;
  /** Hairline highlight on the ring's inner rim. */
  innerHighlight: string;
}

/** Offsets paired with `TierFramePalette.stops`. */
export const FRAME_STOP_OFFSETS = ['0%', '30%', '55%', '76%', '100%'] as const;

export const TIER_FRAME: Record<MetallicTier, TierFramePalette> = {
  // Brushed silver — cool, high-key, crisp.
  silver: {
    stops: ['#F2F4F6', '#C9CED5', '#9AA0A8', '#B4B9C1', '#71767E'],
    edge: '#565B63',
    innerHighlight: '#F7F9FB',
  },
  // Warm gold — soft top light, honeyed mid, bronze base.
  gold: {
    stops: ['#F9E3A5', '#E3C06A', '#C79B3F', '#D9B25A', '#97702A'],
    edge: '#8A6A2B',
    innerHighlight: '#FBEBBB',
  },
  // Elite — deep red-black lacquer with a fine gold edge (Elite's mark).
  elite: {
    stops: ['#8E211B', '#4A1310', '#26100E', '#3A1210', '#140A09'],
    edge: '#D9B25A',
    innerHighlight: '#E8C878',
  },
};

// ── Luxury-island accents (AnimatedTierRing + VipCard ONLY) ────────────────
// Glow/sheen are the one sanctioned exception to the no-glow law, and they
// live exclusively on the premium surfaces (settings VIP card + home
// greeting avatar). Everything below is STATIC color data — the animation
// itself lives in AnimatedTierRing (native only).

/** Soft halo color behind the animated ring — a mid-tone of the tier metal. */
export const TIER_GLOW: Record<MetallicTier, string> = {
  silver: '#C9CED5',
  gold: '#E3C06A',
  elite: '#B02A21',
};

/** Traveling sheen-arc color for the animated ring's slow sweep. */
export const TIER_SHEEN: Record<MetallicTier, string> = {
  silver: 'rgba(255,255,255,0.55)',
  gold: 'rgba(251,235,187,0.55)',
  elite: 'rgba(232,200,120,0.50)',
};

/** VIP membership-card finish (VipCard) — dark luxury base per tier. */
export interface VipCardPalette {
  /** Card base fill (top of the vertical sheen gradient's darker end). */
  base: string;
  /** Slightly lifted tone the base gradient rises to — a soft top light. */
  baseSheen: string;
  /** Diagonal light-streak stroke color (drawn at 5–8% opacity). */
  streak: string;
  /** Tiny static 4-point sparkle fill. */
  sparkle: string;
  /** 1.5px metallic edge border. */
  border: string;
}

export const VIP_CARD: Record<Tier, VipCardPalette> = {
  // Starter — plain charcoal, deliberately quiet: the frame is the pitch.
  starter: { base: '#1B1D20', baseSheen: '#232629', streak: '#3A3E44', sparkle: '#3A3E44', border: '#33363B' },
  // Graphite with brushed-silver accents.
  silver: { base: '#17191D', baseSheen: '#24272C', streak: '#C9CED5', sparkle: '#F2F4F6', border: '#8F949C' },
  // Black-gold — the "King VIP" mood.
  gold: { base: '#131110', baseSheen: '#201A11', streak: '#D9B25A', sparkle: '#F7DF9B', border: '#8A6A2B' },
  // Deep red-black lacquer with fine gold accents.
  elite: { base: '#150B0A', baseSheen: '#26100E', streak: '#D9B25A', sparkle: '#E8C878', border: '#D9B25A' },
};
