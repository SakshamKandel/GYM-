import type { Tier } from '@gym/shared';
import Svg, { Defs, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { BADGE_STOP_OFFSETS, TIER_PALETTE, type MetallicTier } from './tierPalette';

/**
 * Subscription-tier identity emblem — a small metallic shield rendered from a
 * static SVG gradient (no filters, no animation, no drop-shadow). This is the
 * ONLY glossy element in the app besides the rank ring (RankEmblem) and the
 * avatar tier frame (TierAvatarFrame); earned achievement badges stay flat
 * red/charcoal on purpose — the metallic treatment is exclusive to paid-tier
 * identity so it reads as scarce.
 *
 * Pure identity, not gamification: renders regardless of the "hide
 * gamification" toggle, and carries no XP/rank/leaderboard effect anywhere
 * (design law — see CONTRACT). `starter` (free) renders nothing.
 *
 * Palette lives in ./tierPalette.ts (shared with TierAvatarFrame); the web
 * console TierBadge mirrors the same stop values by hand.
 */

export type BadgeTier = MetallicTier;

interface Props {
  tier: Tier;
  /** Height in px; width is derived from the shield's 24:28 aspect ratio. Default 16. */
  size?: number;
}

const TIER_LABEL: Record<BadgeTier, string> = {
  silver: 'Silver',
  gold: 'Gold',
  elite: 'Elite',
};

const TIER_INITIAL: Record<BadgeTier, string> = {
  silver: 'S',
  gold: 'G',
  elite: 'E',
};

const SHIELD_PATH = 'M12 1 L22 5 V14 C22 21 17.5 25.5 12 27 C6.5 25.5 2 21 2 14 V5 Z';
const HIGHLIGHT_PATH = 'M5 5.5 L12 2.8 L19 5.5';
const VIEW_W = 24;
const VIEW_H = 28;

export function TierBadge({ tier, size = 16 }: Props) {
  if (tier === 'starter') return null;

  const palette = TIER_PALETTE[tier];
  const height = size;
  const width = (size * VIEW_W) / VIEW_H;
  const gradientId = `tierShield-${tier}`;
  // Fixed fraction of the viewBox height, NOT the px size prop — keeps the
  // glyph's proportion of the shield constant no matter what size is passed.
  const fontSize = VIEW_H * 0.42;
  // Strokes are specified in viewBox units, so a constant width thins out and
  // aliases as the badge shrinks. Scale so the edge renders ~1 device point
  // at any size (16 → 1.75 units, 20 → 1.4, 28 → 1).
  const edgeWidth = Math.max(1, VIEW_H / size);
  const highlightWidth = edgeWidth * 0.85;

  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      accessibilityLabel={`${TIER_LABEL[tier]} member`}
    >
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          {palette.stops.map((color, i) => (
            <Stop key={BADGE_STOP_OFFSETS[i]} offset={BADGE_STOP_OFFSETS[i]} stopColor={color} />
          ))}
        </LinearGradient>
      </Defs>
      <Path
        d={SHIELD_PATH}
        fill={`url(#${gradientId})`}
        stroke={palette.border}
        strokeWidth={edgeWidth}
      />
      <Path
        d={HIGHLIGHT_PATH}
        fill="none"
        stroke={palette.highlight}
        strokeWidth={highlightWidth}
        strokeOpacity={0.9}
        strokeLinecap="round"
      />
      <SvgText
        x={VIEW_W / 2}
        y={VIEW_H / 2 + fontSize * 0.35}
        fontSize={fontSize}
        fontWeight="700"
        fill={palette.glyph}
        textAnchor="middle"
      >
        {TIER_INITIAL[tier]}
      </SvgText>
    </Svg>
  );
}
