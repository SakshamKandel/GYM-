import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import {
  displayWeight,
  gmWeeklyAdjustment,
  hasEntitlement,
  smoothWeights,
  trendSummary,
  unitLabel,
} from '@gym/shared';
import { colors, spacing } from '@gym/ui-tokens';
import {
  AnimatedNumber,
  AppText,
  Button,
  enterFade,
  enterUp,
  HeroCard,
  UpgradePrompt,
} from '../../../components/ui';
import { addDays, todayIso } from '../../../lib/dates';
import { getRepo } from '../../../lib/repo';
import { useProfile } from '../../../state/profile';

/**
 * GM weekly check-in (Feature Blueprint §01, Gold's adaptive progression).
 * Renders only when there's a real trend to act on: ≥5 weigh-ins in the last
 * 14 days. Gold users who are due (never ran, or ≥7 days ago) get the
 * check-in hero; after running it shows the coach's reason + kcal delta.
 * Non-gold users with enough data see the upgrade teaser instead.
 */

const MIN_WEIGH_INS = 5;
const WINDOW_DAYS = 14;
const DUE_AFTER_DAYS = 7;

interface TrendState {
  /** Latest smoothed bodyweight, kg. */
  latestTrendKg: number;
  /** Smoothed rate of change, kg per week (signed). */
  ratePerWeekKg: number;
}

interface CheckInResult {
  reason: string;
  /** newKcal − previous target (signed; 0 = held steady). */
  deltaKcal: number;
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  numRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  tightUp: { marginTop: -spacing.sm },
});

/** Mounts at 0 then sweeps to `delta`, so the result line visibly counts up. */
function DeltaCountUp({ delta }: { delta: number }) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setValue(delta));
    return () => cancelAnimationFrame(raf);
  }, [delta]);
  return <AnimatedNumber value={value} variant="display" />;
}

export function WeeklyCheckIn({ stagger = 0 }: { stagger?: number }) {
  const tier = useProfile((s) => s.tier);
  const goalType = useProfile((s) => s.goalType);
  const targets = useProfile((s) => s.targets);
  const baseKcal = useProfile((s) => s.baseKcal);
  const lastCheckInDate = useProfile((s) => s.lastCheckInDate);
  const unitPref = useProfile((s) => s.unitPref);
  const update = useProfile((s) => s.update);

  const [trend, setTrend] = useState<TrendState | null>(null);
  const [result, setResult] = useState<CheckInResult | null>(null);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void (async () => {
        const repo = await getRepo();
        const weights = await repo.getWeights(WINDOW_DAYS);
        const cutoff = addDays(todayIso(), -WINDOW_DAYS);
        const recent = weights.filter((w) => w.date >= cutoff);
        if (!mounted) return;
        if (recent.length < MIN_WEIGH_INS) {
          setTrend(null);
          return;
        }
        const points = smoothWeights(recent.map((w) => ({ date: w.date, kg: w.kg })));
        const latest = points[points.length - 1];
        if (latest === undefined) {
          setTrend(null);
          return;
        }
        setTrend({
          latestTrendKg: latest.trendKg,
          ratePerWeekKg: trendSummary(points).ratePerWeekKg,
        });
      })();
      return () => {
        mounted = false;
      };
    }, []),
  );

  const runCheckIn = () => {
    if (trend === null || goalType === null) return;
    const anchor = baseKcal ?? targets.kcal;
    const adj = gmWeeklyAdjustment({
      goal: goalType,
      bodyweightKg: trend.latestTrendKg,
      trendRatePerWeekKg: trend.ratePerWeekKg,
      currentKcal: targets.kcal,
      baseKcal: anchor,
    });
    if (adj.changed) {
      // Keep protein & fat, refill carbs from what's left of the new budget.
      const carbs = Math.max(
        0,
        Math.floor((adj.newKcal - 4 * targets.protein - 9 * targets.fat) / 4),
      );
      update({
        targets: { ...targets, kcal: adj.newKcal, carbs },
        lastCheckInDate: todayIso(),
        baseKcal: anchor,
      });
    } else {
      update({ lastCheckInDate: todayIso(), baseKcal: anchor });
    }
    setResult({ reason: adj.reason, deltaKcal: adj.newKcal - targets.kcal });
  };

  // No trend worth acting on → nothing renders (no nagging).
  if (trend === null) return null;

  if (!hasEntitlement({ tier }, 'adaptive_progression')) {
    return (
      <Animated.View entering={enterUp(stagger)} style={styles.wrap}>
        <UpgradePrompt
          requiredTier="gold"
          title="GM weekly check-in"
          description="Your calories adjust to your real weekly trend — automatically."
        />
      </Animated.View>
    );
  }

  if (goalType === null) return null;

  const unit = unitLabel(unitPref);

  if (result !== null) {
    return (
      <Animated.View entering={enterUp(stagger)} style={styles.wrap}>
        <HeroCard>
          <AppText variant="label">GM weekly check-in</AppText>
          <Animated.View entering={enterFade(0)}>
            <View style={styles.numRow}>
              {result.deltaKcal > 0 ? <AppText variant="display">+</AppText> : null}
              <DeltaCountUp delta={result.deltaKcal} />
              <AppText variant="caption">kcal/day</AppText>
            </View>
            <AppText variant="caption" color={colors.textDim}>
              {result.reason}
            </AppText>
          </Animated.View>
        </HeroCard>
      </Animated.View>
    );
  }

  const due =
    lastCheckInDate === null || lastCheckInDate <= addDays(todayIso(), -DUE_AFTER_DAYS);
  if (!due) return null;

  const rate = displayWeight(trend.ratePerWeekKg, unitPref);

  return (
    <Animated.View entering={enterUp(stagger)} style={styles.wrap}>
      <HeroCard>
        <AppText variant="label">GM weekly check-in</AppText>
        <View style={styles.numRow}>
          {rate > 0 ? <AppText variant="display">+</AppText> : null}
          <AnimatedNumber value={rate} decimals={1} variant="display" />
          <AppText variant="caption">{`${unit}/week`}</AppText>
        </View>
        <AppText variant="caption" color={colors.textDim} style={styles.tightUp}>
          Your trend this week
        </AppText>
        <Button label="Run check-in" onPress={runCheckIn} />
      </HeroCard>
    </Animated.View>
  );
}
