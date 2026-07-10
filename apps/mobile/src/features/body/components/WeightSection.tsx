import { useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { unitLabel } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import {
  AITipCard,
  AnimatedNumber,
  AppText,
  Button,
  enterUp,
  HeroCard,
  PressableScale,
  Sheet,
} from '../../../components/ui';
import { useAiTip } from '../../../lib/ai/useAiTip';
import { useProfile } from '../../../state/profile';
import { useWeights } from '../hooks';
import { directionIcon, rateLabel, toHref, weightChartData, weightHeadline } from '../logic';
import { GoalProjectionCard } from './GoalProjectionCard';
import { WeightChart } from './WeightChart';
import { WeightHistorySheet } from './WeightHistorySheet';

/** Days shown in the trend window — matches weightChartData's default. */
const WINDOW_DAYS = 30;

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
  // Borderless charcoal card — separation by fill contrast (REVAMP-BRIEF §1).
  chartCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  cta: { marginTop: spacing.xl },
  tipCard: { marginTop: spacing.lg },
});

export function WeightSection() {
  const unitPref = useProfile((s) => s.unitPref);
  const goalType = useProfile((s) => s.goalType);
  const targetWeightKg = useProfile((s) => s.targetWeightKg);
  const weights = useWeights();

  // Derive from an empty list while weights are still loading (null) so EVERY
  // hook below — including useAiTip — runs on every render. (Calling a hook
  // after an early `return null` is a Rules-of-Hooks violation and crashes the
  // Progress tab the moment weights load.) The real early return happens after
  // all hooks, below.
  const list = weights ?? [];
  const { raw, trend } = weightChartData(list, unitPref);
  const headline = weightHeadline(list, unitPref);
  const unit = unitLabel(unitPref);
  const [historyOpen, setHistoryOpen] = useState(false);

  const { state: tipState, refresh } = useAiTip(() => {
    const trendVal = headline.trendValue;
    const rate = headline.summary.ratePerWeekKg;
    const direction = headline.summary.direction;
    const goal = goalType ?? 'muscle';
    const target = targetWeightKg
      ? `${(targetWeightKg).toFixed(1)} kg`
      : 'not set';

    return [
      {
        role: 'system' as const,
        content:
          'You are a friendly gym coach giving a single short weight-management tip. Keep it under 40 words. Be practical and encouraging. No medical advice. No disclaimers. Just the tip.',
      },
      {
        role: 'user' as const,
        content: `Current trend weight: ${trendVal ?? 'unknown'} ${unit}. Rate: ${rate.toFixed(2)} kg/week (${direction}). Goal: ${goal}. Target weight: ${target}. Give one actionable tip to help reach the target weight.`,
      },
    ];
  }, [headline.trendValue, headline.summary.ratePerWeekKg, goalType, targetWeightKg, unitPref]);

  // Safe now: all hooks above ran unconditionally.
  if (weights === null) return null;

  return (
    <View>
      <Animated.View entering={enterUp(0)}>
        {/* Charcoal, not red: Progress already has its one red hero (the
            monthly-pace block) and this card's ink is white-on-dark. */}
        <HeroCard variant="charcoal" style={styles.hero}>
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

      <Animated.View entering={enterUp(1)}>
        {raw.length > 0 ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="View weight history"
            accessibilityHint="Opens recent weigh-ins and the change over time"
            onPress={() => setHistoryOpen(true)}
            style={styles.chartCard}
          >
            <View style={styles.chartHeader}>
              <AppText variant="label">Last {WINDOW_DAYS} days</AppText>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </View>
            <WeightChart raw={raw} trend={trend} height={200} emptyLabel="Log your first weigh-in" />
          </PressableScale>
        ) : (
          <View style={styles.chartCard}>
            <WeightChart raw={raw} trend={trend} height={200} emptyLabel="Log your first weigh-in" />
          </View>
        )}
      </Animated.View>

      <Animated.View entering={enterUp(2)}>
        <GoalProjectionCard
          trendKg={headline.trendKg}
          ratePerWeekKg={headline.summary.ratePerWeekKg}
        />
      </Animated.View>

      <Animated.View entering={enterUp(3)} style={styles.tipCard}>
        <AITipCard
          title="Coach tip"
          tip={tipState.status === 'done' ? tipState.text : null}
          loading={tipState.status === 'loading' || tipState.status === 'idle'}
          error={tipState.status === 'error'}
          onRefresh={refresh}
        />
      </Animated.View>

      <Animated.View entering={enterUp(4)}>
        <Button
          label="Log weight"
          onPress={() => router.push(toHref('/body/log-weight'))}
          style={styles.cta}
        />
      </Animated.View>

      <Sheet visible={historyOpen} onClose={() => setHistoryOpen(false)} title="Weight history">
        <WeightHistorySheet points={raw} unit={unit} windowDays={WINDOW_DAYS} />
      </Sheet>
    </View>
  );
}
