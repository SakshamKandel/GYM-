import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { displayWeight } from '@gym/shared';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import {
  AppText,
  Card,
  EmptyState,
  enterDown,
  enterUp,
  IconChip,
  PressableScale,
  SectionLabel,
  Screen,
  StatBlock,
  Tag,
} from '../../components/ui';
import { WeightChart } from '../../features/body/components/WeightChart';
import { ExerciseVideo } from '../../features/training/components/ExerciseVideo';
import { useExerciseHistory, usePlanVideo } from '../../features/training/hooks';
import { formatWeightNumber } from '../../features/training/logic';
import { getExercise } from '../../lib/exercises';
import { isExerciseInCatalogPlan, useTrainingCatalog } from '../../lib/trainingCatalog';
import { isMuscleGroup } from '../../lib/muscleMap';
import { posterDate } from '../../lib/dates';
import { useProfile } from '../../state/profile';

/**
 * Exercise detail: image (tap swaps angle), facts, steps, personal history.
 * Revamp (REVAMP-BRIEF): light image well framed inside a charcoal block,
 * Oswald display name with meta pills, red hero block for the headline
 * record (best e1RM + rep maxes), cream counterpoint block for the steps.
 */

/** Inverse Epley: the weight you could lift for `reps`, given an e1RM. */
function repMaxKg(e1rmKg: number, reps: number): number {
  return e1rmKg / (1 + reps / 30);
}

/** Rep counts shown as estimated rep-maxes in the red records block. */
const REP_MAX_TARGETS = [5, 8, 12] as const;

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Framed image well (brief §8): the bundled photos ship on white
  // backgrounds, so the well stays light for legibility — but it sits framed
  // at radius.md INSIDE a raised charcoal block (radius.block, no border), so
  // the page keeps its dark composition instead of opening on a wall of white.
  imageCard: { marginBottom: spacing.lg },
  imageWell: {
    width: '100%',
    height: 240,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  // Discoverability badge on multi-angle photos: a dark pill on the white image
  // showing the current angle + a swap glyph, hinting the tap-to-rotate.
  swapBadge: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  // Header block (brief §5): eyebrow → big Oswald name → meta pills.
  title: {
    textTransform: 'uppercase',
    lineHeight: 44,
    marginTop: spacing.xs,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  // Outlined meta pill (brief §6) — non-interactive fact chip on dark.
  metaPill: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.full,
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The muscle pill IS interactive — it opens the anatomy explorer. Filled
   * (not outlined) + icon so it reads as tappable next to the fact pills,
   * and tall enough for a ≥48dp target. */
  anatomyPill: {
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: touch.min,
    borderColor: colors.surfaceRaised,
    backgroundColor: colors.surfaceRaised,
  },
  step: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  stepLast: { marginBottom: 0 },
  // Black-on-cream numerals — never red text on cream (brief §2).
  stepNo: {
    fontFamily: type.display,
    fontSize: type.size.title,
    color: colors.onBlock,
    width: 26,
    lineHeight: 24,
  },
  stepText: { flex: 1 },
  // "E1RM TREND" label + trend tag on one line — same spacing as SectionLabel.
  trendHeader: {
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  // Red hero block (brief §11b): headline record + rep-max estimates, all
  // BLACK ink (`onBlock`) — never white-on-red.
  heroBlock: { gap: spacing.sm },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  heroValue: { flexShrink: 1 },
  heroUnit: { opacity: 0.6 },
  repMaxRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  repMaxCell: { flex: 1, gap: spacing.xs / 2 },
  repMaxValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  repMaxValue: {
    fontSize: type.size.heading,
    lineHeight: 38,
    flexShrink: 1,
  },
  recordsCard: { marginTop: spacing.md },
  recordsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.lg,
  },
  recordCell: { width: '50%', paddingRight: spacing.md },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  historyDate: { flexShrink: 0 },
  historyNumbers: {
    fontFamily: type.display,
    fontSize: type.size.title,
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
    textAlign: 'right',
  },
  sessionRight: { alignItems: 'flex-end', flexShrink: 1, minWidth: 0 },
  // Locked "Greece's demo" card — charcoal block row (no border — separation
  // by fill contrast), tap routes to plans.
  lockedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.lg,
  },
  lockedText: { flex: 1, gap: spacing.xs / 2 },
  // "Coming soon" chip — small, quiet, only for seed-plan exercises.
  comingSoonChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
});

/** Outlined fact pill (level · equipment · muscle group). */
function MetaPill({ label }: { label: string }) {
  return (
    <View style={styles.metaPill}>
      <AppText variant="label" color={colors.text} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

export default function ExerciseDetailScreen() {
  const catalogState = useTrainingCatalog();
  const { id } = useLocalSearchParams<{ id: string }>();
  const exerciseId = typeof id === 'string' ? id : '';
  const exercise = getExercise(exerciseId);
  const unitPref = useProfile((s) => s.unitPref);
  const history = useExerciseHistory(exerciseId);
  const planVideo = usePlanVideo(exerciseId);
  const [imgIdx, setImgIdx] = useState(0);
  // The well starts charcoal (surfaceRaised) and only turns light once a photo
  // has actually decoded — no pure-white flash while the CDN image streams in.
  const [imgLoaded, setImgLoaded] = useState(false);

  if (!exercise) {
    return (
      <Screen>
        <View style={styles.topRow}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </PressableScale>
        </View>
        {catalogState.status === 'loading' || catalogState.refreshing ? (
          <View style={styles.lockedCard}>
            <ActivityIndicator color={colors.accent} accessibilityLabel="Loading exercise" />
            <AppText variant="body" color={colors.textDim}>Loading coach catalog…</AppText>
          </View>
        ) : catalogState.status === 'authRequired' ? (
          <EmptyState
            icon="cloud-offline-outline"
            title="Sign in for exercises"
            body="Exercise details come from your coach’s live catalog."
            actionLabel="Sign in"
            onAction={() => router.push('/auth/sign-in' as Href)}
          />
        ) : catalogState.status === 'error' ? (
          <EmptyState
            icon="refresh-outline"
            title="Catalog unavailable"
            body="Check your connection and try again."
            actionLabel="Try again"
            onAction={() => void catalogState.refresh()}
          />
        ) : (
          <AppText variant="body" color={colors.textDim}>Exercise not found.</AppText>
        )}
      </Screen>
    );
  }

  const images = exercise.imageUrls;
  const facts = [
    exercise.level,
    exercise.equipment ?? 'bodyweight',
  ].filter((f): f is string => f !== null && f.length > 0);
  // The muscle pill deep-links into the anatomy explorer when the group is
  // one the body map knows (some rare groups aren't mapped — plain pill then).
  const anatomyMuscle = isMuscleGroup(exercise.muscleGroup) ? exercise.muscleGroup : null;

  // Greece's coach demo. The gated playback API is the source of truth (it mints
  // a signed, per-tier stream). 'ready' → play, 'locked' → paywall teaser for
  // the required tier, otherwise an honest "coming soon" for plan exercises.
  const isPlanExercise = isExerciseInCatalogPlan(exerciseId);
  const posterUri = images[0];
  // Local const so the null-check narrows into the rep-max map callback below.
  const bestE1RmKg = history.bestE1RmKg;
  const hasHistory =
    history.e1rmHistory.length > 0 ||
    history.recentSessions.length > 0 ||
    history.bestWeightKg !== null;
  const chartPoints = history.e1rmHistory.map((h) => ({
    date: h.date,
    value: displayWeight(h.e1rm, unitPref),
  }));
  const lockedTierLabel =
    planVideo.status === 'locked'
      ? planVideo.requiredTier.charAt(0).toUpperCase() + planVideo.requiredTier.slice(1)
      : 'Gold';

  return (
    <Screen scroll>
      <Animated.View entering={enterDown(0)} style={styles.topRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </PressableScale>
      </Animated.View>

      {images.length > 0 ? (
        <Animated.View entering={enterUp(0)}>
          <Card backgroundColor={colors.surfaceRaised} style={styles.imageCard}>
            <PressableScale
              accessibilityRole={images.length > 1 ? 'button' : 'image'}
              accessibilityLabel={
                images.length > 1
                  ? `${exercise.name} photo. Tap to see the other angle.`
                  : exercise.name
              }
              disabled={images.length <= 1}
              pressScale={0.985}
              onPress={() => {
                if (images.length > 1) setImgIdx((i) => (i + 1) % images.length);
              }}
              style={[
                styles.imageWell,
                { backgroundColor: imgLoaded ? colors.onAccent : colors.surfaceRaised },
              ]}
            >
              {images[imgIdx] ? (
                <Image
                  source={{ uri: images[imgIdx] }}
                  style={styles.image}
                  contentFit="contain"
                  transition={150}
                  onLoad={() => setImgLoaded(true)}
                />
              ) : null}
              {images.length > 1 ? (
                <View style={styles.swapBadge} pointerEvents="none" accessibilityElementsHidden>
                  <Ionicons name="swap-horizontal" size={13} color={colors.textDim} />
                  <AppText variant="label" color={colors.text} tabular>
                    {`${imgIdx + 1}/${images.length}`}
                  </AppText>
                </View>
              ) : null}
            </PressableScale>
          </Card>
        </Animated.View>
      ) : null}

      <Animated.View entering={enterUp(1)}>
        <AppText variant="label">Exercise library</AppText>
        <AppText variant="display" style={styles.title}>
          {exercise.name}
        </AppText>
        <View style={styles.pillRow}>
          {facts.map((f) => (
            <MetaPill key={f} label={f} />
          ))}
          {anatomyMuscle ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Learn ${anatomyMuscle} anatomy and how to train it`}
              onPress={() => router.push(`/anatomy?muscle=${encodeURIComponent(anatomyMuscle)}` as Href)}
              style={[styles.metaPill, styles.anatomyPill]}
            >
              <Ionicons name="body-outline" size={14} color={colors.accent} />
              <AppText variant="label" color={colors.text} numberOfLines={1}>
                {exercise.muscleGroup}
              </AppText>
            </PressableScale>
          ) : (
            <MetaPill label={exercise.muscleGroup} />
          )}
        </View>
      </Animated.View>

      {planVideo.status === 'ready' ? (
        <Animated.View entering={enterUp(2)}>
          <SectionLabel>Coach demo</SectionLabel>
          <ExerciseVideo url={planVideo.url} posterUri={posterUri} label={planVideo.label} />
        </Animated.View>
      ) : planVideo.status === 'locked' ? (
        <Animated.View entering={enterUp(2)}>
          <SectionLabel>Coach demo</SectionLabel>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Greece's demo video. Unlock with the ${lockedTierLabel} plan.`}
            onPress={() => router.push('/subscribe' as Href)}
            style={styles.lockedCard}
          >
            <IconChip icon="videocam" color={colors.surfaceRaised} iconColor={colors.accent} />
            <View style={styles.lockedText}>
              <AppText variant="bodyBold">{"Greece's demo"}</AppText>
              <AppText variant="caption" color={colors.textDim}>
                {`Watch the GM technique — ${lockedTierLabel} plan.`}
              </AppText>
            </View>
            <Tag label={lockedTierLabel} variant="filled" />
          </PressableScale>
        </Animated.View>
      ) : isPlanExercise ? (
        <Animated.View entering={enterUp(2)} style={styles.pillRow}>
          <View style={styles.comingSoonChip}>
            <AppText variant="caption" color={colors.textDim}>
              {"🎥 Greece's demo — coming soon"}
            </AppText>
          </View>
        </Animated.View>
      ) : null}

      {history.loaded ? (
        hasHistory ? (
          <Animated.View entering={enterUp(2)}>
            <View style={styles.trendHeader}>
              <AppText variant="label">e1RM trend</AppText>
              {history.plateau === 'progressing' ? (
                <Tag label="Trending up" color={colors.success} />
              ) : history.plateau === 'plateau' ? (
                <Tag label="Flat lately" variant="dim" />
              ) : history.plateau === 'regressing' ? (
                <Tag label="Trending down" color={colors.warning} />
              ) : null}
            </View>
            <WeightChart
              raw={chartPoints}
              trend={chartPoints}
              height={180}
              emptyLabel="No e1RM history yet"
              format={(v) => String(Math.round(v))}
            />

            <SectionLabel>Records</SectionLabel>
            {bestE1RmKg !== null ? (
              <Card variant="red" style={styles.heroBlock}>
                <AppText variant="label" color={colors.onBlock}>
                  Best 1RM (est.)
                </AppText>
                <View style={styles.heroRow}>
                  <AppText
                    variant="stat"
                    color={colors.onBlock}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.6}
                    style={styles.heroValue}
                  >
                    {formatWeightNumber(displayWeight(bestE1RmKg, unitPref))}
                  </AppText>
                  <AppText variant="title" color={colors.onBlock} style={styles.heroUnit}>
                    {unitPref}
                  </AppText>
                </View>
                <View style={styles.repMaxRow}>
                  {REP_MAX_TARGETS.map((reps) => (
                    <View key={reps} style={styles.repMaxCell}>
                      <AppText variant="label" color={colors.onBlock} numberOfLines={1}>
                        {`${reps}-rep max`}
                      </AppText>
                      <View style={styles.repMaxValueRow}>
                        <AppText
                          variant="display"
                          color={colors.onBlock}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.6}
                          style={styles.repMaxValue}
                        >
                          {formatWeightNumber(displayWeight(repMaxKg(bestE1RmKg, reps), unitPref))}
                        </AppText>
                        <AppText variant="caption" color={colors.onBlock}>
                          {unitPref}
                        </AppText>
                      </View>
                    </View>
                  ))}
                </View>
              </Card>
            ) : null}
            {history.bestWeightKg !== null || history.bestSessionVolumeKg !== null ? (
              <Card style={styles.recordsCard}>
                <View style={styles.recordsGrid}>
                  {history.bestWeightKg !== null ? (
                    <StatBlock
                      style={styles.recordCell}
                      label="heaviest set"
                      value={formatWeightNumber(displayWeight(history.bestWeightKg, unitPref))}
                      unit={unitPref}
                    />
                  ) : null}
                  {history.bestSessionVolumeKg !== null ? (
                    <StatBlock
                      style={styles.recordCell}
                      label="best session volume"
                      value={Math.round(displayWeight(history.bestSessionVolumeKg, unitPref))}
                      unit={unitPref}
                    />
                  ) : null}
                </View>
              </Card>
            ) : null}

            {history.recentSessions.length > 0 ? (
              <>
                <SectionLabel>Recent sessions</SectionLabel>
                <Card>
                  {history.recentSessions.map((s) => (
                    <View key={s.date} style={styles.historyRow}>
                      <AppText
                        variant="caption"
                        color={colors.textDim}
                        numberOfLines={1}
                        style={styles.historyDate}
                      >
                        {posterDate(s.date)}
                      </AppText>
                      <View style={styles.sessionRight}>
                        <AppText
                          style={styles.historyNumbers}
                          tabular
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.6}
                        >
                          {`${formatWeightNumber(displayWeight(s.topWeightKg, unitPref))} ${unitPref} × ${s.topReps}`}
                        </AppText>
                        <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
                          {`${Math.round(displayWeight(s.volumeKg, unitPref))} ${unitPref} total`}
                        </AppText>
                      </View>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}
          </Animated.View>
        ) : (
          <Animated.View entering={enterUp(2)}>
            <SectionLabel>Your history</SectionLabel>
            <AppText variant="caption" color={colors.textDim}>
              Log a set and your numbers land here.
            </AppText>
          </Animated.View>
        )
      ) : null}

      {exercise.instructions.length > 0 ? (
        <Animated.View entering={enterUp(3)}>
          <SectionLabel>How to do it</SectionLabel>
          <Card variant="cream">
            {exercise.instructions.map((step, i) => (
              <View
                key={i}
                style={[styles.step, i === exercise.instructions.length - 1 && styles.stepLast]}
              >
                <AppText style={styles.stepNo} tabular>
                  {`${i + 1}.`}
                </AppText>
                <AppText variant="body" color={colors.onBlock} style={styles.stepText}>
                  {step}
                </AppText>
              </View>
            ))}
          </Card>
        </Animated.View>
      ) : null}
    </Screen>
  );
}
