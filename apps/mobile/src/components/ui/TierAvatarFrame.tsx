import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { Tier } from '@gym/shared';
import { colors } from '@gym/ui-tokens';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { FRAME_STOP_OFFSETS, TIER_FRAME } from './tierPalette';

/**
 * Metallic subscription-tier frame around an avatar — pure membership
 * identity, never gamification. This is visually a FILLED metallic band
 * hugging the avatar photo/initial; the earned RankEmblem is a thin 2.5px
 * ring around a level number that lives beside the rank text, never on the
 * avatar — the two must stay impossible to confuse (design law).
 *
 * Finish: static SVG linear gradient (top-lit, 5 brushed stops from
 * tierPalette) + 1px outer edge + hairline inner highlight. No filters, no
 * animation, no glow/pulse/shine (design law). `starter` gets a plain 1px
 * hairline so free members keep a quiet, undecorated frame.
 *
 * The frame paints INSIDE the given `size` — a 56px avatar stays 56px, the
 * band overlays the avatar's rim — so it drops into existing layouts without
 * shifting anything.
 */

interface Props {
  tier: Tier;
  /** Outer diameter in px; children should fill this same square. */
  size: number;
  children: ReactNode;
}

export function TierAvatarFrame({ tier, size, children }: Props) {
  const c = size / 2;

  if (tier === 'starter') {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: c,
          overflow: 'hidden',
        }}
      >
        {children}
        <Svg width={size} height={size} style={{ position: 'absolute' }} pointerEvents="none">
          <Circle cx={c} cy={c} r={c - 0.5} stroke={colors.border} strokeWidth={1} fill="none" />
        </Svg>
      </View>
    );
  }

  const palette = TIER_FRAME[tier];
  const ringW = Math.max(2.5, size * 0.055);
  // Outer edge hugs the rim; gradient band sits just inside it; the inner
  // hairline rides the band's inner rim so it reads as light on a bevel.
  const edgeR = c - 0.5;
  const ringR = c - 1 - ringW / 2;
  const innerR = c - 1 - ringW + 0.375;
  const gradientId = `tierFrame-${tier}`;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: c,
        overflow: 'hidden',
      }}
    >
      {children}
      <Svg width={size} height={size} style={{ position: 'absolute' }} pointerEvents="none">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            {palette.stops.map((color, i) => (
              <Stop key={FRAME_STOP_OFFSETS[i]} offset={FRAME_STOP_OFFSETS[i]} stopColor={color} />
            ))}
          </LinearGradient>
        </Defs>
        <Circle cx={c} cy={c} r={ringR} stroke={`url(#${gradientId})`} strokeWidth={ringW} fill="none" />
        <Circle cx={c} cy={c} r={edgeR} stroke={palette.edge} strokeWidth={1} fill="none" />
        <Circle
          cx={c}
          cy={c}
          r={innerR}
          stroke={palette.innerHighlight}
          strokeWidth={0.75}
          strokeOpacity={0.55}
          fill="none"
        />
      </Svg>
    </View>
  );
}
