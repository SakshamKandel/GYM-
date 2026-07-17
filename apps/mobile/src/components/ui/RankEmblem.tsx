import { View } from 'react-native';
import type { Rank } from '@gym/shared';
import { colors, type } from '@gym/ui-tokens';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { AppText } from './AppText';
import { METAL_RAMP, METAL_STOP_OFFSETS } from './badges/achievementMetals';

/**
 * Earned rank emblem — a thin metallic gradient ring, normally wrapped
 * around the level number. Visually distinct from the tier surfaces on
 * purpose: rank is earned by training and stays separate from paid-tier
 * identity (design law — the two must never merge). TierBadge is a shield,
 * TierAvatarFrame is a filled band on the avatar; this is a fine 2.5px ring
 * beside the rank text. Same restrained gradient language (static SVG
 * linearGradient, top-lit, no filters/animation) as the tier pieces, but the
 * earned-progression sibling, not the subscription one.
 *
 * Omit `level` to render the ring alone (transparent center, no number) —
 * used on the public leaderboard where only the rank medal is shown.
 *
 * Lives in components/ui (not a feature module) because multiple features
 * render it — gamification's profile strip and engagement's public
 * leaderboard — and features must never import from each other.
 */

interface Props {
  rank: Rank;
  /** Omit for a ring-only emblem (no number, transparent center). */
  level?: number;
  size?: number;
}

// Top-lit 4-stop metals at offsets 0% / 40% / 62% / 100% — shared with the
// achievement medals (see achievementMetals.ts). Kept clearly apart from the
// TIER_FRAME finishes: rank silver is cooler/darker than the frame's brushed
// silver, rank elite is the bright accent red vs. the frame's red-black
// lacquer.
const RANK_GRADIENT: Record<Rank, readonly [string, string, string, string]> = METAL_RAMP;

const STOP_OFFSETS = METAL_STOP_OFFSETS;
const STROKE_WIDTH = 2.5;

export function RankEmblem({ rank, level, size = 28 }: Props) {
  const c = size / 2;
  const r = c - 0.5 - STROKE_WIDTH / 2; // leave room for the outer hairline
  const gradientId = `rankRing-${rank}`;
  const stops = RANK_GRADIENT[rank];
  const ringOnly = level === undefined;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            {stops.map((color, i) => (
              <Stop key={STOP_OFFSETS[i]} offset={STOP_OFFSETS[i]} stopColor={color} />
            ))}
          </LinearGradient>
        </Defs>
        <Circle
          cx={c}
          cy={c}
          r={r}
          stroke={`url(#${gradientId})`}
          strokeWidth={STROKE_WIDTH}
          fill={ringOnly ? 'none' : colors.surfaceRaised}
        />
        {/* Fine outer edge — crisps the ring against any background. */}
        <Circle
          cx={c}
          cy={c}
          r={c - 0.375}
          stroke={stops[3]}
          strokeWidth={0.75}
          strokeOpacity={0.6}
          fill="none"
        />
        {/* Hairline inner highlight on the ring's inner rim (top light). */}
        <Circle
          cx={c}
          cy={c}
          r={r - STROKE_WIDTH / 2 - 0.375}
          stroke={stops[0]}
          strokeWidth={0.75}
          strokeOpacity={0.45}
          fill="none"
        />
      </Svg>
      {ringOnly ? null : (
        <AppText style={{ fontFamily: type.display, fontSize: 13, color: colors.text }} tabular>
          {level}
        </AppText>
      )}
    </View>
  );
}
