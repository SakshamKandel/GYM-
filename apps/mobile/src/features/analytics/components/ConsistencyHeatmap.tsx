import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';
import type { HeatWeek } from '../logic';

/**
 * 12-week training calendar: one column per week, Monday at the top. A filled
 * cell is a day with a finished workout; today is outlined. Plain Views and
 * token colors — no decoration.
 */

interface Props {
  weeks: HeatWeek[];
}

const GAP = 3;
const MAX_CELL = 20;
const MONTH_ROW_H = 20;

const styles = StyleSheet.create({
  monthRow: { height: MONTH_ROW_H },
  month: { position: 'absolute', top: 0 },
  grid: { flexDirection: 'row' },
  // Heatmap cells rounded 6 (revamp spec) — half the small radius token.
  cell: { borderRadius: radius.sm / 2, marginBottom: GAP },
  rest: { backgroundColor: colors.surfaceRaised },
  done: { backgroundColor: colors.accent },
  future: { backgroundColor: 'transparent' },
  today: { borderWidth: 1.5, borderColor: colors.text },
});

export function ConsistencyHeatmap({ weeks }: Props) {
  const [width, setWidth] = useState(0);
  const n = weeks.length;
  const cell =
    n > 0 && width > 0 ? Math.min(MAX_CELL, Math.floor((width - GAP * (n - 1)) / n)) : 0;
  const doneCount = weeks.reduce((sum, w) => sum + w.days.filter((d) => d.done).length, 0);

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityLabel={`Training calendar, last ${n} weeks: ${doneCount} workout ${
        doneCount === 1 ? 'day' : 'days'
      }.`}
    >
      {cell > 0 ? (
        <>
          <View style={styles.monthRow}>
            {weeks.map((w, i) =>
              w.monthLabel ? (
                <AppText
                  key={`m-${w.days[0]?.date ?? i}`}
                  variant="label"
                  color={colors.textFaint}
                  style={[styles.month, { left: i * (cell + GAP) }]}
                >
                  {w.monthLabel}
                </AppText>
              ) : null,
            )}
          </View>
          <View style={styles.grid}>
            {weeks.map((w, i) => (
              <View key={w.days[0]?.date ?? String(i)} style={i < n - 1 ? { marginRight: GAP } : null}>
                {w.days.map((d) => (
                  <View
                    key={d.date}
                    style={[
                      styles.cell,
                      { width: cell, height: cell },
                      d.future ? styles.future : d.done ? styles.done : styles.rest,
                      d.isToday ? styles.today : null,
                    ]}
                  />
                ))}
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}
