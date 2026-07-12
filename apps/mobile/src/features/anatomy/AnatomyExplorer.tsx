import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Card,
  Chip,
  enterDown,
  enterUp,
  IconChip,
  PressableScale,
  ScreenHeader,
  SectionLabel,
  Tag,
} from '../../components/ui';
import { allExercises, MUSCLE_GROUPS } from '../../lib/exercises';
import { tapHaptic } from '../../lib/haptics';
import {
  MUSCLE_LABELS,
  PREFERRED_SIDE,
  type MuscleGroup,
} from '../../lib/muscleMap';
import type { MuscleMapSide } from '../../lib/muscleMapData';
import { pushPath } from './nav';
import { AnatomyBody } from './AnatomyBody';
import { Anatomy3DViewer, ANATOMY_3D_ENABLED } from '../../components/anatomy';
import { MUSCLE_KNOWLEDGE } from './knowledge';

/**
 * Anatomy explorer — the app's muscle encyclopedia. A rotatable body
 * (drag 360°, pinch zoom, tap to select) on top; below it, the selected
 * muscle's anatomy, function, and evidence-based training guidance, plus the
 * best-matching exercises from the bundled library.
 */

const EXERCISE_PREVIEW_LIMIT = 5;

const styles = StyleSheet.create({
  bodyCard: {
    marginTop: spacing.xl,
    backgroundColor: colors.bg,
    borderRadius: radius.block,
    overflow: 'hidden',
  },
  chipStrip: { gap: spacing.sm, paddingVertical: spacing.lg },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  heroCopy: { flex: 1, gap: spacing.xs },
  heroBlock: { gap: spacing.md },
  factRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  // On-block chip (brief §6): solid black fill on the red hero, light label.
  factPill: {
    backgroundColor: colors.onBlock,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  section: { marginTop: spacing.xl, gap: spacing.sm },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.gutter,
    gap: spacing.sm,
  },
  bulletRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  bulletDot: { marginTop: 7 },
  rxGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rxTile: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 72,
    backgroundColor: colors.surface,
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
  allRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: touch.min,
    paddingVertical: spacing.md,
  },
  rowGap: { marginTop: spacing.sm },
});

function Bullet({ text, tone }: { text: string; tone: 'tip' | 'mistake' }) {
  return (
    <View style={styles.bulletRow}>
      <Ionicons
        name={tone === 'tip' ? 'checkmark-circle' : 'close-circle'}
        size={16}
        color={tone === 'tip' ? colors.success : colors.error}
        style={styles.bulletDot}
      />
      <AppText variant="body" color={colors.textDim} style={{ flex: 1 }}>
        {text}
      </AppText>
    </View>
  );
}

export function AnatomyExplorer({ initialMuscle }: { initialMuscle: MuscleGroup }) {
  const [selected, setSelected] = useState<MuscleGroup>(initialMuscle);
  const [side, setSide] = useState<MuscleMapSide>(PREFERRED_SIDE[initialMuscle]);

  const knowledge = MUSCLE_KNOWLEDGE[selected];
  const label = MUSCLE_LABELS[selected];
  const exercises = useMemo(
    () =>
      allExercises()
        .filter((e) => e.muscleGroup === selected)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [selected],
  );

  const selectMuscle = (muscle: MuscleGroup): void => {
    setSelected(muscle);
    setSide(PREFERRED_SIDE[muscle]);
  };

  return (
    <>
      <ScreenHeader
        eyebrow="Muscle encyclopedia"
        title="Anatomy"
        meta={
          <>
            <Tag label={`${MUSCLE_GROUPS.length} muscle groups`} variant="dim" />
            <Tag label={`${exercises.length} ${label} moves`} variant="dim" />
          </>
        }
      />

      {/* Rotatable body — the screen's centerpiece. True-3D WebGL model when
          enabled, with the SVG body as the universal fallback. */}
      <Animated.View entering={enterUp(0)} style={styles.bodyCard}>
        {ANATOMY_3D_ENABLED ? (
          <Anatomy3DViewer
            selected={selected}
            onSelect={selectMuscle}
            side={side}
            onSideChange={setSide}
            height={440}
          />
        ) : (
          <AnatomyBody
            selected={selected}
            onSelect={selectMuscle}
            side={side}
            onSideSettled={setSide}
          />
        )}
      </Animated.View>

      <Animated.View entering={enterDown(1)}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipStrip}
        >
          {MUSCLE_GROUPS.map((muscle) => (
            <Chip
              key={muscle}
              label={MUSCLE_LABELS[muscle]}
              selected={selected === muscle}
              onPress={() => {
                tapHaptic();
                selectMuscle(muscle);
              }}
            />
          ))}
        </ScrollView>
      </Animated.View>

      {/* Red hero block: the selected muscle's identity card. */}
      <Animated.View entering={enterUp(1)} key={`hero-${selected}`}>
        <Card variant="red">
          <View style={styles.heroBlock}>
            <View style={styles.heroTitleRow}>
              <View style={styles.heroCopy}>
                <AppText variant="label" color={colors.onBlock}>
                  {knowledge.anatomicalName}
                </AppText>
                <AppText variant="display" color={colors.onBlock} numberOfLines={2}>
                  {label.toUpperCase()}
                </AppText>
              </View>
            </View>
            <AppText variant="body" color={colors.onBlock} style={{ opacity: 0.85 }}>
              {knowledge.originInsertion}
            </AppText>
            <View style={styles.factRow}>
              {knowledge.parts.map((part) => (
                <View key={part} style={styles.factPill}>
                  <AppText variant="caption" color={colors.text} numberOfLines={1}>
                    {part}
                  </AppText>
                </View>
              ))}
            </View>
          </View>
        </Card>
      </Animated.View>

      {/* What it does */}
      <Animated.View entering={enterUp(2)} style={styles.section} key={`fn-${selected}`}>
        <SectionLabel>What it does</SectionLabel>
        <View style={styles.infoCard}>
          {knowledge.functions.map((fn) => (
            <View key={fn} style={styles.bulletRow}>
              <Ionicons
                name="flash"
                size={14}
                color={colors.accent}
                style={styles.bulletDot}
              />
              <AppText variant="body" color={colors.textDim} style={{ flex: 1 }}>
                {fn}
              </AppText>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* Training prescription */}
      <Animated.View entering={enterUp(3)} style={styles.section} key={`rx-${selected}`}>
        <SectionLabel>How to train it</SectionLabel>
        <View style={styles.rxGrid}>
          <View style={styles.rxTile}>
            <AppText variant="label" color={colors.textDim}>
              Weekly volume
            </AppText>
            <AppText variant="bodyBold">{knowledge.training.weeklySets}</AppText>
          </View>
          <View style={styles.rxTile}>
            <AppText variant="label" color={colors.textDim}>
              Rep range
            </AppText>
            <AppText variant="bodyBold">{knowledge.training.repRange}</AppText>
          </View>
          <View style={styles.rxTile}>
            <AppText variant="label" color={colors.textDim}>
              Frequency
            </AppText>
            <AppText variant="bodyBold">{knowledge.training.frequency}</AppText>
          </View>
        </View>
      </Animated.View>

      {/* Coaching bullets */}
      <Animated.View entering={enterUp(4)} style={styles.section} key={`tips-${selected}`}>
        <SectionLabel>Coaching notes</SectionLabel>
        <View style={styles.infoCard}>
          {knowledge.training.tips.map((tip) => (
            <Bullet key={tip} text={tip} tone="tip" />
          ))}
          {knowledge.training.mistakes.map((mistake) => (
            <Bullet key={mistake} text={mistake} tone="mistake" />
          ))}
        </View>
      </Animated.View>

      {/* Best exercises for this muscle */}
      <Animated.View entering={enterUp(5)} style={styles.section} key={`ex-${selected}`}>
        <SectionLabel>{`${label} exercises`}</SectionLabel>
        {exercises.slice(0, EXERCISE_PREVIEW_LIMIT).map((exercise, i) => (
          <PressableScale
            key={exercise.id}
            accessibilityRole="button"
            accessibilityLabel={`Open ${exercise.name}`}
            onPress={() => pushPath(`/exercises/${exercise.id}`)}
            pressScale={0.985}
            style={[styles.exerciseRow, i > 0 ? styles.rowGap : undefined]}
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
        {exercises.length === 0 ? (
          <View style={styles.infoCard}>
            <IconChip icon="barbell-outline" />
            <AppText variant="bodyBold">No exercises yet</AppText>
            <AppText variant="caption" color={colors.textDim}>
              Browse the library to find a movement for this area.
            </AppText>
          </View>
        ) : (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`See all ${label} exercises`}
            onPress={() => pushPath(`/exercises?muscle=${encodeURIComponent(selected)}`)}
            style={styles.allRow}
          >
            <AppText variant="bodyBold" color={colors.accent}>
              {`See all ${exercises.length} ${label} exercises`}
            </AppText>
            <Ionicons name="arrow-forward" size={18} color={colors.accent} />
          </PressableScale>
        )}
      </Animated.View>
    </>
  );
}
