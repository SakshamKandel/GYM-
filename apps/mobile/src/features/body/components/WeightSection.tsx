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
  tipNote: { marginTop: spacing.xs, paddingHorizontal: spacing.xs },
});

export function WeightSection() {
  const unitPref = useProfile((s) => s.unitPref);
  const goalType = useProfile((s) => s.goalType);
  const targetWeightKg = useProfile((s) => s.targetWeightKg);
  // Height rides along so the server can sanity-check the goal weight before
  // it coaches anyone towards it.
  const heightCm = useProfile((s) => s.heightCm);
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

  // Closed payload: numbers and enums only, never prose. The prompt itself is
  // owned by the server, so this card finally asks about WEIGHT and gets an
  // answer about weight. Facts this screen does not hold (sessions, streak)
  // stay null so the coach never guesses at them.
  const { state: tipState, refresh } = useAiTip(
    () => ({
      kind: 'weight' as const,
      context: {
        goalType: goalType ?? null,
        unitPref,
        bodyweightKg: headline.trendKg,
        goalWeightKg: targetWeightKg ?? null,
        heightCm: heightCm ?? null,
        trendDirection: headline.trendKg === null ? null : headline.summary.direction,
        ratePerWeekKg: headline.trendKg === null ? null : headline.summary.ratePerWeekKg,
        sessionsThisWeek: null,
        streakWeeks: null,
        daysSinceLastSession: null,
        weekVolumeKg: null,
        personalBestsLast30Days: null,
        trainedToday: null,
      },
    }),
    [
      headline.trendKg,
      headline.summary.ratePerWeekKg,
      headline.summary.direction,
      goalType,
      targetWeightKg,
      heightCm,
      unitPref,
    ],
  );

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
        {/* Say where the words came from, and only when they really are the
            AI coach's. Our own safety note must not be captioned as one. */}
        {tipState.status === 'done' && tipState.source === 'coach' ? (
          <AppText variant="caption" style={styles.tipNote}>
            Written by an AI coach from your training numbers.
          </AppText>
        ) : null}
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
