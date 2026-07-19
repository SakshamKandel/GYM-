import { useEffect, useState, type ReactElement } from 'react';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

/**
 * Traveling sheen — the ONE sanctioned animation on the premium metal
 * subscription surfaces (paywall tier cards). A soft diagonal band of light
 * sweeps across the brushed-metal face, pauses, and repeats: light moving
 * across polished metal. Everything else on those faces stays static
 * (design law); the AnimatedTierRing sheen-arc is the precedent.
 *
 * Slow and subtle by contract — 2.6s sweep + 2.8s rest, per-tier peak
 * opacity from METAL_FINISH. Reduced-motion disables the sweep entirely
 * (renders nothing). Decorative: hidden from accessibility, never
 * intercepts touches.
 */

export interface MetalSheenProps {
  /** Band color — pass the tier metal's `sheen` token from cardMetals. */
  color: string;
  /** Peak band opacity at the center of the sweep (0..1). */
  peakOpacity: number;
  /** Measured card-face width in px. */
  width: number;
  /** Measured card-face height in px. */
  height: number;
  /** Optional stagger before the first sweep, ms (default 0). */
  delayMs?: number;
}

const SWEEP_MS = 2600;
const REST_MS = 2800;

/** Unique gradient ids — four tier cards mount side by side. */
let sheenSeq = 0;

export function MetalSheen({
  color,
  peakOpacity,
  width,
  height,
  delayMs = 0,
}: MetalSheenProps): ReactElement | null {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const [gradientId] = useState(() => `metalSheen-${(sheenSeq += 1)}`);

  const bandWidth = width * 0.46;
  const bandHeight = height * 1.8; // overshoot so the rotated band never clips

  useEffect(() => {
    if (reduceMotion) return;
    progress.value = 0;
    progress.value = withDelay(
      delayMs,
      withRepeat(
        withSequence(
          withTiming(1, { duration: SWEEP_MS, easing: Easing.inOut(Easing.quad) }),
          // Rest at the end, then snap back to the start instantly.
          withDelay(REST_MS, withTiming(0, { duration: 0 })),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(progress);
  }, [delayMs, reduceMotion, progress]);

  const bandStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: -bandWidth + progress.value * (width + bandWidth * 2) },
      { rotate: '18deg' },
    ],
  }));

  if (reduceMotion || width <= 0 || height <= 0) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          position: 'absolute',
          left: 0,
          top: -height * 0.4,
          width: bandWidth,
          height: bandHeight,
        },
        bandStyle,
      ]}
    >
      <Svg width={bandWidth} height={bandHeight}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={color} stopOpacity="0" />
            <Stop offset="0.5" stopColor={color} stopOpacity={peakOpacity} />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={bandWidth} height={bandHeight} fill={`url(#${gradientId})`} />
      </Svg>
    </Animated.View>
  );
}
