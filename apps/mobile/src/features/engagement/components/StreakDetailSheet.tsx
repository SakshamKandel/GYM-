import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, spacing } from '@gym/ui-tokens';
import {
  AnimatedNumber,
  AppText,
  SectionLabel,
  StatBlock,
  StreakFlame,
} from '../../../components/ui';
import { addDays, dayLabel, lastNDays, todayIso } from '../../../lib/dates';
import { getRepo } from '../../../lib/repo';
import type { WeeklyStreakData } from '../../streak/hooks';

/**
 * Rich detail for the home streak chip, shown inside a <Sheet>. Celebrates the
 * current WEEKLY streak count (Oswald count-up), this week's progress toward
 * the target, Rest Shield status (paid tiers), the personal best, and a 7-day
 * activity strip. All movement is either user-driven (the sheet itself) or a
 * quiet fade (dots settling in) — passive content never slides.
 */

const EASE_OUT = Easing.bezier(0.25, 0.8, 0.4, 1);
const WEEK_DAYS = 7;

export function StreakDetailSheet({ streak }: { streak: WeeklyStreakData }) {
  const reduceMotion = useReducedMotion();
  const today = todayIso();
  const alive = streak.weeks > 0 || streak.thisWeekDays > 0;
  const tint = alive ? colors.accent : colors.textDim;

  // Count up from zero on open; land immediately when motion is reduced.
  const [count, setCount] = useState(reduceMotion ? streak.weeks : 0);
  useEffect(() => {
    if (reduceMotion) return;
    const id = requestAnimationFrame(() => setCount(streak.weeks));
    return () => cancelAnimationFrame(id);
  }, [streak.weeks, reduceMotion]);

  // Which of the last 7 dates had a finished workout. null = still loading.
  const week = lastNDays(WEEK_DAYS, today);
  const [activeSet, setActiveSet] = useState<Set<string> | null>(null);
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const repo = await getRepo();
      const fromIso = addDays(today, -(WEEK_DAYS - 1));
      const workouts = await repo.getWorkoutsBetween(fromIso, today);
      const done = new Set(
        workouts.filter((w) => w.finishedAt !== null).map((w) => w.date),
      );
      if (mounted) setActiveSet(done);
    })();
    return () => {
      mounted = false;
    };
  }, [today]);

  const onTrack = streak.thisWeekDays >= streak.weeklyTarget;
  const statusText = onTrack
    ? "This week's in the bag — keep it burning."
    : "You're on a roll — keep it burning.";

  const unit = streak.weeks === 1 ? 'Week' : 'Weeks';
  const thisWeekText = `${streak.thisWeekDays} of ${streak.weeklyTarget} this week`;

  const shieldText =
    streak.shields !== null && streak.shields.quota > 0
      ? `${streak.shields.remaining} shield${streak.shields.remaining === 1 ? '' : 's'} left this month`
      : null;

  return (
    <View>
      <View
        style={styles.hero}
        accessible
        accessibilityLabel={`Current streak: ${streak.weeks} ${
          streak.weeks === 1 ? 'week' : 'weeks'
        }. ${thisWeekText}. ${statusText}`}
      >
        <StreakFlame active={alive} size={56} />
        <View style={styles.heroNum}>
          <AnimatedNumber value={count} variant="display" color={tint} />
          <AppText variant="label" style={styles.heroUnit}>
            {unit}
          </AppText>
        </View>
      </View>

      <AppText variant="body" color={colors.textDim} style={styles.status}>
        {statusText}
      </AppText>

      <View style={styles.gracePill} accessible accessibilityLabel={thisWeekText}>
        <Ionicons name="calendar-outline" size={16} color={colors.textDim} />
        <AppText variant="body" color={colors.textDim} style={styles.graceText}>
          {thisWeekText}
        </AppText>
      </View>

      {shieldText ? (
        <View style={styles.gracePill} accessible accessibilityLabel={shieldText}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.textDim} />
          <AppText variant="body" color={colors.textDim} style={styles.graceText}>
            {shieldText}
          </AppText>
        </View>
      ) : null}

      <View style={styles.statRow}>
        <StatBlock
          label="Best"
          value={streak.bestWeeks}
          unit={streak.bestWeeks === 1 ? 'week' : 'weeks'}
          size="display"
          style={styles.statHalf}
        />
        <View style={styles.statHalf}>
          <AppText variant="label" numberOfLines={1}>
            Weekly target
          </AppText>
          <AppText variant="title" numberOfLines={1} style={styles.lastVal}>
            {streak.weeklyTarget} days
          </AppText>
        </View>
      </View>

      <SectionLabel>Last 7 days</SectionLabel>
      <View style={styles.strip}>
        {week.map((iso) => (
          <DayDot
            key={iso}
            iso={iso}
            filled={activeSet?.has(iso) ?? false}
            isToday={iso === today}
            loading={activeSet === null}
          />
        ))}
      </View>
    </View>
  );
}

/** One weekday in the activity strip: letter + a dot that fades to filled. */
function DayDot({
  iso,
  filled,
  isToday,
  loading,
}: {
  iso: string;
  filled: boolean;
  isToday: boolean;
  loading: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const fill = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (loading || !filled) {
      fill.value = 0;
      return;
    }
    fill.value = reduceMotion ? 1 : withTiming(1, { duration: 260, easing: EASE_OUT });
  }, [filled, loading, reduceMotion, fill]);

  const fillStyle = useAnimatedStyle(() => ({ opacity: fill.value }));

  return (
    <View
      style={styles.dayCell}
      accessible
      accessibilityLabel={`${dayLabel(iso)}${isToday ? ', today' : ''}, ${
        filled ? 'workout done' : 'rest day'
      }`}
    >
      <AppText variant="label" color={isToday ? colors.text : colors.textDim}>
        {dayLabel(iso).charAt(0)}
      </AppText>
      <View style={[styles.dotRing, isToday ? styles.dotRingToday : null]}>
        <View style={styles.dotBase}>
          <Animated.View style={[styles.dotFill, fillStyle]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  heroNum: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  heroUnit: {
    marginBottom: 2,
  },
  status: {
    marginTop: spacing.sm,
  },
  gracePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    minHeight: 32,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  graceText: {
    flexShrink: 1,
  },
  // Hairline-free rhythm (brief §10): whitespace separates the stat band
  // where a Divider used to sit.
  statRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.lg,
    marginTop: spacing.xl,
  },
  statHalf: {
    flex: 1,
    minWidth: 0,
  },
  lastVal: {
    marginTop: spacing.xs,
  },
  strip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dayCell: {
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 32,
  },
  dotRing: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotRingToday: {
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  dotBase: {
    width: 12,
    height: 12,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  dotFill: {
    // Inset by the base border width so the solid dot fully covers the hollow
    // outline (an absolute inset:0 child would sit inside the 1.5px border).
    position: 'absolute',
    top: -1.5,
    left: -1.5,
    right: -1.5,
    bottom: -1.5,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
});
