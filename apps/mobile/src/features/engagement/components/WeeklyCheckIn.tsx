import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import {
  displayWeight,
  gmWeeklyAdjustment,
  greeceReply,
  hasEntitlement,
  smoothWeights,
  trendSummary,
  unitLabel,
  type CheckInSignals,
  type GreeceReply,
} from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AnimatedNumber,
  AppText,
  Button,
  enterFade,
  enterUp,
  HeroCard,
  PressableScale,
  UpgradePrompt,
} from '../../../components/ui';
import { addDays, todayIso } from '../../../lib/dates';
import { successHaptic } from '../../../lib/haptics';
import { getRepo } from '../../../lib/repo';
import { useProfile } from '../../../state/profile';

/**
 * GM weekly check-in (Feature Blueprint §01, Gold's adaptive progression).
 * Renders only when there's a real trend to act on: ≥5 weigh-ins in the last
 * 14 days. Gold+ users who are due (never ran, or ≥7 days ago) get the
 * check-in hero: trend → 3 quick taps → the GM engine adjusts targets → a
 * templated-but-personal reply from Greece that references their real numbers.
 * Non-gold users with enough data see the upgrade teaser instead.
 */

const MIN_WEIGH_INS = 5;
const WINDOW_DAYS = 14;
const DUE_AFTER_DAYS = 7;
const WEEK_DAYS = 7;

interface TrendState {
  /** Latest smoothed bodyweight, kg. */
  latestTrendKg: number;
  /** Smoothed rate of change, kg per week (signed). */
  ratePerWeekKg: number;
}

/** One check-in question: a label + three option chips (values 1|2|3). */
interface Question {
  key: keyof CheckInSignals;
  label: string;
  options: [string, string, string];
}

const QUESTIONS: Question[] = [
  { key: 'energy', label: 'Energy', options: ['Low', 'Ok', 'Great'] },
  { key: 'soreness', label: 'Soreness', options: ['None', 'Some', 'Lots'] },
  { key: 'weekFeel', label: 'The week', options: ['Tough', 'Ok', 'Strong'] },
];

/** The step's local answers before they're committed on "Get Greece's reply". */
type Answers = { [K in keyof CheckInSignals]: CheckInSignals[K] | null };

const EMPTY_ANSWERS: Answers = { energy: null, soreness: null, weekFeel: null };

/** UI phase inside the hero: show the trend, ask the 3 taps, or show the reply. */
type Phase = 'due' | 'asking' | 'done';

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  numRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  tightUp: { marginTop: -spacing.sm },
  buttonTop: { marginTop: spacing.sm },
  questions: { gap: spacing.md },
  question: { gap: spacing.xs },
  optionRow: { flexDirection: 'row', gap: spacing.sm },
  // Option chips follow the interactive-chip spec (brief §6): outlined pill on
  // dark, selected = solid red fill with BLACK label. ≥48dp tap target.
  option: {
    flex: 1,
    minHeight: touch.min,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  replyLines: { gap: spacing.xs, marginTop: spacing.xs },
});

/** One question row: a label above three tappable option chips. */
function QuestionRow({
  question,
  value,
  onSelect,
}: {
  question: Question;
  value: CheckInSignals[keyof CheckInSignals] | null;
  onSelect: (v: 1 | 2 | 3) => void;
}) {
  return (
    <View style={styles.question}>
      <AppText variant="label">{question.label}</AppText>
      <View style={styles.optionRow}>
        {question.options.map((opt, i) => {
          const optValue = (i + 1) as 1 | 2 | 3;
          const selected = value === optValue;
          return (
            <PressableScale
              key={opt}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${question.label}: ${opt}`}
              onPress={() => onSelect(optValue)}
              style={[styles.option, selected && styles.optionSelected]}
            >
              <AppText
                variant="bodyBold"
                color={selected ? colors.onBlock : colors.textDim}
                tabular={false}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {opt}
              </AppText>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
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
  const [phase, setPhase] = useState<Phase>('due');
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [reply, setReply] = useState<GreeceReply | null>(null);

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

  const allAnswered =
    answers.energy !== null && answers.soreness !== null && answers.weekFeel !== null;

  const getReply = () => {
    if (trend === null || goalType === null || !allAnswered) return;
    const signals: CheckInSignals = {
      energy: answers.energy!,
      soreness: answers.soreness!,
      weekFeel: answers.weekFeel!,
    };

    // Run the GM adaptive engine — keep its exact logic + targets update.
    const anchor = baseKcal ?? targets.kcal;
    const adj = gmWeeklyAdjustment({
      goal: goalType,
      bodyweightKg: trend.latestTrendKg,
      trendRatePerWeekKg: trend.ratePerWeekKg,
      currentKcal: targets.kcal,
      baseKcal: anchor,
    });
    const deltaKcal = adj.newKcal - targets.kcal;

    void (async () => {
      // Gather the real facts for the reply while we persist the adjustment.
      const repo = await getRepo();
      const weekStart = addDays(todayIso(), -WEEK_DAYS);
      const [prs, weeklyVolumeKg] = await Promise.all([
        repo.getPrRecords(20),
        repo.getVolumeBetween(weekStart, todayIso()),
      ]);
      const weekPrs = prs.filter((p) => p.date >= weekStart);
      const topPr = weekPrs[0];
      const soreHigh = signals.soreness === 3;

      const composed = greeceReply(signals, {
        goal: goalType,
        tier,
        weeklyVolumeKg,
        prCount: weekPrs.length,
        topPr:
          topPr !== undefined
            ? { exerciseName: topPr.exerciseName, weightKg: topPr.weightKg, reps: topPr.reps }
            : undefined,
        trendRatePerWeekKg: trend.ratePerWeekKg,
        kcalDeltaFromCheckIn: deltaKcal,
        deloadSuggested: soreHigh && weeklyVolumeKg >= 10000,
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
          lastCheckInSignals: signals,
        });
      } else {
        update({
          lastCheckInDate: todayIso(),
          baseKcal: anchor,
          lastCheckInSignals: signals,
        });
      }

      setReply(composed);
      setPhase('done');
      successHaptic();
    })();
  };

  // No trend worth acting on → nothing renders (no nagging).
  if (trend === null) return null;

  if (!hasEntitlement({ tier }, 'adaptive_progression')) {
    return (
      <Animated.View entering={enterUp(stagger)} style={styles.wrap}>
        <UpgradePrompt
          requiredTier="gold"
          title="GM weekly check-in"
          description="Three taps on Sunday, then Greece adjusts your targets and writes back."
        />
      </Animated.View>
    );
  }

  if (goalType === null) return null;

  const unit = unitLabel(unitPref);

  // Reply landed — render it as a coach message.
  if (phase === 'done' && reply !== null) {
    return (
      <Animated.View entering={enterUp(stagger)} style={styles.wrap}>
        <HeroCard mascot variant="charcoal">
          <AppText variant="label">Greece's reply</AppText>
          <Animated.View entering={enterFade(0)}>
            <AppText variant="title">{reply.headline}</AppText>
            <View style={styles.replyLines}>
              {reply.lines.map((line, i) => (
                <AppText key={i} variant="body" color={colors.textDim}>
                  {line}
                </AppText>
              ))}
            </View>
            <AppText variant="label" color={colors.accent} style={styles.buttonTop}>
              {reply.signoff}
            </AppText>
          </Animated.View>
        </HeroCard>
      </Animated.View>
    );
  }

  // Asking phase — the 3 quick taps inline in the hero.
  if (phase === 'asking') {
    return (
      <Animated.View entering={enterUp(stagger)} style={styles.wrap}>
        <HeroCard variant="charcoal">
          <AppText variant="label">GM weekly check-in</AppText>
          <Animated.View entering={enterFade(0)} style={styles.questions}>
            {QUESTIONS.map((q) => (
              <QuestionRow
                key={q.key}
                question={q}
                value={answers[q.key]}
                onSelect={(v) => setAnswers((prev) => ({ ...prev, [q.key]: v }))}
              />
            ))}
            <Button
              label="Get Greece's reply"
              onPress={getReply}
              disabled={!allAnswered}
              style={styles.buttonTop}
            />
          </Animated.View>
        </HeroCard>
      </Animated.View>
    );
  }

  // Due phase — only show if the user hasn't checked in this week.
  const due =
    lastCheckInDate === null || lastCheckInDate <= addDays(todayIso(), -DUE_AFTER_DAYS);
  if (!due) return null;

  const rate = displayWeight(trend.ratePerWeekKg, unitPref);

  return (
    <Animated.View entering={enterUp(stagger)} style={styles.wrap}>
      <HeroCard variant="charcoal">
        <AppText variant="label">GM weekly check-in</AppText>
        <View style={styles.numRow}>
          {rate > 0 ? <AppText variant="display">+</AppText> : null}
          <AnimatedNumber value={rate} decimals={1} variant="display" />
          <AppText variant="caption">{`${unit}/week`}</AppText>
        </View>
        <AppText variant="caption" color={colors.textDim} style={styles.tightUp}>
          Your trend this week
        </AppText>
        <Button label="Start check-in" onPress={() => setPhase('asking')} style={styles.buttonTop} />
      </HeroCard>
    </Animated.View>
  );
}
