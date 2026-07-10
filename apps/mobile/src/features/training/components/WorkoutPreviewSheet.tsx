import { ScrollView, StyleSheet, View } from 'react-native';
import type { PlanWorkout } from '@gym/shared';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import { AppText, Button, SectionLabel, StatBlock } from '../../../components/ui';
import { getExercise } from '../../../lib/exercises';
import { estimateWorkoutMinutes } from '../logic';

/**
 * Peek at a plan workout before committing: a compact exercises · sets · time
 * stat tile, the movement list as gapped rounded rows (no hairlines — block
 * language), and one primary "Start workout". Rendered inside <Sheet>, so all
 * movement belongs to the sheet itself — the content here is passive and static.
 */

interface Props {
  workout: PlanWorkout;
  onStart: () => void;
}

const styles = StyleSheet.create({
  // flexShrink lets the sheet's 88% height cap compress the scroll area on
  // small phones instead of pushing "Start workout" off-screen.
  body: { flexShrink: 1 },
  // Inner tile inside the sheet block — nested elements take radius.md.
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  statCol: { flex: 1, minWidth: 0 },
  /** Gapped rounded rows — replaces Divider hairlines. */
  list: { gap: spacing.sm },
  exRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 56,
  },
  numBlock: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numText: { fontFamily: type.display, fontSize: 15, color: colors.textDim },
  exText: { flex: 1, minWidth: 0 },
  exNumbers: {
    fontFamily: type.display,
    fontSize: 18,
    color: colors.text,
    flexShrink: 0,
  },
  startBtn: { marginTop: spacing.lg },
});

export function WorkoutPreviewSheet({ workout, onStart }: Props) {
  const totalSets = workout.exercises.reduce((n, e) => n + e.sets, 0);
  const minutes = estimateWorkoutMinutes(workout);

  return (
    <View style={styles.body}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.statsRow}>
          <StatBlock label="exercises" value={workout.exercises.length} align="center" style={styles.statCol} />
          <StatBlock label="sets" value={totalSets} align="center" style={styles.statCol} />
          <StatBlock label="est. min" value={`~${minutes}`} align="center" style={styles.statCol} />
        </View>

        <SectionLabel>Exercises</SectionLabel>
        <View style={styles.list}>
          {workout.exercises.map((e, i) => {
            const info = getExercise(e.exerciseId);
            const meta = info ? `${info.muscleGroup} · ${info.equipment ?? 'bodyweight'}` : null;
            return (
              <View
                key={e.id}
                style={styles.exRow}
                accessible
                accessibilityLabel={`${e.exerciseName}, ${e.sets} sets of ${e.repRange} reps`}
              >
                <View style={styles.numBlock}>
                  <AppText style={styles.numText} tabular>
                    {i + 1}
                  </AppText>
                </View>
                <View style={styles.exText}>
                  <AppText variant="bodyBold" numberOfLines={1}>
                    {e.exerciseName}
                  </AppText>
                  {meta ? (
                    <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
                      {meta}
                    </AppText>
                  ) : null}
                </View>
                <AppText style={styles.exNumbers} tabular numberOfLines={1}>
                  {`${e.sets} × ${e.repRange}`}
                </AppText>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <Button
        label="Start workout"
        onPress={onStart}
        style={styles.startBtn}
        accessibilityLabel={`Start ${workout.name}`}
      />
    </View>
  );
}
