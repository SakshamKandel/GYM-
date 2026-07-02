import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { UnitPref } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, enterUp, layoutSpring } from '../../../components/ui';
import { ghostTarget } from '../logic';
import type { SessionExercise } from '../session';
import { SetRow } from './SetRow';

/**
 * One exercise block in the logger: title + equipment caption + set rows.
 * Tapping the header makes it the current exercise (the editor follows).
 */

interface Props {
  exercise: SessionExercise;
  isCurrent: boolean;
  flashSetId: string | null;
  unitPref: UnitPref;
  onSelect: () => void;
  onFlashDone: () => void;
}

const styles = StyleSheet.create({
  root: { marginBottom: spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 48,
  },
  marker: {
    width: 4,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  markerOff: { backgroundColor: 'transparent' },
  titleWrap: { flex: 1 },
});

export function ExerciseSection({
  exercise,
  isCurrent,
  flashSetId,
  unitPref,
  onSelect,
  onFlashDone,
}: Props) {
  const loggedCount = exercise.loggedSets.length;
  const rowCount = Math.max(exercise.targetSets, loggedCount + (isCurrent ? 1 : 0));
  const currentSetNo = loggedCount + 1;

  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${exercise.exerciseName}. ${loggedCount} of ${exercise.targetSets} sets logged. Tap to log this exercise.`}
        accessibilityState={{ selected: isCurrent }}
        onPress={onSelect}
        style={styles.header}
      >
        <View style={[styles.marker, !isCurrent && styles.markerOff]} />
        <View style={styles.titleWrap}>
          <AppText variant="title" numberOfLines={1}>
            {exercise.exerciseName}
          </AppText>
          <AppText variant="caption" color={colors.textDim}>
            {`${exercise.equipment ?? 'bodyweight'} · ${loggedCount}/${exercise.targetSets} sets`}
          </AppText>
        </View>
      </Pressable>
      {Array.from({ length: rowCount }, (_, i) => {
        const setNo = i + 1;
        const logged = exercise.loggedSets[i] ?? null;
        return (
          // entering + layout so rows added past the target visibly insert.
          <Animated.View key={setNo} entering={enterUp(0)} layout={layoutSpring}>
            <SetRow
              setNo={setNo}
              repRange={exercise.repRange}
              logged={logged}
              ghost={ghostTarget(exercise.lastSets, setNo)}
              isCurrent={isCurrent && logged === null && setNo === currentSetNo}
              flash={logged !== null && flashSetId === logged.id}
              onFlashDone={onFlashDone}
              unitPref={unitPref}
            />
          </Animated.View>
        );
      })}
    </View>
  );
}
