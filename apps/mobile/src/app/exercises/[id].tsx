import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { displayWeight, hasEntitlement } from '@gym/shared';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import {
  AppText,
  enterDown,
  enterUp,
  IconChip,
  PressableScale,
  SectionLabel,
  Screen,
  StatBlock,
  Tag,
} from '../../components/ui';
import { ExerciseVideo } from '../../features/training/components/ExerciseVideo';
import { useExerciseHistory } from '../../features/training/hooks';
import { formatWeightNumber } from '../../features/training/logic';
import { getExercise } from '../../lib/exercises';
import { getGreeceVideo } from '../../lib/seed/greeceVideos';
import { SEED_PLAN_WORKOUTS } from '../../lib/seed/plans';
import { posterDate } from '../../lib/dates';
import { useProfile } from '../../state/profile';

/** Exercise ids that appear in any seed plan — only these tease "coming soon". */
const SEED_EXERCISE_IDS: ReadonlySet<string> = new Set(
  Object.values(SEED_PLAN_WORKOUTS)
    .flat()
    .flatMap((w) => w.exercises.map((e) => e.exerciseId)),
);

/** Exercise detail: image (tap swaps angle), facts, steps, personal history. */

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // White rounded block — the bundled photos have white backgrounds, so the
  // block makes them look deliberate, like an oversized icon chip.
  imageWrap: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.lg,
    backgroundColor: colors.onAccent, // pure white, matching the image bg
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  image: { width: '100%', height: '100%' },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  step: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  stepNo: {
    fontFamily: type.display,
    fontSize: 20,
    color: colors.accent,
    width: 26,
    lineHeight: 24,
  },
  stepText: { flex: 1 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  historyDate: { flexShrink: 0 },
  historyNumbers: { fontFamily: type.display, fontSize: 22, color: colors.text, flexShrink: 1, minWidth: 0, textAlign: 'right' },
  // Locked "Greece's demo" card — compact row, tap routes to plans.
  lockedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  lockedText: { flex: 1, gap: 2 },
  // "Coming soon" chip — small, quiet, only for seed-plan exercises.
  comingSoonChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
});

export default function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const exerciseId = typeof id === 'string' ? id : '';
  const exercise = getExercise(exerciseId);
  const unitPref = useProfile((s) => s.unitPref);
  const tier = useProfile((s) => s.tier);
  const history = useExerciseHistory(exerciseId);
  const [imgIdx, setImgIdx] = useState(0);

  if (!exercise) {
    return (
      <Screen>
        <View style={styles.topRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
        </View>
        <AppText variant="body" color={colors.textDim}>
          Exercise not found.
        </AppText>
      </Screen>
    );
  }

  const images = exercise.imageUrls;
  const facts = [
    exercise.level,
    exercise.equipment ?? 'bodyweight',
    exercise.muscleGroup,
  ].filter((f): f is string => f !== null && f.length > 0);

  // Greece's coach demo: unlocked for Gold (signature_plans), locked teaser
  // below Gold, and a small "coming soon" tease for seed-plan exercises only.
  const greeceVideo = getGreeceVideo(exerciseId);
  const canWatchDemo = hasEntitlement({ tier }, 'signature_plans');
  const isSeedExercise = SEED_EXERCISE_IDS.has(exerciseId);
  const posterUri = images[0];

  return (
    <Screen scroll>
      <Animated.View entering={enterDown(0)} style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
      </Animated.View>

      <Animated.View entering={enterUp(0)}>
        <Pressable
          accessibilityRole={images.length > 1 ? 'button' : 'image'}
          accessibilityLabel={
            images.length > 1 ? `${exercise.name} photo. Tap to see the other angle.` : exercise.name
          }
          onPress={() => {
            if (images.length > 1) setImgIdx((i) => (i + 1) % images.length);
          }}
          style={styles.imageWrap}
        >
          {images[imgIdx] ? (
            <Image
              source={{ uri: images[imgIdx] }}
              style={styles.image}
              contentFit="contain"
              transition={150}
            />
          ) : null}
        </Pressable>
      </Animated.View>

      <Animated.View entering={enterUp(1)}>
        <AppText variant="heading">{exercise.name}</AppText>
        <View style={styles.pillRow}>
          {facts.map((f) => (
            <Tag key={f} label={f} variant="dim" />
          ))}
        </View>
      </Animated.View>

      {greeceVideo && canWatchDemo ? (
        <Animated.View entering={enterUp(2)}>
          <SectionLabel>Coach demo</SectionLabel>
          <ExerciseVideo
            url={greeceVideo.url}
            posterUri={posterUri}
            label={greeceVideo.label ?? "Greece's demo"}
          />
        </Animated.View>
      ) : greeceVideo ? (
        <Animated.View entering={enterUp(2)}>
          <SectionLabel>Coach demo</SectionLabel>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Greece's demo video. Unlock with the Gold plan."
            onPress={() => router.push('/subscribe' as Href)}
            style={styles.lockedCard}
          >
            <IconChip icon="videocam" color={colors.surfaceRaised} iconColor={colors.accent} />
            <View style={styles.lockedText}>
              <AppText variant="bodyBold">Greece's demo</AppText>
              <AppText variant="caption" color={colors.textDim}>
                Watch the GM technique — Gold plan.
              </AppText>
            </View>
            <Tag label="Gold" variant="filled" />
          </PressableScale>
        </Animated.View>
      ) : isSeedExercise ? (
        <Animated.View entering={enterUp(2)} style={styles.pillRow}>
          <View style={styles.comingSoonChip}>
            <AppText variant="caption" color={colors.textDim}>
              🎥 Greece's demo — coming soon
            </AppText>
          </View>
        </Animated.View>
      ) : null}

      {history.bestE1Rm !== null || history.recentSessions.length > 0 ? (
        <Animated.View entering={enterUp(2)}>
          <SectionLabel>Your history</SectionLabel>
          {history.bestE1Rm !== null ? (
            <StatBlock
              label="best 1rm (est.)"
              value={formatWeightNumber(displayWeight(history.bestE1Rm, unitPref))}
              unit={unitPref}
            />
          ) : null}
          {history.recentSessions.map((s) => (
            <View key={s.date} style={styles.historyRow}>
              <AppText variant="caption" color={colors.textDim} numberOfLines={1} style={styles.historyDate}>
                {posterDate(s.date)}
              </AppText>
              <AppText
                style={styles.historyNumbers}
                tabular
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {`${formatWeightNumber(displayWeight(s.e1rm, unitPref))} ${unitPref} e1RM`}
              </AppText>
            </View>
          ))}
        </Animated.View>
      ) : null}

      {exercise.instructions.length > 0 ? (
        <Animated.View entering={enterUp(3)}>
          <SectionLabel>How to do it</SectionLabel>
          {exercise.instructions.map((step, i) => (
            <View key={i} style={styles.step}>
              <AppText style={styles.stepNo} tabular>
                {`${i + 1}.`}
              </AppText>
              <AppText variant="body" style={styles.stepText}>
                {step}
              </AppText>
            </View>
          ))}
        </Animated.View>
      ) : null}
    </Screen>
  );
}
