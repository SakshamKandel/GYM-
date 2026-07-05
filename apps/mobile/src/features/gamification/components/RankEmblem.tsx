import { View } from 'react-native';
import type { Rank } from '@gym/shared';
import { colors, type } from '@gym/ui-tokens';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { AppText } from '../../../components/ui';

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
 */

interface Props {
  rank: Rank;
  /** Omit for a ring-only emblem (no number, transparent center). */
  level?: number;
  size?: number;
}

// Top-lit 4-stop metals at offsets 0% / 40% / 62% / 100%. Kept clearly apart
// from the TIER_FRAME finishes: rank silver is cooler/darker than the frame's
// brushed silver, rank elite is the bright accent red vs. the frame's
// red-black lacquer.
const RANK_GRADIENT: Record<Rank, readonly [string, string, string, string]> = {
  bronze: ['#EBBA85', '#CE9255', '#A96F36', '#7C5124'],
  silver: ['#D4D8DE', '#A6ABB3', '#84898F', '#62676F'],
  gold: ['#F3D783', '#E3BE55', '#B8913A', '#96742B'],
  elite: ['#FF7A6E', '#F5453A', '#C22D24', '#8F211B'],
};

const STOP_OFFSETS = ['0%', '40%', '62%', '100%'] as const;
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
