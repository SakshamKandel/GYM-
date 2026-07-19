import type { Tier } from '@gym/shared';

/**
 * Per-tier metal-finish metadata for the premium subscription surfaces
 * (paywall TierCard + TierDetailSheet identity band). Static data only —
 * colors stay in `cardMetals` (ui-tokens); this module carries the engraved
 * material callouts and the per-tier subtlety of the animated sheen sweep.
 */

export interface MetalFinish {
  /** Engraved material callout shown under the issuer brand (caps). */
  label: string;
  /** Peak opacity of the traveling sheen band on this tier's face (0..1). */
  sheenPeak: number;
}

export const METAL_FINISH: Record<Tier, MetalFinish> = {
  starter: { label: 'BRUSHED GRAPHITE', sheenPeak: 0.1 },
  silver: { label: 'STERLING SILVER', sheenPeak: 0.16 },
  gold: { label: '24K GOLD', sheenPeak: 0.22 },
  elite: { label: 'NOIR ELITE', sheenPeak: 0.18 },
};
