import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, Divider, SectionLabel } from '../../../components/ui';
import { posterDate } from '../../../lib/dates';
import { deltaIcon, signedDelta, type ChartPoint } from '../logic';

/**
 * Detail behind the weight trend chart (shown in a <Sheet>): the latest scale
 * reading, how many weigh-ins and the net change across the window, then the
 * recent weigh-ins with per-entry deltas. Direction stays textDim — whether a
 * change is "good" depends on the goal, so we never colour-judge it (matches
 * WeightSection).
 */

interface Props {
  /** Raw weigh-ins in display units, oldest→newest. */
  points: ChartPoint[];
  unit: string;
  windowDays: number;
}

const MAX_ROWS = 8;

const styles = StyleSheet.create({
  hero: { marginBottom: spacing.md },
  heroNum: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  heroLabel: { marginTop: spacing.xs },
  statRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg, marginTop: spacing.md },
  statHalf: { flex: 1, minWidth: 0 },
  changeRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 2 },
  changeIcon: { alignSelf: 'center' },
  window: { marginTop: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 48,
  },
  rowRight: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, flexShrink: 0 },
  delta: { minWidth: 40, textAlign: 'right' },
});

export function WeightHistorySheet({ points, unit, windowDays }: Props) {
  if (points.length === 0) {
    return (
      <AppText variant="body" color={colors.textDim}>
        No weigh-ins yet.
      </AppText>
    );
  }

  const latest = points[points.length - 1]!;
  const first = points[0]!;
  const change = Math.round((latest.value - first.value) * 10) / 10;
  const recent = [...points].reverse();
  const rows = recent.slice(0, MAX_ROWS);

  return (
    <View>
      <View
        style={styles.hero}
        accessible
        accessibilityLabel={`Latest weigh-in ${latest.value.toFixed(1)} ${unit}, ${posterDate(
          latest.date,
        )}`}
      >
        <View style={styles.heroNum}>
          <AppText variant="display" tabular>
            {latest.value.toFixed(1)}
          </AppText>
          <AppText variant="caption">{unit}</AppText>
        </View>
        <AppText variant="label" style={styles.heroLabel}>
          Latest · {posterDate(latest.date)}
        </AppText>
      </View>

      <Divider />

      <View style={styles.statRow}>
        <View style={styles.statHalf}>
          <AppText variant="label" numberOfLines={1}>
            Weigh-ins
          </AppText>
          <AppText variant="display" tabular>
            {points.length}
          </AppText>
        </View>
        <View
          style={styles.statHalf}
          accessible
          accessibilityLabel={`Change ${signedDelta(change)} ${unit} over ${windowDays} days`}
        >
          <AppText variant="label" numberOfLines={1}>
            Change
          </AppText>
          <View style={styles.changeRow}>
            <Ionicons
              name={deltaIcon(change)}
              size={16}
              color={colors.textDim}
              style={styles.changeIcon}
            />
            <AppText variant="display" tabular>
              {signedDelta(change)}
            </AppText>
            <AppText variant="caption">{unit}</AppText>
          </View>
        </View>
      </View>
      <AppText variant="caption" style={styles.window}>
        Over the last {windowDays} days
      </AppText>

      <SectionLabel>Recent weigh-ins</SectionLabel>
      {rows.map((p, i) => {
        const prev = recent[i + 1];
        const d = prev ? Math.round((p.value - prev.value) * 10) / 10 : null;
        return (
          <View key={p.date}>
            <View style={styles.row}>
              <AppText variant="bodyBold" numberOfLines={1}>
                {posterDate(p.date)}
              </AppText>
              <View style={styles.rowRight}>
                <AppText variant="body" tabular>
                  {p.value.toFixed(1)} {unit}
                </AppText>
                {d !== null ? (
                  <AppText variant="caption" style={styles.delta}>
                    {signedDelta(d)}
                  </AppText>
                ) : null}
              </View>
            </View>
            {i < rows.length - 1 ? <Divider /> : null}
          </View>
        );
      })}
    </View>
  );
}
