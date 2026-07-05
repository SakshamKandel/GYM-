import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  LinearGradient,
  SweepGradient,
  vec,
} from '@shopify/react-native-skia';
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { Tier } from '@gym/shared';
import { TierAvatarFrame } from './TierAvatarFrame';
import { TIER_FRAME, TIER_GLOW, TIER_SHEEN } from './tierPalette';

/**
 * The luxury-island avatar ring — the metallic TierAvatarFrame band plus the
 * two effects sanctioned ONLY on premium surfaces (settings VIP card + home
 * greeting avatar): a soft static halo in the tier color and one slow sheen
 * arc traveling around the band (6s per revolution, linear — a reflection
 * gliding over metal, never a blink or pulse).
 *
 * Everywhere else in the app keeps the static TierAvatarFrame (no-glow law).
 * Starter and reduced-motion render the plain static frame. On web, Metro
 * resolves AnimatedTierRing.web.tsx instead, so Skia never loads there.
 *
 * Same drop-in contract as TierAvatarFrame: the component occupies exactly
 * `size`×`size` in layout — the glow halo paints outside those bounds via an
 * absolutely-positioned, non-clipping Canvas, so rows don't shift.
 */

interface Props {
  tier: Tier;
  /** Avatar diameter in px; children should fill this same square. */
  size: number;
  children: ReactNode;
}

/** How long one sheen revolution takes — slow enough to read as light. */
const SWEEP_MS = 6000;

export function AnimatedTierRing({ tier, size, children }: Props) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const animate = tier !== 'starter' && !reduceMotion;

  useEffect(() => {
    if (!animate) return;
    // Reset before looping: cancelAnimation (cleanup) leaves the shared value
    // mid-flight, and withRepeat snaps back to its start value each cycle —
    // restarting from e.g. 0.4 would make the sheen jump once per revolution.
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: SWEEP_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [animate, progress]);

  const sweepTransform = useDerivedValue(() => [{ rotate: progress.value * Math.PI * 2 }]);

  if (!animate) {
    return (
      <TierAvatarFrame tier={tier} size={size}>
        {children}
      </TierAvatarFrame>
    );
  }

  const palette = TIER_FRAME[tier];
  // Breathing room around the avatar so the blurred halo isn't clipped.
  const pad = Math.max(6, size * 0.14);
  const canvasSize = size + pad * 2;
  const c = pad + size / 2;
  // Ring geometry mirrors TierAvatarFrame exactly (same band, same bevel).
  const ringW = Math.max(2.5, size * 0.055);
  const edgeR = size / 2 - 0.5;
  const ringR = size / 2 - 1 - ringW / 2;
  const innerR = size / 2 - 1 - ringW + 0.375;

  return (
    <View style={{ width: size, height: size }}>
      {/* Avatar clip — identical to the static frame's circular crop. */}
      <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
        {children}
      </View>
      <Canvas
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: -pad,
          top: -pad,
          width: canvasSize,
          height: canvasSize,
        }}
      >
        {/* 1 — static halo: a restrained tier-color glow, never pulsing. */}
        <Circle
          c={vec(c, c)}
          r={size / 2 - 1}
          style="stroke"
          strokeWidth={ringW + 2}
          color={TIER_GLOW[tier]}
          opacity={0.35}
        >
          <BlurMask blur={pad * 0.6} style="normal" />
        </Circle>
        {/* 2 — metallic band: same top-lit 5-stop brushed gradient. */}
        <Circle c={vec(c, c)} r={ringR} style="stroke" strokeWidth={ringW}>
          <LinearGradient
            start={vec(c, pad)}
            end={vec(c, pad + size)}
            colors={[...palette.stops]}
            positions={[0, 0.3, 0.55, 0.76, 1]}
          />
        </Circle>
        {/* 3 — sheen sweep: one soft ~35° arc gliding around the band. */}
        <Group origin={vec(c, c)} transform={sweepTransform}>
          <Circle c={vec(c, c)} r={ringR} style="stroke" strokeWidth={ringW}>
            <SweepGradient
              c={vec(c, c)}
              colors={['transparent', 'transparent', TIER_SHEEN[tier], 'transparent']}
              positions={[0, 0.8, 0.9, 1]}
            />
          </Circle>
        </Group>
        {/* 4 — crisp edge + inner bevel highlight over everything. */}
        <Circle
          c={vec(c, c)}
          r={edgeR}
          style="stroke"
          strokeWidth={1}
          color={palette.edge}
        />
        <Circle
          c={vec(c, c)}
          r={innerR}
          style="stroke"
          strokeWidth={0.75}
          color={palette.innerHighlight}
          opacity={0.55}
        />
      </Canvas>
    </View>
  );
}
