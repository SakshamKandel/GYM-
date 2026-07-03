import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '@gym/ui-tokens';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * Crisp SVG progress ring — flat strokes, no glow. The arc sweeps in on
 * mount/update (500ms ease-out). Progress > 1 simply completes the ring
 * (adherence-neutral: over target is never "red").
 */
interface Props {
  progress: number; // 0..1+
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  /** Delay before the sweep starts (stagger multiple rings). */
  delay?: number;
  children?: React.ReactNode;
}

export function Ring({
  progress,
  size = 72,
  strokeWidth = 6,
  color = colors.accent,
  trackColor = colors.surfaceRaised,
  delay = 0,
  children,
}: Props) {
  const clamped = Math.max(0, Math.min(progress, 1));
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;

  const animated = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    // Reduced motion: land on the final arc with no sweep.
    animated.value = reduceMotion
      ? clamped
      : withDelay(
          delay,
          withTiming(clamped, { duration: 500, easing: Easing.bezier(0.16, 1, 0.3, 1) }),
        );
  }, [clamped, delay, animated, reduceMotion]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: c * (1 - animated.value),
  }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c}`}
          animatedProps={animatedProps}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}
