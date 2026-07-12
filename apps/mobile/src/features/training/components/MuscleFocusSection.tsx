import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { PlanWorkout } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, Chip, PressableScale, Tag } from '../../../components/ui';
import {
  ANATOMY_3D_ENABLED,
  Anatomy2DViewer,
  Anatomy3DViewer,
} from '../../../components/anatomy';
import { allExercises, MUSCLE_GROUPS } from '../../../lib/exercises';
import {
  isMuscleGroup,
  MUSCLE_LABELS,
  PREFERRED_SIDE,
  type MuscleGroup,
} from '../../../lib/muscleMap';
import { pushPath } from '../nav';
import type { MuscleMapSide } from '../../../lib/muscleMapData';

/**
 * Interactive workout muscle selector. Renders the shared true-3D WebGL body
 * (components/anatomy) — drag to rotate, pinch to zoom, tap a muscle — so the
 * workout section and the anatomy explorer share one rotatable model. Muscle
 * vocabulary lives in lib/muscleMap.ts.
 */

export type { MuscleGroup } from '../../../lib/muscleMap';

const styles = StyleSheet.create({
  // Borderless charcoal color-block (radius.block) — separation by fill only.
  card: {
    marginTop: spacing.md,
    paddingTop: spacing.gutter,
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  headingCopy: { flex: 1, gap: spacing.xs },
  intro: { paddingHorizontal: spacing.lg, marginTop: spacing.xs },
  // Positioning context for the 3D viewer + the Explore overlay pill.
  mapPanel: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    borderRadius: radius.block,
    overflow: 'hidden',
    position: 'relative',
  },
  /** Pill in the map's top-left → full anatomy explorer (/anatomy). */
  exploreBtn: {
    position: 'absolute',
    left: spacing.md,
    top: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touch.min,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  chipStrip: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  resultCount: { flexShrink: 0 },
  /** Rounded raised rows in a gapped stack — replaces Divider hairlines. */
  list: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 72,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.onAccent,
  },
  exerciseCopy: { flex: 1, gap: 1 },
  empty: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, gap: spacing.xs },
  allRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: touch.min,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
});

export function muscleFocusForWorkout(workout: PlanWorkout | null | undefined): MuscleGroup {
  const firstExercise = workout?.exercises[0];
  if (!firstExercise) return 'shoulders';

  const match = allExercises().find((exercise) => exercise.id === firstExercise.exerciseId)?.muscleGroup;
  return match && isMuscleGroup(match) ? match : 'shoulders';
}

function matchingExercises(muscle: MuscleGroup) {
  return allExercises()
    .filter((exercise) => exercise.muscleGroup === muscle)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function MuscleFocusSection({ initialMuscle }: { initialMuscle: MuscleGroup }) {
  const [selected, setSelected] = useState<MuscleGroup>(initialMuscle);
  const [side, setSide] = useState<MuscleMapSide>(PREFERRED_SIDE[initialMuscle]);

  const exercises = useMemo(() => matchingExercises(selected), [selected]);
  const visibleExercises = exercises.slice(0, 4);
  const label = MUSCLE_LABELS[selected];

  const selectMuscle = (muscle: MuscleGroup): void => {
    setSelected(muscle);
    setSide(PREFERRED_SIDE[muscle]);
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headingCopy}>
          <AppText variant="label">Muscle focus</AppText>
          <AppText variant="title">Pick a muscle to train</AppText>
        </View>
        <Tag label={`${exercises.length} moves`} variant="dim" />
      </View>
      <AppText variant="caption" color={colors.textDim} style={styles.intro}>
        Drag to rotate the body, pinch to zoom, or tap a muscle. Your selected area is
        highlighted in red.
      </AppText>

      <View style={styles.mapPanel}>
        {ANATOMY_3D_ENABLED ? (
          <Anatomy3DViewer
            selected={selected}
            onSelect={selectMuscle}
            side={side}
            onSideChange={setSide}
            height={340}
          />
        ) : (
          <Anatomy2DViewer
            selected={selected}
            onSelect={selectMuscle}
            side={side}
            onSideChange={setSide}
            height={340}
          />
        )}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Explore ${label} anatomy: rotate the body, read how to train it`}
          onPress={() => pushPath(`/anatomy?muscle=${encodeURIComponent(selected)}`)}
          hitSlop={{ top: 6, bottom: 6 }}
          style={styles.exploreBtn}
        >
          <Ionicons name="body-outline" size={16} color={colors.text} />
          <AppText variant="label" color={colors.text}>
            Explore
          </AppText>
        </PressableScale>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipStrip}>
        {MUSCLE_GROUPS.map((muscle) => (
          <Chip
            key={muscle}
            label={MUSCLE_LABELS[muscle]}
            selected={selected === muscle}
            onPress={() => selectMuscle(muscle)}
          />
        ))}
      </ScrollView>

      <View style={styles.listHeader}>
        <AppText variant="title">{label} exercises</AppText>
        <AppText variant="caption" color={colors.textDim} style={styles.resultCount}>
          {`${exercises.length} available`}
        </AppText>
      </View>

      {visibleExercises.length > 0 ? (
        <View style={styles.list}>
          {visibleExercises.map((exercise) => (
            <PressableScale
              key={exercise.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${exercise.name}`}
              onPress={() => pushPath(`/exercises/${exercise.id}`)}
              pressScale={0.985}
              style={styles.exerciseRow}
            >
              <Image
                source={exercise.imageUrls[0] ? { uri: exercise.imageUrls[0] } : undefined}
                style={styles.thumb}
                contentFit="contain"
                transition={100}
              />
              <View style={styles.exerciseCopy}>
                <AppText variant="bodyBold" numberOfLines={1}>
                  {exercise.name}
                </AppText>
                <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
                  {exercise.equipment ?? 'Bodyweight'}
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </PressableScale>
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <AppText variant="bodyBold">No exercises yet</AppText>
          <AppText variant="caption" color={colors.textDim}>
            Browse the library to add a movement for this area.
          </AppText>
        </View>
      )}

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`See all ${label} exercises`}
        onPress={() => pushPath(`/exercises?muscle=${encodeURIComponent(selected)}`)}
        style={styles.allRow}
      >
        <AppText variant="bodyBold" color={colors.accent}>
          {`See all ${label} exercises`}
        </AppText>
        <Ionicons name="arrow-forward" size={18} color={colors.accent} />
      </PressableScale>
    </View>
  );
}
