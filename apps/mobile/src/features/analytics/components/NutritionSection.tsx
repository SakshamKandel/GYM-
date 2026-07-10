import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, Card, EmptyState, SectionLabel, StatBlock } from '../../../components/ui';
import { todayIso } from '../../../lib/dates';
import { useProfile } from '../../../state/profile';
import type { NutritionTrendData } from '../hooks';
import { litresLabel } from '../logic';
import { KcalChart } from './KcalChart';

/**
 * Two-week nutrition trends: calories vs target, adherence and protein hit
 * rates, average water. Adherence-neutral throughout — over target is a fact,
 * not a failure. Block language: borderless charcoal blocks, stats inside.
 */

interface Props {
  data: NutritionTrendData;
}

const styles = StyleSheet.create({
  caption: { marginTop: spacing.md },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.xl },
  stat: { width: '50%' },
  footnote: { marginTop: spacing.lg },
});

export function NutritionSection({ data }: Props) {
  const targets = useProfile((s) => s.targets);

  if (data.kcal.daysLogged === 0) {
    return (
      <EmptyState
        icon="restaurant-outline"
        title="No food logged yet"
        body="Log a few days of food and your two-week trends land here."
        actionLabel="Log a meal"
        onAction={() => router.push('/(tabs)/food')}
      />
    );
  }

  return (
    <View>
      <SectionLabel>Calories, last 14 days</SectionLabel>
      <Card>
        <KcalChart days={data.days} targetKcal={targets.kcal} today={todayIso()} />
        <AppText variant="caption" color={colors.textDim} style={styles.caption}>
          The dashed line is your {targets.kcal} kcal target. Empty slots are unlogged days.
        </AppText>
      </Card>

      <SectionLabel>Adherence</SectionLabel>
      <Card>
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
      </Card>
      <AppText variant="caption" color={colors.textFaint} style={styles.footnote} tabular>
        Counts your {data.kcal.daysLogged} logged {data.kcal.daysLogged === 1 ? 'day' : 'days'} only.
        In target = within 10% of your calorie goal; a protein hit = 90% or more of your protein
        goal.
      </AppText>
    </View>
  );
}
