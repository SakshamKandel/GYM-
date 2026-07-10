import type { Rank } from '@gym/shared';

/**
 * Shared metallic ramps for EARNED progression surfaces — rank emblems and
 * achievement medals. Top-lit 4-stop verticals, static SVG gradients only
 * (design law: no glow, no filters, no animation). Kept clearly apart from
 * tierPalette.ts: paid-tier identity has its own finishes and silhouettes and
 * must never share these ramps.
 */

export const METAL_STOP_OFFSETS = ['0%', '40%', '62%', '100%'] as const;

export type MetalRamp = readonly [string, string, string, string];

/** Rank metals — bronze/silver/gold, topping out at the accent-red elite. */
export const METAL_RAMP: Record<Rank, MetalRamp> = {
  bronze: ['#EBBA85', '#CE9255', '#A96F36', '#7C5124'],
  silver: ['#D4D8DE', '#A6ABB3', '#84898F', '#62676F'],
  gold: ['#F3D783', '#E3BE55', '#B8913A', '#96742B'],
  elite: ['#FF7A6E', '#F5453A', '#C22D24', '#8F211B'],
};

/**
 * Earned finish for non-tiered achievement medals — the brand red as enamel,
 * accent-centered and a touch flatter than the elite metal so a 4-rung
 * ladder's elite top rung still reads as the rarer finish.
 */
export const EARNED_RED_RAMP: MetalRamp = ['#FF5A4E', '#FF3B30', '#D93227', '#A3241C'];

/** The app's established verified/elite gold — laurel + coach-verified marks. */
export const VERIFIED_GOLD = '#D9B25A';

/**
 * Flat medal-disc fills for leaderboard positions 1–3 — same metal family as
 * METAL_RAMP, flattened to single fills for 28px discs (flat fills only on
 * the boards: no gradients, no glow).
 */
export const MEDAL_DISC = {
  gold: '#E0B84A',
  silver: '#9BA0A8',
  bronze: '#C58A4A',
} as const;
