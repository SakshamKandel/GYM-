import { StyleSheet, View } from 'react-native';
import { displayWeight, unitLabel } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, SectionLabel, StatBlock } from '../../../components/ui';
import { todayIso } from '../../../lib/dates';
import { useProfile } from '../../../state/profile';
import type { OverviewData } from '../hooks';
import { buildHeatmap, fmtCompact } from '../logic';
import { ConsistencyHeatmap } from './ConsistencyHeatmap';
import { TonnageChart } from './TonnageChart';

/** Overview: the consistency calendar, weekly tonnage, and the numbers behind them. */

interface Props {
  data: OverviewData;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  caption: { marginTop: spacing.sm },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.xl },
  stat: { width: '50%' },
});

export function OverviewSection({ data }: Props) {
  const unitPref = useProfile((s) => s.unitPref);
  const daysPerWeek = useProfile((s) => s.daysPerWeek);
  const weeks = buildHeatmap(data.workoutDates, todayIso());
  const { avgPerWeek, adherencePct } = data.consistency;

  return (
    <View>
      <SectionLabel>Training calendar</SectionLabel>
      <View style={styles.card}>
        <ConsistencyHeatmap weeks={weeks} />
      </View>
      <AppText variant="caption" color={colors.textFaint} style={styles.caption}>
        Last 12 weeks — every filled square is a session. Today is outlined.
      </AppText>

      <SectionLabel>Weekly tonnage</SectionLabel>
      <View style={styles.card}>
        <TonnageChart weeks={data.tonnage} unitPref={unitPref} />
      </View>

      <SectionLabel>12-week stats</SectionLabel>
      <View style={styles.statRow}>
        <StatBlock
          label="Sessions / week"
          value={avgPerWeek}
          unit={`of ${daysPerWeek}`}
          style={styles.stat}
        />
        <StatBlock label="Adherence" value={adherencePct} unit="%" style={styles.stat} />
        <StatBlock
          label="Avg session"
          value={data.avgSessionMin ?? '—'}
          unit={data.avgSessionMin !== null ? 'min' : undefined}
          style={styles.stat}
        />
        <StatBlock
          label="Total lifted"
          value={fmtCompact(displayWeight(data.totalTonnageKg, unitPref))}
          unit={unitLabel(unitPref)}
          style={styles.stat}
        />
      </View>
    </View>
  );
}
