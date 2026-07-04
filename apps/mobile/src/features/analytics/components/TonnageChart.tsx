import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { displayWeight, unitLabel, type UnitPref, type WeeklyTonnage } from '@gym/shared';
import { colors, type } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';
import { fmtCompact, monthDay } from '../logic';

/**
 * Weekly tonnage bars — hand-rolled svg in the WeightChart vocabulary: two
 * hairlines, one condensed max label, no grid noise. The current week is the
 * accent bar; weeks without sets leave an empty slot so gaps stay honest.
 */

interface Props {
  weeks: WeeklyTonnage[];
  unitPref: UnitPref;
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

export function TonnageChart({ weeks, unitPref, height = 150 }: Props) {
  const [width, setWidth] = useState(0);
  const n = weeks.length;
  const values = weeks.map((w) => displayWeight(w.tonnageKg, unitPref));
  const max = Math.max(...values, 1);
  const innerH = height - PAD_TOP - PAD_BOTTOM;
  const slot = n > 0 ? width / n : 0;
  const barW = Math.min(22, Math.max(4, slot * 0.6));
  const unit = unitLabel(unitPref);
  const thisWeek = values[n - 1] ?? 0;

  return (
    <View
      style={[styles.wrap, { height }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityLabel={`Weekly tonnage, last ${n} weeks. This week ${fmtCompact(thisWeek)} ${unit}.`}
    >
      {width > 0 && n > 0 ? (
        <>
          <Svg width={width} height={height}>
            <Line x1={0} x2={width} y1={PAD_TOP} y2={PAD_TOP} stroke={colors.border} strokeWidth={1} />
            <Line
              x1={0}
              x2={width}
              y1={height - PAD_BOTTOM}
              y2={height - PAD_BOTTOM}
              stroke={colors.border}
              strokeWidth={1}
            />
            {values.map((v, i) => {
              if (v <= 0) return null;
              const h = Math.max(2, (v / max) * innerH);
              return (
                <Rect
                  key={weeks[i]?.weekStartIso ?? String(i)}
                  x={i * slot + (slot - barW) / 2}
                  y={PAD_TOP + innerH - h}
                  width={barW}
                  height={h}
                  rx={3}
                  fill={i === n - 1 ? colors.accent : colors.borderStrong}
                />
              );
            })}
          </Svg>
          <AppText style={styles.axisLabel} tabular>
            {fmtCompact(max)} {unit}
          </AppText>
          <View style={styles.footer}>
            <AppText variant="caption" color={colors.textFaint}>
              {weeks[0] ? monthDay(weeks[0].weekStartIso) : ''}
            </AppText>
            <AppText variant="caption" color={colors.textFaint}>
              This week
            </AppText>
          </View>
        </>
      ) : null}
    </View>
  );
}
