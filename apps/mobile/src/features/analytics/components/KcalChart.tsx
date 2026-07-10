import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { colors, type } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';
import { fmtCompact, monthDay } from '../logic';

/**
 * 14-day calorie bars against a dashed target line. Adherence-neutral like the
 * Food tab's ring: over and under wear the same neutral color — the accent
 * only marks TODAY, never a verdict. Unlogged days stay empty.
 */

interface Props {
  /** Oldest → newest, zero-filled. */
  days: { date: string; kcal: number }[];
  targetKcal: number;
  today: string;
  height?: number;
}

const PAD_TOP = 20;
const PAD_BOTTOM = 24;

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  axisLabel: {
    position: 'absolute',
    top: 0,
    left: 0,
    fontFamily: type.display,
    fontSize: 12,
    color: colors.textDim,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

export function KcalChart({ days, targetKcal, today, height = 150 }: Props) {
  const [width, setWidth] = useState(0);
  const n = days.length;
  const kcals = days.map((d) => d.kcal);
  const max = Math.max(...kcals, targetKcal, 1) * 1.05;
  const innerH = height - PAD_TOP - PAD_BOTTOM;
  const slot = n > 0 ? width / n : 0;
  // Thick pill bars (revamp §7 vocabulary translated to charts).
  const barW = Math.min(20, Math.max(5, slot * 0.6));
  const y = (v: number): number => PAD_TOP + (1 - v / max) * innerH;

  return (
    <View
      style={[styles.wrap, { height }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityLabel={`Calories, last ${n} days, against a ${targetKcal} kcal target.`}
    >
      {width > 0 && n > 0 ? (
        <>
          <Svg width={width} height={height}>
            <Line
              x1={0}
              x2={width}
              y1={height - PAD_BOTTOM}
              y2={height - PAD_BOTTOM}
              stroke={colors.border}
              strokeWidth={1}
            />
            {days.map((d, i) => {
              if (d.kcal <= 0) return null;
              const h = Math.max(2, (d.kcal / max) * innerH);
              return (
                <Rect
                  key={d.date}
                  x={i * slot + (slot - barW) / 2}
                  y={PAD_TOP + innerH - h}
                  width={barW}
                  height={h}
                  rx={Math.min(barW / 2, h / 2)}
                  fill={d.date === today ? colors.kcal : colors.borderStrong}
                />
              );
            })}
            {targetKcal > 0 ? (
              <Line
                x1={0}
                x2={width}
                y1={y(targetKcal)}
                y2={y(targetKcal)}
                stroke={colors.textDim}
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            ) : null}
          </Svg>
          <AppText style={styles.axisLabel} tabular>
            {fmtCompact(max)} kcal
          </AppText>
          <View style={styles.footer}>
            <AppText variant="caption" color={colors.textFaint}>
              {days[0] ? monthDay(days[0].date) : ''}
            </AppText>
            <AppText variant="caption" color={colors.textFaint}>
              Today
            </AppText>
          </View>
        </>
      ) : null}
    </View>
  );
}
