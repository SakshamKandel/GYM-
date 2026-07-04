import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, SectionLabel, StatBlock } from '../../../components/ui';
import { todayIso } from '../../../lib/dates';
import { useProfile } from '../../../state/profile';
import type { NutritionTrendData } from '../hooks';
import { litresLabel } from '../logic';
import { KcalChart } from './KcalChart';

/**
 * Two-week nutrition trends: calories vs target, adherence and protein hit
 * rates, average water. Adherence-neutral throughout — over target is a fact,
 * not a failure.
 */

interface Props {
  data: NutritionTrendData;
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
  footnote: { marginTop: spacing.lg },
  empty: { marginTop: spacing.lg },
});

export function NutritionSection({ data }: Props) {
  const targets = useProfile((s) => s.targets);

  if (data.kcal.daysLogged === 0) {
    return (
      <AppText variant="caption" style={styles.empty}>
        Log a few days of food and your two-week trends land here.
      </AppText>
    );
  }

  return (
    <View>
      <SectionLabel>Calories, last 14 days</SectionLabel>
      <View style={styles.card}>
        <KcalChart days={data.days} targetKcal={targets.kcal} today={todayIso()} />
      </View>
      <AppText variant="caption" color={colors.textFaint} style={styles.caption}>
        The dashed line is your {targets.kcal} kcal target. Empty slots are unlogged days.
      </AppText>

      <SectionLabel>Adherence</SectionLabel>
      <View style={styles.statRow}>
        <StatBlock
          label="Days in target"
          value={data.kcal.adherencePct}
          unit="%"
          style={styles.stat}
        />
        <StatBlock label="Protein hit" value={data.protein.hitPct} unit="%" style={styles.stat} />
        <StatBlock label="Avg kcal" value={data.kcal.avgKcal} unit="kcal" style={styles.stat} />
        <StatBlock
          label="Avg water"
          value={data.avgWaterMl !== null ? litresLabel(data.avgWaterMl) : '—'}
          unit={data.avgWaterMl !== null ? `of ${litresLabel(targets.waterMl)} L` : undefined}
          style={styles.stat}
        />
      </View>
      <AppText variant="caption" color={colors.textFaint} style={styles.footnote} tabular>
        Counts your {data.kcal.daysLogged} logged {data.kcal.daysLogged === 1 ? 'day' : 'days'} only.
        In target = within 10% of your calorie goal; a protein hit = 90% or more of your protein
        goal.
      </AppText>
    </View>
  );
}
