import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, Divider, SectionLabel } from '../../../components/ui';
import { posterDate } from '../../../lib/dates';
import { deltaIcon, signedDelta, type ChartPoint } from '../logic';
import { WeightChart } from './WeightChart';

/**
 * One measurement field's history in a <Sheet>: latest tape value, the trend
 * chart (draws in), net change since the first entry, and the recent readings
 * with per-entry deltas. Everything in cm; direction stays textDim.
 */

interface Props {
  label: string;
  /** Field readings in cm, oldest→newest. */
  series: ChartPoint[];
}

const MAX_ROWS = 8;

const styles = StyleSheet.create({
  hero: { marginBottom: spacing.md },
  heroNum: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  heroLabel: { marginTop: spacing.xs },
  chartWrap: { marginBottom: spacing.md },
  statRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg },
  statHalf: { flex: 1, minWidth: 0 },
  changeRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 2 },
  changeIcon: { alignSelf: 'center' },
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

export function MeasurementDetailSheet({ label, series }: Props) {
  if (series.length === 0) {
    return (
      <AppText variant="body" color={colors.textDim}>
        No {label.toLowerCase()} entries yet.
      </AppText>
    );
  }

  const latest = series[series.length - 1]!;
  const first = series[0]!;
  const change = Math.round((latest.value - first.value) * 10) / 10;
  const recent = [...series].reverse();
  const rows = recent.slice(0, MAX_ROWS);

  return (
    <View>
      <View
        style={styles.hero}
        accessible
        accessibilityLabel={`Latest ${label} ${latest.value.toFixed(1)} centimetres, ${posterDate(
          latest.date,
        )}`}
      >
        <View style={styles.heroNum}>
          <AppText variant="display" tabular>
            {latest.value.toFixed(1)}
          </AppText>
          <AppText variant="caption">cm</AppText>
        </View>
        <AppText variant="label" style={styles.heroLabel}>
          Latest · {posterDate(latest.date)}
        </AppText>
      </View>

      {series.length >= 2 ? (
        <View style={styles.chartWrap}>
          <WeightChart
            raw={series}
            trend={series}
            height={150}
            emptyLabel=""
            format={(v) => v.toFixed(1)}
          />
        </View>
      ) : null}

      <View style={styles.statRow}>
        <View style={styles.statHalf}>
          <AppText variant="label" numberOfLines={1}>
            Entries
          </AppText>
          <AppText variant="display" tabular>
            {series.length}
          </AppText>
        </View>
        <View
          style={styles.statHalf}
          accessible
          accessibilityLabel={`Change ${signedDelta(change)} centimetres since the first entry`}
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
            <AppText variant="caption">cm</AppText>
          </View>
        </View>
      </View>

      <SectionLabel>History</SectionLabel>
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
                  {p.value.toFixed(1)} cm
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
