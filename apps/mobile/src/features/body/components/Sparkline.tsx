import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { colors } from '@gym/ui-tokens';

/** 40px inline red sparkline for strength rows. Draws in like the trend chart. */

interface Props {
  values: number[];
  width?: number;
  height?: number;
}

const INSET = 3;
const DRAW_EASE = Easing.bezier(0.16, 1, 0.3, 1);
const DRAW_MS = 500;

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

export function Sparkline({ values, width = 64, height = 40 }: Props) {
  const reduceMotion = useReducedMotion();
  // Hidden first frame → sweeps in on mount; reduced motion starts fully drawn.
  const draw = useSharedValue(reduceMotion ? 1 : 0);

  let min = values.length > 0 ? Math.min(...values) : 0;
  let max = values.length > 0 ? Math.max(...values) : 1;
  if (max - min < 0.5) {
    min -= 1;
    max += 1;
  }
  const innerW = width - INSET * 2;
  const innerH = height - INSET * 2;
  const y = (v: number): number => INSET + (1 - (v - min) / (max - min)) * innerH;

  const hasLine = values.length >= 2;
  const coords = hasLine
    ? values.map((v, i) => [INSET + (i / (values.length - 1)) * innerW, y(v)] as const)
    : [];
  const points = coords.map(([cx, cy]) => `${cx},${cy}`).join(' ');
  let length = 0;
  for (let i = 1; i < coords.length; i++) {
    const [ax, ay] = coords[i - 1]!;
    const [bx, by] = coords[i]!;
    length += Math.hypot(bx - ax, by - ay);
  }

  // Draw in once on mount (rows appear when the strength data first loads);
  // later data changes just snap, so returning to the tab isn't a light show.
  useEffect(() => {
    if (!hasLine) {
      draw.value = 1;
      return;
    }
    draw.value = 0;
    draw.value = reduceMotion ? 1 : withTiming(1, { duration: DRAW_MS, easing: DRAW_EASE });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion, draw]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: length * (1 - draw.value),
  }));

  if (values.length === 0) return <View style={{ width, height }} />;

  if (values.length === 1) {
    const only = values[0] ?? 0;
    return (
      <Svg width={width} height={height}>
        <Circle cx={width / 2} cy={y(only)} r={2.5} fill={colors.accent} />
      </Svg>
    );
  }

  return (
    <Svg width={width} height={height}>
      <AnimatedPolyline
        points={points}
        fill="none"
        stroke={colors.accent}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={`${length}`}
        animatedProps={animatedProps}
      />
    </Svg>
  );
}
