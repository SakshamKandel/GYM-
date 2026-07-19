import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import type { SetLog, UnitPref } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, enterUp, layoutSpring, PressableScale } from '../../../components/ui';
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
  /** Long-press a logged set to open its edit/delete sheet. */
  onEditSet?: (set: SetLog) => void;
  /** Swap this exercise for a different one — only offered before any set is logged. */
  onSwap?: () => void;
}

const styles = StyleSheet.create({
  root: { marginBottom: spacing.lg },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
  },
  header: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  marker: {
    width: 4,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  markerOff: { backgroundColor: 'transparent' },
  titleWrap: { flex: 1 },
  swapBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Rounded set rows separated by gaps — no hairlines in the block language. */
  rows: { gap: spacing.xs },
});

export function ExerciseSection({
  exercise,
  isCurrent,
  flashSetId,
  unitPref,
  onSelect,
  onFlashDone,
  onEditSet,
  onSwap,
}: Props) {
  const loggedCount = exercise.loggedSets.length;
  const rowCount = Math.max(exercise.targetSets, loggedCount + (isCurrent ? 1 : 0));
  const currentSetNo = loggedCount + 1;
  // Swapping only makes sense before this slot has any history — once a set
  // is logged the identity is locked in for the rest of the workout.
  const canSwap = onSwap != null && loggedCount === 0;

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${exercise.exerciseName}. ${loggedCount} of ${exercise.targetSets} sets logged. Tap to log this exercise.`}
          accessibilityState={{ selected: isCurrent }}
          onPress={onSelect}
          pressScale={0.98}
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
        </PressableScale>
        {canSwap ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Swap ${exercise.exerciseName} for a different exercise`}
            onPress={onSwap}
            style={styles.swapBtn}
          >
            <Ionicons name="swap-horizontal" size={20} color={colors.textDim} />
          </PressableScale>
        ) : null}
      </View>
      <View style={styles.rows}>
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
                onEdit={onEditSet && logged ? () => onEditSet(logged) : null}
              />
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}
