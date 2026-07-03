import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { colors, radius, type } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';
import type { ChartPoint } from '../logic';

/**
 * Trend chart: raw points as small dim dots BEHIND a bold red smoothed line.
 * Two hairlines + min/max labels only — no grid noise. Also reused for the
 * strength e1RM detail chart (pass the same series for raw and trend).
 *
 * The trend line DRAWS IN on mount/data-change — a stroke-dashoffset sweep,
 * the same reveal vocabulary as <Ring>. Reduced motion lands it instantly.
 */

interface Props {
  raw: ChartPoint[];
  trend: ChartPoint[];
  height?: number;
  emptyLabel: string;
  /** Axis label formatting (default 1 decimal). */
  format?: (v: number) => string;
}

const LABEL_W = 46;
const PAD_TOP = 18;
const PAD_BOTTOM = 18;
const PAD_RIGHT = 8;

// Same ease-out + feel as the Ring sweep, so every chart reveal reads as one.
const DRAW_EASE = Easing.bezier(0.16, 1, 0.3, 1);
const DRAW_MS = 600;

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  empty: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  axisLabel: {
    position: 'absolute',
    left: 0,
    width: LABEL_W - 8,
    textAlign: 'right',
    fontFamily: type.display,
    fontSize: 12,
    color: colors.textDim,
  },
});

export function WeightChart({
  raw,
  trend,
  height = 220,
  emptyLabel,
  format = (v) => v.toFixed(1),
}: Props) {
  const [width, setWidth] = useState(0);
  const reduceMotion = useReducedMotion();
  // Start hidden (offset = full length) so the first painted frame is empty and
  // the line sweeps in; reduced motion starts fully drawn (no flash, no motion).
  const draw = useSharedValue(reduceMotion ? 1 : 0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const all = [...raw, ...trend];
  const values = all.map((p) => p.value);
  let min = values.length > 0 ? Math.min(...values) : 0;
  let max = values.length > 0 ? Math.max(...values) : 1;
  if (max - min < 0.5) {
    min -= 1;
    max += 1;
  }

  const times = all.map((p) => new Date(`${p.date}T12:00:00`).getTime());
  const t0 = times.length > 0 ? Math.min(...times) : 0;
  const t1 = times.length > 0 ? Math.max(...times) : 0;
  const span = Math.max(1, t1 - t0);

  const innerW = Math.max(1, width - LABEL_W - PAD_RIGHT);
  const innerH = height - PAD_TOP - PAD_BOTTOM;
  const x = (date: string): number => {
    if (t1 === t0) return LABEL_W + innerW / 2;
    return LABEL_W + ((new Date(`${date}T12:00:00`).getTime() - t0) / span) * innerW;
  };
  const y = (v: number): number => PAD_TOP + (1 - (v - min) / (max - min)) * innerH;

  // Trend coords in pixel space → the polyline string plus its total length,
  // which is the dash period we sweep the offset across.
  const trendCoords = trend.map((p) => [x(p.date), y(p.value)] as const);
  const trendPoints = trendCoords.map(([cx, cy]) => `${cx},${cy}`).join(' ');
  let trendLength = 0;
  for (let i = 1; i < trendCoords.length; i++) {
    const [ax, ay] = trendCoords[i - 1]!;
    const [bx, by] = trendCoords[i]!;
    trendLength += Math.hypot(bx - ax, by - ay);
  }

  // Sweep the line in once the chart has a measured width (i.e. on mount / when
  // it's revealed by a chip switch, row expand or sheet open — all user-driven).
  // We intentionally don't re-sweep on later data changes: redrawing the whole
  // line every focus would be busy, and this keeps the reveal flash-free. The
  // chart View only mounts once data exists, so width and data arrive together.
  useEffect(() => {
    if (width === 0) return; // not measured yet — keep the initial (hidden) state.
    if (trend.length < 2) {
      draw.value = 1; // single point / no line — nothing to sweep.
      return;
    }
    draw.value = 0;
    draw.value = reduceMotion ? 1 : withTiming(1, { duration: DRAW_MS, easing: DRAW_EASE });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, reduceMotion, draw]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: trendLength * (1 - draw.value),
  }));

  if (all.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <AppText variant="caption">{emptyLabel}</AppText>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { height }]} onLayout={onLayout}>
      {width > 0 ? (
        <>
          <Svg width={width} height={height}>
            <Line
              x1={LABEL_W}
              x2={width - PAD_RIGHT}
              y1={y(max)}
              y2={y(max)}
              stroke={colors.border}
              strokeWidth={1}
            />
            <Line
              x1={LABEL_W}
              x2={width - PAD_RIGHT}
              y1={y(min)}
              y2={y(min)}
              stroke={colors.border}
              strokeWidth={1}
            />
            {raw.map((p) => (
              <Circle
                key={`raw-${p.date}`}
                cx={x(p.date)}
                cy={y(p.value)}
                r={3}
                fill={colors.textFaint}
              />
            ))}
            {trend.length >= 2 ? (
              <AnimatedPolyline
                points={trendPoints}
                fill="none"
                stroke={colors.accent}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={`${trendLength}`}
                animatedProps={animatedProps}
              />
            ) : null}
            {trend.length === 1 && trend[0] ? (
              <Circle
                cx={x(trend[0].date)}
                cy={y(trend[0].value)}
                r={4}
                fill={colors.accent}
              />
            ) : null}
          </Svg>
          <AppText style={[styles.axisLabel, { top: y(max) - 16 }]} tabular>
            {format(max)}
          </AppText>
          <AppText style={[styles.axisLabel, { top: y(min) + 2 }]} tabular>
            {format(min)}
          </AppText>
        </>
      ) : null}
    </View>
  );
}
