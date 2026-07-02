import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { colors, radius, type } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';
import type { ChartPoint } from '../logic';

/**
 * Trend chart: raw points as small dim dots BEHIND a bold red smoothed line.
 * Two hairlines + min/max labels only — no grid noise. Also reused for the
 * strength e1RM detail chart (pass the same series for raw and trend).
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
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const all = [...raw, ...trend];
  if (all.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <AppText variant="caption">{emptyLabel}</AppText>
      </View>
    );
  }

  const values = all.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 0.5) {
    min -= 1;
    max += 1;
  }

  const times = all.map((p) => new Date(`${p.date}T12:00:00`).getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const span = Math.max(1, t1 - t0);

  const innerW = Math.max(1, width - LABEL_W - PAD_RIGHT);
  const innerH = height - PAD_TOP - PAD_BOTTOM;
  const x = (date: string): number => {
    if (t1 === t0) return LABEL_W + innerW / 2;
    return LABEL_W + ((new Date(`${date}T12:00:00`).getTime() - t0) / span) * innerW;
  };
  const y = (v: number): number => PAD_TOP + (1 - (v - min) / (max - min)) * innerH;

  const trendPoints = trend.map((p) => `${x(p.date)},${y(p.value)}`).join(' ');

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
              <Polyline
                points={trendPoints}
                fill="none"
                stroke={colors.accent}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
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
