import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Button, ProgressBar } from '../../../components/ui';
import {
  cancelFirstWorkoutsReminder,
  scheduleFirstWorkoutsReminder,
} from '../../../lib/notifications';
import { questScopeId, questStateFor, useQuest } from '../../../state/quest';
import { useAuth } from '../../../state/auth';
import { toHref } from '../logic';
import type { QuestProgress } from '../logic';

/**
 * Activation card: points a brand-new user at workout #3. A CREAM counterpoint
 * block (REVAMP-BRIEF §2) — black ink on paper, Newie mascot, a three-segment
 * mini progress row, a coach line that changes with progress, and a single
 * black pill CTA. When all three are done it shows a one-time "habit locked
 * in" state the user can dismiss; when expired or dismissed it renders nothing.
 *
 * Schedules ONE gentle local reminder (~3 days out) the first time it mounts
 * while incomplete, and cancels it the moment the quest is complete.
 */

/** Days out for the single gentle nudge. */
const REMINDER_DAYS = 3;
const REMINDER_TITLE = 'Your first 3 workouts';
const REMINDER_BODY = "Newie's waiting — get your next one in and lock the habit.";

const styles = StyleSheet.create({
  // Cream color block: chunky radius, flat fill, NO border (brief §1/§3).
  card: {
    borderRadius: radius.block,
    backgroundColor: colors.blockCream,
    padding: spacing.gutter,
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
  segment: { flex: 1 },
});

/** Coach line that escalates as the user closes in on the goal. */
function coachLine(done: number): string {
  if (done <= 0) return "Let's get the first one in.";
  if (done === 1) return 'Nice start — two more to make it stick.';
  return "One more and it's a habit.";
}

export function FirstWorkoutsQuest({ progress }: { progress: QuestProgress }) {
  const accountId = useAuth((state) => state.user?.id ?? null);
  const scope = questScopeId(accountId);
  const reminderScheduled = useQuest((state) => questStateFor(state, accountId).reminderScheduled);
  const setReminderScheduled = useQuest((s) => s.setReminderScheduled);
  const setDismissed = useQuest((s) => s.setDismissed);

  const { done, goal, complete } = progress;

  // Schedule the single nudge once (only while still working toward the goal).
  const askedScopeRef = useRef<string | null>(null);
  const askedRef = useRef(false);
  useEffect(() => {
    if (askedScopeRef.current !== scope) {
      askedScopeRef.current = scope;
      askedRef.current = false;
    }
    if (complete || reminderScheduled || askedRef.current) return;
    askedRef.current = true;
    void (async () => {
      await scheduleFirstWorkoutsReminder(REMINDER_DAYS, REMINDER_TITLE, REMINDER_BODY);
      // Mark scheduled whether or not permission was granted, so we prompt at
      // most once — a declined user is never re-nagged for permission.
      setReminderScheduled(accountId, true);
    })();
  }, [accountId, complete, reminderScheduled, scope, setReminderScheduled]);

  // Once complete, cancel any pending reminder — the nudge is no longer needed.
  useEffect(() => {
    if (complete) void cancelFirstWorkoutsReminder();
  }, [complete]);

  const startWorkout = useCallback(() => {
    router.push(toHref('/(tabs)/train'));
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(accountId, true);
  }, [accountId, setDismissed]);

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
          <AppText variant="label" color={colors.creamDim}>
            {complete ? 'Quest complete' : 'Your first 3 workouts'}
          </AppText>
          <AppText variant="title" color={colors.onBlock}>
            {complete ? 'Habit locked in. 💪' : coachLine(done)}
          </AppText>
        </View>
      </View>

      {/* Three mini bars — black fill sweeps once per earned segment; the
          rgba track is the sanctioned progress-track-on-colored-block use. */}
      <View style={styles.pills} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Array.from({ length: goal }, (_, i) => (
          <ProgressBar
            key={i}
            value={i < done ? 1 : 0}
            height={8}
            trackColor="rgba(0,0,0,0.15)"
            fillColor={colors.onBlock}
            style={styles.segment}
          />
        ))}
      </View>

      {complete ? (
        <Button label="Nice work" variant="onBlock" onPress={dismiss} />
      ) : (
        <Button label="Start workout" variant="onBlock" onPress={startWorkout} />
      )}
    </View>
  );
}
