import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { unitLabel } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AnimatedNumber, AppText, Button, enterUp, HeroCard } from '../../../components/ui';
import { useProfile } from '../../../state/profile';
import { useWeights } from '../hooks';
import { directionIcon, rateLabel, toHref, weightChartData, weightHeadline } from '../logic';
import { GoalProjectionCard } from './GoalProjectionCard';
import { WeightChart } from './WeightChart';

/**
 * Trend-first weight: the hero is the SMOOTHED trend, not this morning's
 * scale number. Direction arrow stays textDim always — whether up is good
 * depends on the goal, and we don't judge. Under the chart: the blueprint §02
 * goal projection (weeks to target at the current rate).
 */

const styles = StyleSheet.create({
  // Screen + chips row already give ~24px above; lg keeps total air in the
  // 16–24 band instead of the old 32px dead zone.
  hero: { marginTop: spacing.lg },
  heroValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  direction: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chartCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cta: { marginTop: spacing.xl },
});

export function WeightSection() {
  const unitPref = useProfile((s) => s.unitPref);
  const weights = useWeights();
  if (weights === null) return null;

  const { raw, trend } = weightChartData(weights, unitPref);
  const headline = weightHeadline(weights, unitPref);
  const unit = unitLabel(unitPref);

  return (
    <View>
      <Animated.View entering={enterUp(0)}>
        <HeroCard style={styles.hero}>
          <AppText variant="label">Trend weight</AppText>
          <View style={styles.heroValueRow}>
            {headline.trendValue !== null ? (
              <AnimatedNumber value={headline.trendValue} decimals={1} variant="stat" />
            ) : (
              <AppText variant="stat" color={colors.textDim}>
                —
              </AppText>
            )}
            <AppText variant="caption">{unit}</AppText>
          </View>
          <View style={styles.direction}>
            <Ionicons
              name={directionIcon(headline.summary.direction)}
              size={18}
              color={colors.textDim}
            />
            <AppText variant="caption">{rateLabel(headline.summary, unitPref)}</AppText>
          </View>
        </HeroCard>
      </Animated.View>

      <Animated.View entering={enterUp(1)} style={styles.chartCard}>
        <WeightChart raw={raw} trend={trend} height={200} emptyLabel="Log your first weigh-in" />
      </Animated.View>

      <Animated.View entering={enterUp(2)}>
        <GoalProjectionCard
          trendKg={headline.trendKg}
          ratePerWeekKg={headline.summary.ratePerWeekKg}
        />
      </Animated.View>

      <Animated.View entering={enterUp(3)}>
        <Button
          label="Log weight"
          onPress={() => router.push(toHref('/body/log-weight'))}
          style={styles.cta}
        />
      </Animated.View>
    </View>
  );
}
