import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { displayWeight, unitLabel } from '@gym/shared';
import { colors, spacing, type } from '@gym/ui-tokens';
import {
  AppText,
  Divider,
  enterFade,
  enterUp,
  IconChip,
  layoutSpring,
  PressableScale,
  SectionLabel,
} from '../../../components/ui';
import { posterDate } from '../../../lib/dates';
import { useProfile } from '../../../state/profile';
import { useStrength, type StrengthRow } from '../hooks';
import type { ChartPoint } from '../logic';
import { Sparkline } from './Sparkline';
import { WeightChart } from './WeightChart';

/** Exercises the user actually trains: best e1RM + sparkline, tap to expand. */

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 64,
  },
  name: { flex: 1, minWidth: 0 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, flexShrink: 0 },
  value: { fontFamily: type.display, fontSize: 24, color: colors.text },
  detail: { paddingBottom: spacing.lg },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  prRow: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingLeft: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  empty: { marginTop: spacing.lg },
});

function toPoints(row: StrengthRow, unitPref: 'kg' | 'lb'): ChartPoint[] {
  return row.history.map((h) => ({ date: h.date, value: displayWeight(h.e1rm, unitPref) }));
}

export function StrengthSection() {
  const unitPref = useProfile((s) => s.unitPref);
  const data = useStrength();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (data === null) return null;

  const unit = unitLabel(unitPref);

  return (
    <View>
      {data.rows.length === 0 ? (
        <AppText variant="caption" style={styles.empty}>
          Log a workout and your strength trends land here.
        </AppText>
      ) : null}

      {data.rows.map((row, i) => {
        const expanded = expandedId === row.exerciseId;
        const points = toPoints(row, unitPref);
        return (
          <Animated.View key={row.exerciseId} entering={enterUp(Math.min(i, 8))} layout={layoutSpring}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`${row.name}: best estimated one rep max ${Math.round(displayWeight(row.bestE1RmKg, unitPref))} ${unit}`}
              accessibilityState={{ expanded }}
              onPress={() => setExpandedId(expanded ? null : row.exerciseId)}
              style={styles.row}
            >
              <IconChip icon="barbell" />
              <AppText variant="bodyBold" style={styles.name} numberOfLines={1}>
                {row.name}
              </AppText>
              <Sparkline values={points.map((p) => p.value)} />
              <View style={styles.valueRow}>
                <AppText style={styles.value} tabular numberOfLines={1}>
                  {Math.round(displayWeight(row.bestE1RmKg, unitPref))}
                </AppText>
                <AppText variant="caption">{unit}</AppText>
              </View>
            </PressableScale>
            {expanded ? (
              <Animated.View entering={enterFade(0)} style={styles.detail}>
                <WeightChart
                  raw={points}
                  trend={points}
                  height={180}
                  emptyLabel="No history yet"
                  format={(v) => String(Math.round(v))}
                />
                {row.history.slice(-5).reverse().map((h) => (
                  <View key={h.date} style={styles.historyRow}>
                    <AppText variant="caption">{posterDate(h.date)}</AppText>
                    <AppText variant="caption">
                      {Math.round(displayWeight(h.e1rm, unitPref))} {unit} e1RM
                    </AppText>
                  </View>
                ))}
              </Animated.View>
            ) : null}
            <Divider />
          </Animated.View>
        );
      })}

      <Animated.View entering={enterUp(Math.min(data.rows.length, 8))} layout={layoutSpring}>
        <SectionLabel>PR ledger</SectionLabel>
      </Animated.View>
      {data.prs.length === 0 ? (
        <AppText variant="caption">PRs land here — go set one.</AppText>
      ) : (
        data.prs.map((pr, i) => (
          <Animated.View
            key={`${pr.exerciseId}-${pr.date}-${i}`}
            entering={enterUp(Math.min(data.rows.length + 1 + i, 8))}
            layout={layoutSpring}
            style={styles.prRow}
          >
            <View style={{ flex: 1 }}>
              <AppText variant="bodyBold" numberOfLines={1}>
                {pr.exerciseName}
              </AppText>
              <AppText variant="caption">
                {displayWeight(pr.weightKg, unitPref)} {unit} × {pr.reps}
              </AppText>
            </View>
            <AppText variant="caption">{posterDate(pr.date)}</AppText>
          </Animated.View>
        ))
      )}
    </View>
  );
}
