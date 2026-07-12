import { StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import type { CoachWorkoutRow } from '../../../lib/api/client';
import { AppText, PressableScale, SectionLabel, UpgradePrompt } from '../../../components/ui';
import type { CoachWorkoutsSection as CoachWorkoutsState } from '../coachWorkouts';

/**
 * Train tab's "From your coach" section (SCALE-UP-PLAN §4.3/§5.1), rendered
 * above the plan switcher. Four states: hidden (nothing to show yet),
 * locked (below silver — sell the tier), no-coach (silver+ but unassigned —
 * point at the directory), ready (list the coach's active workouts, each
 * with a one-tap Start pill).
 */

const styles = StyleSheet.create({
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },
  hintText: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },
  rowGap: { marginTop: spacing.sm },
  rowInfo: { flex: 1, minWidth: 0 },
  startPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: touch.min,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.lg,
  },
  emptyCaption: { marginTop: spacing.sm },
});

interface Props {
  section: CoachWorkoutsState;
  onStart: (workout: CoachWorkoutRow) => void;
}

export function CoachWorkoutsSection({ section, onStart }: Props) {
  if (section.kind === 'hidden') return null;

  if (section.kind === 'locked') {
    return (
      <View>
        <SectionLabel>From your coach</SectionLabel>
        <UpgradePrompt
          title="Coach-assigned workouts"
          description="Get programs built for you, assigned right to your Train tab."
          requiredTier={section.requiredTier}
        />
      </View>
    );
  }

  if (section.kind === 'no-coach') {
    return (
      <View>
        <SectionLabel>From your coach</SectionLabel>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Get a coach for a personalized program"
          onPress={() => router.push('/coaches' as Href)}
          style={styles.hint}
        >
          <Ionicons name="person-add-outline" size={20} color={colors.textDim} />
          <View style={styles.hintText}>
            <AppText variant="bodyBold">Get a coach</AppText>
            <AppText variant="caption" color={colors.textDim}>
              A coach can build and assign you a personal program.
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </PressableScale>
      </View>
    );
  }

  const { workouts, coach } = section;

  return (
    <View>
      <SectionLabel>From your coach</SectionLabel>
      {workouts.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.emptyCaption}>
          {`${coach.displayName} hasn't assigned you a workout yet.`}
        </AppText>
      ) : (
        workouts.map((w, i) => (
          <View key={w.id} style={i > 0 ? styles.rowGap : undefined}>
            <View style={styles.row}>
              <View style={styles.rowInfo}>
                <AppText variant="bodyBold" numberOfLines={1}>
                  {w.title}
                </AppText>
                <AppText variant="caption" color={colors.textDim} tabular>
                  {`${w.items.length} ${w.items.length === 1 ? 'exercise' : 'exercises'} · ${coach.displayName}`}
                </AppText>
              </View>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Start ${w.title}`}
                onPress={() => onStart(w)}
                style={styles.startPill}
              >
                <Ionicons name="play" size={14} color={colors.text} />
                <AppText variant="label" color={colors.text}>
                  Start
                </AppText>
              </PressableScale>
            </View>
          </View>
        ))
      )}
    </View>
  );
}
