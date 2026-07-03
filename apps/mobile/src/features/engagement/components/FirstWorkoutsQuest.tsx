import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Button } from '../../../components/ui';
import {
  cancelFirstWorkoutsReminder,
  scheduleFirstWorkoutsReminder,
} from '../../../lib/notifications';
import { useQuest } from '../../../state/quest';
import { toHref } from '../logic';
import type { QuestProgress } from '../logic';

/**
 * Activation card: points a brand-new user at workout #3. Newie mascot,
 * a three-segment progress row, a coach line that changes with progress, and a
 * single red CTA. When all three are done it shows a one-time "habit locked in"
 * state the user can dismiss; when expired or dismissed it renders nothing.
 *
 * Schedules ONE gentle local reminder (~3 days out) the first time it mounts
 * while incomplete, and cancels it the moment the quest is complete.
 */

/** Days out for the single gentle nudge. */
const REMINDER_DAYS = 3;
const REMINDER_TITLE = 'Your first 3 workouts';
const REMINDER_BODY = "Newie's waiting — get your next one in and lock the habit.";

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  newie: { width: 60, height: 60 },
  headerText: { flex: 1, gap: 2 },
  pills: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  pill: {
    flex: 1,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  pillFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
});

const EASE_OUT = Easing.bezier(0.25, 0.8, 0.4, 1);

/** Coach line that escalates as the user closes in on the goal. */
function coachLine(done: number): string {
  if (done <= 0) return "Let's get the first one in.";
  if (done === 1) return 'Nice start — two more to make it stick.';
  return "One more and it's a habit.";
}

/**
 * One progress segment. The accent fill fades in when the segment is earned
 * (an opacity fade, so it obeys the motion philosophy for passive content) and
 * lands instantly under reduced motion.
 */
function QuestPill({ done }: { done: boolean }) {
  const reduceMotion = useReducedMotion();
  const fill = useSharedValue(done ? 1 : 0);
  useEffect(() => {
    if (!done) {
      fill.value = 0;
      return;
    }
    fill.value = reduceMotion ? 1 : withTiming(1, { duration: 320, easing: EASE_OUT });
  }, [done, reduceMotion, fill]);
  const fillStyle = useAnimatedStyle(() => ({ opacity: fill.value }));
  return (
    <View style={styles.pill}>
      <Animated.View style={[styles.pillFill, fillStyle]} />
    </View>
  );
}

export function FirstWorkoutsQuest({ progress }: { progress: QuestProgress }) {
  const reminderScheduled = useQuest((s) => s.reminderScheduled);
  const setReminderScheduled = useQuest((s) => s.setReminderScheduled);
  const setDismissed = useQuest((s) => s.setDismissed);

  const { done, goal, complete } = progress;

  // Schedule the single nudge once (only while still working toward the goal).
  const askedRef = useRef(false);
  useEffect(() => {
    if (complete || reminderScheduled || askedRef.current) return;
    askedRef.current = true;
    void (async () => {
      await scheduleFirstWorkoutsReminder(REMINDER_DAYS, REMINDER_TITLE, REMINDER_BODY);
      // Mark scheduled whether or not permission was granted, so we prompt at
      // most once — a declined user is never re-nagged for permission.
      setReminderScheduled(true);
    })();
  }, [complete, reminderScheduled, setReminderScheduled]);

  // Once complete, cancel any pending reminder — the nudge is no longer needed.
  useEffect(() => {
    if (complete) void cancelFirstWorkoutsReminder();
  }, [complete]);

  const startWorkout = useCallback(() => {
    router.push(toHref('/(tabs)/train'));
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
  }, [setDismissed]);

  return (
    <View
      style={styles.card}
      accessibilityLabel={
        complete
          ? 'Quest complete: your first 3 workouts are done'
          : `Your first 3 workouts: ${done} of ${goal} done`
      }
    >
      <View style={styles.header}>
        <Image
          source={require('../../../../assets/images/newie.png')}
          style={styles.newie}
          contentFit="contain"
          accessibilityElementsHidden
        />
        <View style={styles.headerText}>
          <AppText variant="label">
            {complete ? 'Quest complete' : 'Your first 3 workouts'}
          </AppText>
          <AppText variant="title">
            {complete ? 'Habit locked in. 💪' : coachLine(done)}
          </AppText>
        </View>
      </View>

      <View style={styles.pills} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Array.from({ length: goal }, (_, i) => (
          <QuestPill key={i} done={i < done} />
        ))}
      </View>

      {complete ? (
        <Button label="Nice work" variant="secondary" onPress={dismiss} />
      ) : (
        <Button label="Start workout" onPress={startWorkout} />
      )}
    </View>
  );
}
