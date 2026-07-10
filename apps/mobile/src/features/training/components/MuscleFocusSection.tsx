import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import type { PlanWorkout } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, Chip, PressableScale, Tag } from '../../../components/ui';
import { allExercises, MUSCLE_GROUPS } from '../../../lib/exercises';
import { pushPath } from '../nav';
import { MALE_MUSCLE_MAP, MUSCLE_MAP_VIEW_BOX, type MuscleMapSide } from './muscleMapData';

/**
 * Interactive workout muscle selector. The visual paths are adapted from the
 * MIT-licensed MuscleMapJS project so they render natively on iOS, Android,
 * and web without a browser canvas or network request.
 */

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest',
  lats: 'Lats',
  'middle back': 'Middle back',
  'lower back': 'Lower back',
  shoulders: 'Shoulders',
  traps: 'Traps',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  quadriceps: 'Quadriceps',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  abdominals: 'Abdominals',
  adductors: 'Adductors',
  abductors: 'Abductors',
  neck: 'Neck',
};

/** App exercise labels map onto MuscleMapJS's anatomy names. */
const SOURCE_MUSCLES: Record<MuscleGroup, readonly string[]> = {
  chest: ['chest'],
  lats: ['upper-back'],
  // MuscleMapJS's male body model does not include a separate rhomboid path;
  // its upper-back region covers the mid-back visual area.
  'middle back': ['upper-back'],
  'lower back': ['lower-back'],
  shoulders: ['deltoids', 'rotator-cuff'],
  traps: ['trapezius'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  forearms: ['forearm'],
  quadriceps: ['quadriceps', 'hip-flexors'],
  hamstrings: ['hamstring'],
  glutes: ['gluteal'],
  calves: ['calves'],
  abdominals: ['abs', 'obliques', 'serratus'],
  adductors: ['adductors'],
  abductors: ['hip-flexors', 'gluteal'],
  neck: ['neck'],
};

const PREFERRED_SIDE: Record<MuscleGroup, MuscleMapSide> = {
  chest: 'front',
  lats: 'back',
  'middle back': 'back',
  'lower back': 'back',
  shoulders: 'front',
  traps: 'back',
  biceps: 'front',
  triceps: 'back',
  forearms: 'front',
  quadriceps: 'front',
  hamstrings: 'back',
  glutes: 'back',
  calves: 'back',
  abdominals: 'front',
  adductors: 'front',
  abductors: 'front',
  neck: 'back',
};

const SOURCE_TO_APP_MUSCLE: Record<string, MuscleGroup> = {
  chest: 'chest',
  'upper-back': 'lats',
  rhomboids: 'middle back',
  'lower-back': 'lower back',
  deltoids: 'shoulders',
  'rotator-cuff': 'shoulders',
  trapezius: 'traps',
  biceps: 'biceps',
  triceps: 'triceps',
  forearm: 'forearms',
  quadriceps: 'quadriceps',
  'hip-flexors': 'abductors',
  hamstring: 'hamstrings',
  gluteal: 'glutes',
  calves: 'calves',
  abs: 'abdominals',
  obliques: 'abdominals',
  serratus: 'abdominals',
  adductors: 'adductors',
  neck: 'neck',
};

const VISUAL_ONLY_SLUGS = new Set(['head', 'hair', 'hands', 'feet', 'knees', 'tibialis', 'ankles']);

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
  sideSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  mapPanel: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    minHeight: 340,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  map: { width: 194, height: 340 },
  mapLabel: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    alignItems: 'flex-end',
  },
  mapLabelText: { marginTop: 1 },
  sideSwitch: {
    flexDirection: 'row',
    gap: spacing.xs,
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

function isMuscleGroup(value: string): value is MuscleGroup {
  return MUSCLE_GROUPS.some((group) => group === value);
}

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

function MuscleMap({
  side,
  selected,
  onSelect,
}: {
  side: MuscleMapSide;
  selected: MuscleGroup;
  onSelect: (muscle: MuscleGroup) => void;
}) {
  const highlighted = new Set(SOURCE_MUSCLES[selected]);

  return (
    <Svg
      width={194}
      height={340}
      viewBox={MUSCLE_MAP_VIEW_BOX[side]}
      style={styles.map}
      accessibilityLabel={`${side} body muscle map. ${MUSCLE_LABELS[selected]} highlighted.`}
    >
      {MALE_MUSCLE_MAP[side].flatMap((group) =>
        group.paths.map((path, index) => {
          const mappedMuscle = SOURCE_TO_APP_MUSCLE[group.slug];
          const selectable = mappedMuscle !== undefined && !VISUAL_ONLY_SLUGS.has(group.slug);
          const active = highlighted.has(group.slug);
          return (
            <Path
              key={`${group.slug}-${index}`}
              d={path}
              fill={active ? colors.accent : colors.surfaceRaised}
              stroke={active ? colors.onAccent : colors.borderStrong}
              strokeWidth={active ? 3.2 : 1.6}
              onPress={selectable ? () => onSelect(mappedMuscle) : undefined}
              accessible={selectable}
              accessibilityLabel={selectable ? `Show ${MUSCLE_LABELS[mappedMuscle]} exercises` : undefined}
            />
          );
        }),
      )}
    </Svg>
  );
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
        Tap the body or choose a muscle below. Your selected area is highlighted in red.
      </AppText>

      <View style={styles.sideSwitchRow}>
        <AppText variant="label">Body view</AppText>
        <View style={styles.sideSwitch}>
          <Chip label="Front" selected={side === 'front'} onPress={() => setSide('front')} />
          <Chip label="Back" selected={side === 'back'} onPress={() => setSide('back')} />
        </View>
      </View>

      <View style={styles.mapPanel}>
        <MuscleMap side={side} selected={selected} onSelect={selectMuscle} />
        <View style={styles.mapLabel} pointerEvents="none">
          <AppText variant="label" color={colors.textDim}>
            Selected
          </AppText>
          <AppText variant="title" color={colors.accent} style={styles.mapLabelText}>
            {label}
          </AppText>
        </View>
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
