import { useEffect, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLocalSearchParams } from 'expo-router';
import type { SetLog, WorkoutLog } from '@gym/shared';
import { displayWeight, epley1Rm, hasEntitlement } from '@gym/shared';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import {
  AnimatedNumber,
  AppText,
  AppTextInput,
  Button,
  Card,
  enterUp,
  IconChip,
  PhotoHero,
  Screen,
  ScreenHeader,
  SectionLabel,
  Sheet,
  StreakFlame,
  Tag,
} from '../../components/ui';
import { photoForWorkout } from '../../components/visual';
import { PrCelebration } from '../../features/training/components/PrCelebration';
import {
  averageRpe,
  formatClock,
  formatSignedClock,
  formatSignedInt,
  formatWeightNumber,
  groupSetsByExercise,
  templateExercisesFromSets,
  totalVolumeKg,
} from '../../features/training/logic';
import { replacePath } from '../../features/training/nav';
import { useTemplates } from '../../features/training/templates';
import { PrUpgradeCard } from '../../features/subscription/PrUpgradeCard';
import { posterDate } from '../../lib/dates';
import { successHaptic } from '../../lib/haptics';
import { getRepo } from '../../lib/repo';
import { getPlanWorkout } from '../../lib/seed/plans';
import { useProfile } from '../../state/profile';
import { useEffectiveTier } from '../../lib/tier';

/**
 * Celebration recap in the block language (REVAMP-BRIEF): one red hero block
 * carrying the headline volume with time / sets / PR count riding under it,
 * a charcoal vs-last-time card, the PR ledger and per-exercise breakdown as
 * rounded charcoal rows — no hairlines anywhere, separation by fill contrast.
 */

/** The previous finished run of this same workout, for the comparison card. */
interface PreviousRun {
  workout: WorkoutLog;
  volumeKg: number;
  /** True when this came from the fuzzy exercise-overlap fallback rather
   * than an exact plan/name match — the compare card notes this so a
   * freestyle session isn't silently compared against an unrelated one. */
  fuzzy: boolean;
}

/** Exercise ids trained in a set list, for the fuzzy vs-last-time fallback. */
function exerciseIdSet(sets: readonly SetLog[]): Set<string> {
  return new Set(sets.map((s) => s.exerciseId));
}

/** Jaccard overlap of two exercise-id sets, in [0,1]. Empty either side → 0. */
function exerciseOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const id of a) if (b.has(id)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Below this overlap ratio, two freestyle sessions aren't "the same workout". */
const FUZZY_MATCH_THRESHOLD = 0.5;

const styles = StyleSheet.create({
  // Thin decorative celebration strip above the numeric hero (photographic
  // language, purely decorative — the red hero carries the numbers).
  strip: { marginTop: spacing.xl + spacing.xs },
  // Red hero block — the screen's single energetic center (brief §2/§11b).
  hero: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  heroVolumeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    minWidth: 0,
  },
  heroVolume: { flexShrink: 1 },
  // Large text on red at 0.6 black — same treatment the brief sanctions for
  // fraction denominators on the hero block.
  heroUnit: { opacity: 0.6 },
  heroStatsRow: {
    flexDirection: 'row',
    gap: spacing.xl,
    marginTop: spacing.xs,
  },
  heroStat: { flexShrink: 1, minWidth: 0, gap: 2 },
  heroStatValue: {
    fontFamily: type.display,
    fontSize: 26,
    color: colors.onBlock,
  },
  // PR ledger rows — rounded charcoal rows (brief §11c), stroke-free.
  prRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 64,
    marginBottom: spacing.sm,
  },
  prNumbers: { fontFamily: type.display, fontSize: 20, color: colors.text, flexShrink: 0 },
  prName: { flex: 1, minWidth: 0 },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, minWidth: 0 },
  compareCard: { gap: spacing.sm },
  compareRow: { flexDirection: 'row', gap: spacing.md },
  compareCol: { flex: 1, minWidth: 0 },
  compareNumbers: { fontFamily: type.display, fontSize: 26, color: colors.text },
  exCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  exHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  exName: { flex: 1, minWidth: 0 },
  exSetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 32,
  },
  exSetNo: { fontFamily: type.display, fontSize: 14, color: colors.textFaint, width: 22 },
  exSetNumbers: { fontFamily: type.display, fontSize: 18, color: colors.text },
  exSetSpacer: { flex: 1 },
  footer: { marginTop: spacing.xxl, gap: spacing.sm },
  sheetBody: { gap: spacing.md },
  sheetButton: { marginTop: spacing.sm },
  // Day-1 "streak started" card — charcoal, not red (only one red block per
  // screen, brand law). The burst plays once behind the flame, matching the
  // BadgeCelebration treatment.
  dayOneCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  dayOneFlameStage: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  dayOneBurstWrap: { position: 'absolute', top: -30, left: -30 },
  dayOneCopy: { flex: 1, gap: 2 },
});

export default function WorkoutCompleteScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const unitPref = useProfile((s) => s.unitPref);
  const tier = useEffectiveTier();
  const [workout, setWorkout] = useState<WorkoutLog | null>(null);
  const [sets, setSets] = useState<SetLog[]>([]);
  const [previous, setPrevious] = useState<PreviousRun | null>(null);
  const [isDayOne, setIsDayOne] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateSaved, setTemplateSaved] = useState(false);

  useEffect(() => {
    if (typeof id !== 'string' || id.length === 0) return;
    let mounted = true;
    void (async () => {
      const repo = await getRepo();
      const [w, s] = await Promise.all([repo.getWorkout(id), repo.getSetsForWorkout(id)]);
      if (mounted) {
        setWorkout(w);
        setSets(s);
      }
      if (!w) return;
      // The previous finished run of this same workout — same plan slot, or
      // same name for freestyle/template sessions. Recent history is plenty.
      const recent = await repo.getRecentWorkouts(40);
      const priorFinished = recent.filter((r) => r.id !== w.id && r.finishedAt !== null);
      // Day-1 moment (Pack O): no other finished workout exists — this is
      // genuinely the member's first-ever completed session, the one place
      // in the app that should say so before a streak number means anything.
      if (mounted && priorFinished.length === 0) setIsDayOne(true);

      const prev = recent.find(
        (r) =>
          r.id !== w.id &&
          r.startedAt < w.startedAt &&
          (w.planWorkoutId !== null
            ? r.planWorkoutId === w.planWorkoutId
            : r.planWorkoutId === null && r.name === w.name),
      );
      if (prev) {
        const prevSets = await repo.getSetsForWorkout(prev.id);
        if (mounted) setPrevious({ workout: prev, volumeKg: totalVolumeKg(prevSets), fuzzy: false });
        return;
      }

      // Fuzzy vs-last-time fallback: no exact plan/name match (e.g. a
      // freestyle session renamed between visits) — fall back to the most
      // recent earlier workout that trained substantially the same exercises,
      // so "vs last time" isn't silently empty for anyone off-plan.
      const currentIds = exerciseIdSet(s);
      if (currentIds.size === 0) return;
      let bestMatch: WorkoutLog | null = null;
      let bestSets: SetLog[] = [];
      let bestScore = 0;
      for (const r of priorFinished) {
        if (r.startedAt >= w.startedAt) continue;
        const rSets = await repo.getSetsForWorkout(r.id);
        const score = exerciseOverlap(currentIds, exerciseIdSet(rSets));
        if (score >= FUZZY_MATCH_THRESHOLD && score > bestScore) {
          bestScore = score;
          bestMatch = r;
          bestSets = rSets;
        }
      }
      if (bestMatch && mounted) {
        setPrevious({ workout: bestMatch, volumeKg: totalVolumeKg(bestSets), fuzzy: true });
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  useEffect(() => {
    if (isDayOne) successHaptic();
  }, [isDayOne]);

  const volume = Math.round(displayWeight(totalVolumeKg(sets), unitPref));
  const prSets = sets.filter((s) => s.isPr);
  const exerciseGroups = groupSetsByExercise(sets);
  const avgRpe = averageRpe(sets);

  const volumeDelta = previous
    ? Math.round(displayWeight(totalVolumeKg(sets) - previous.volumeKg, unitPref))
    : null;
  const durationDelta =
    previous && workout?.durationSec != null && previous.workout.durationSec != null
      ? workout.durationSec - previous.workout.durationSec
      : null;

  // Below Gold + a fresh PR = the honest conversion moment. Quote their
  // strongest lift back to them (highest e1RM, heavier weight breaks ties).
  const showUpgrade = prSets.length > 0 && !hasEntitlement({ tier }, 'signature_plans');
  const topPrSet = showUpgrade
    ? prSets.reduce((best, s) => {
        const bestE1rm = epley1Rm(best.weightKg, best.reps);
        const e1rm = epley1Rm(s.weightKg, s.reps);
        if (e1rm > bestE1rm) return s;
        if (e1rm === bestE1rm && s.weightKg > best.weightKg) return s;
        return best;
      })
    : null;

  const openSaveSheet = (): void => {
    setTemplateName(workout?.name ?? 'My workout');
    setSaveOpen(true);
  };

  const saveAsTemplate = (): void => {
    const pw = workout?.planWorkoutId ? (getPlanWorkout(workout.planWorkoutId) ?? null) : null;
    useTemplates.getState().saveTemplate(templateName, templateExercisesFromSets(sets, pw));
    setTemplateSaved(true);
    setSaveOpen(false);
  };

  return (
    <Screen scroll>
      <ScreenHeader
        eyebrow={workout?.name}
        title="Workout complete"
        meta={workout ? <Tag label={posterDate(workout.date)} variant="dim" /> : null}
      />

      {/* Thin decorative celebration strip — the shared photo-hero treatment
          (dark frame + scrim + red chip), keyed to this workout so a Leg Day
          finish shows legs and a Pull Day shows a back frame. Purely decorative;
          the red block below carries the numbers. */}
      <Animated.View entering={enterUp(0)} style={styles.strip}>
        <PhotoHero
          source={photoForWorkout(workout?.name, null)}
          size="strip"
          recyclingKey={`complete-${workout?.name ?? 'workout'}`}
          accessibilityLabel="A finished training session"
          chip={{ label: '✓ Complete' }}
          title={workout?.name ?? 'Workout'}
        />
      </Animated.View>

      {/* Day-1 moment (Pack O / journey 8): the very first finished workout
          ever gets a one-shot "streak started" note before any numbers do.
          A plain charcoal card, not red — the volume hero below stays the
          screen's one energetic block (brand law). */}
      {isDayOne ? (
        <Animated.View entering={enterUp(0)}>
          <Card style={styles.dayOneCard}>
            <View style={styles.dayOneFlameStage}>
              <View style={styles.dayOneBurstWrap} pointerEvents="none">
                <PrCelebration key="day-one" onDone={() => {}} size={100} />
              </View>
              <StreakFlame active size={40} />
            </View>
            <View style={styles.dayOneCopy}>
              <AppText variant="bodyBold">Day 1. Streak started.</AppText>
              <AppText variant="caption" color={colors.textDim}>
                Come back and log another session to keep it alive.
              </AppText>
            </View>
          </Card>
        </Animated.View>
      ) : null}

      {/* Red hero: headline volume, with time / sets / PRs (· effort) below.
          Black ink only on the red block (brand law). */}
      <Animated.View entering={enterUp(0)}>
        <Card variant="red" style={styles.hero}>
          <View
            accessible
            accessibilityLabel={`Total volume ${volume.toLocaleString('en-US')} ${unitPref}`}
          >
            <AppText variant="label" color={colors.onBlock}>
              Total volume
            </AppText>
            <View style={styles.heroVolumeRow}>
              <AnimatedNumber
                value={volume}
                grouped
                variant="stat"
                color={colors.onBlock}
                style={styles.heroVolume}
              />
              <AppText variant="title" color={colors.onBlock} style={styles.heroUnit}>
                {unitPref}
              </AppText>
            </View>
          </View>
          <View style={styles.heroStatsRow}>
            <View style={styles.heroStat}>
              <AppText variant="label" color={colors.onBlock} numberOfLines={1}>
                Time
              </AppText>
              <AppText style={styles.heroStatValue} tabular numberOfLines={1}>
                {formatClock(workout?.durationSec ?? 0)}
              </AppText>
            </View>
            <View style={styles.heroStat}>
              <AppText variant="label" color={colors.onBlock} numberOfLines={1}>
                Sets
              </AppText>
              <AppText style={styles.heroStatValue} tabular numberOfLines={1}>
                {String(sets.length)}
              </AppText>
            </View>
            <View style={styles.heroStat}>
              <AppText variant="label" color={colors.onBlock} numberOfLines={1}>
                PRs
              </AppText>
              <AppText style={styles.heroStatValue} tabular numberOfLines={1}>
                {String(prSets.length)}
              </AppText>
            </View>
            {avgRpe !== null ? (
              <View style={styles.heroStat}>
                <AppText variant="label" color={colors.onBlock} numberOfLines={1}>
                  Effort
                </AppText>
                <AppText style={styles.heroStatValue} tabular numberOfLines={1}>
                  {formatWeightNumber(avgRpe)}
                </AppText>
              </View>
            ) : null}
          </View>
        </Card>
      </Animated.View>

      {previous && volumeDelta !== null ? (
        <Animated.View entering={enterUp(1)}>
          <SectionLabel>Vs last time</SectionLabel>
          <Card style={styles.compareCard}>
            <View style={styles.compareRow}>
              <View style={styles.compareCol}>
                <AppText variant="label" numberOfLines={1}>volume</AppText>
                <View style={styles.statValueRow}>
                  <AppText style={styles.compareNumbers} tabular numberOfLines={1}>
                    {formatSignedInt(volumeDelta)}
                  </AppText>
                  <AppText variant="caption" color={colors.textDim}>
                    {unitPref}
                  </AppText>
                </View>
              </View>
              {durationDelta !== null ? (
                <View style={styles.compareCol}>
                  <AppText variant="label" numberOfLines={1}>time</AppText>
                  <AppText style={styles.compareNumbers} tabular numberOfLines={1}>
                    {formatSignedClock(durationDelta)}
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText variant="caption" color={colors.textFaint} numberOfLines={1}>
              {previous.fuzzy
                ? `Closest match from ${posterDate(previous.workout.date)} — similar exercises, different name`
                : `Compared with ${posterDate(previous.workout.date)}`}
            </AppText>
          </Card>
        </Animated.View>
      ) : null}

      {prSets.length > 0 ? (
        <>
          <Animated.View entering={enterUp(2)}>
            <SectionLabel>New records</SectionLabel>
          </Animated.View>
          {prSets.map((s, i) => (
            <Animated.View key={s.id} entering={enterUp(Math.min(3 + i, 6))} style={styles.prRow}>
              <IconChip icon="trophy" color={colors.surfaceRaised} iconColor={colors.accent} />
              <AppText variant="bodyBold" numberOfLines={1} style={styles.prName}>
                {s.exerciseName}
              </AppText>
              <AppText style={styles.prNumbers} tabular numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                {`${formatWeightNumber(displayWeight(s.weightKg, unitPref))} ${unitPref} × ${s.reps}`}
              </AppText>
            </Animated.View>
          ))}
          <Button
            label={prSets.length === 1 ? 'Share this PR' : 'Share your PRs'}
            variant="ghost"
            onPress={() =>
              void Share.share({
                message:
                  prSets.length === 1
                    ? `New PR: ${prSets[0]!.exerciseName} ${formatWeightNumber(displayWeight(prSets[0]!.weightKg, unitPref))} ${unitPref} × ${prSets[0]!.reps}`
                    : `New PRs today:\n${prSets
                        .map(
                          (s) =>
                            `${s.exerciseName}: ${formatWeightNumber(displayWeight(s.weightKg, unitPref))} ${unitPref} × ${s.reps}`,
                        )
                        .join('\n')}`,
              }).catch(() => undefined)
            }
          />
        </>
      ) : null}

      {exerciseGroups.length > 0 ? (
        <>
          <Animated.View entering={enterUp(3)}>
            <SectionLabel>Exercises</SectionLabel>
          </Animated.View>
          {exerciseGroups.map((g, gi) => (
            <Animated.View
              key={g.exerciseId}
              entering={enterUp(Math.min(4 + gi, 8))}
              style={styles.exCard}
            >
              <View style={styles.exHeader}>
                <AppText variant="bodyBold" numberOfLines={1} style={styles.exName}>
                  {g.exerciseName}
                </AppText>
                <AppText variant="caption" color={colors.textDim} tabular numberOfLines={1}>
                  {`${Math.round(displayWeight(g.volumeKg, unitPref)).toLocaleString('en-US')} ${unitPref}`}
                </AppText>
              </View>
              {g.sets.map((s) => (
                <View key={s.id} style={styles.exSetRow}>
                  <AppText style={styles.exSetNo} tabular>
                    {String(s.setNo)}
                  </AppText>
                  <AppText style={styles.exSetNumbers} tabular numberOfLines={1}>
                    {`${formatWeightNumber(displayWeight(s.weightKg, unitPref))} × ${s.reps}`}
                  </AppText>
                  {s.rpe !== null ? (
                    <AppText variant="caption" color={colors.textFaint} tabular>
                      {`RPE ${s.rpe}`}
                    </AppText>
                  ) : null}
                  <View style={styles.exSetSpacer} />
                  {s.isPr ? <Tag label="PR" variant="filled" /> : null}
                </View>
              ))}
            </Animated.View>
          ))}
        </>
      ) : null}

      {topPrSet ? (
        <PrUpgradeCard
          topPr={{
            exerciseName: topPrSet.exerciseName,
            weightKg: topPrSet.weightKg,
            reps: topPrSet.reps,
            e1rm: epley1Rm(topPrSet.weightKg, topPrSet.reps),
          }}
          unit={unitPref}
        />
      ) : null}

      <Animated.View entering={enterUp(8)} style={styles.footer}>
        {sets.length > 0 ? (
          templateSaved ? (
            <AppText variant="caption" color={colors.textDim} center>
              Saved — find it under Your templates on the Train tab.
            </AppText>
          ) : (
            <Button
              label="Save as template"
              variant="ghost"
              onPress={openSaveSheet}
              accessibilityLabel="Save this workout as a template"
            />
          )
        ) : null}
        <Button
          label="Done"
          variant={showUpgrade ? 'secondary' : 'primary'}
          onPress={() => replacePath('/(tabs)')}
        />
      </Animated.View>

      {/* Name-and-save sheet — prefilled with the workout name, one tap to keep it. */}
      <Sheet visible={saveOpen} onClose={() => setSaveOpen(false)} title="Save as template">
        <View style={styles.sheetBody}>
          <AppText variant="caption" color={colors.textDim} tabular>
            {`${exerciseGroups.length} exercises · ${sets.length} sets`}
          </AppText>
          <AppTextInput
            value={templateName}
            onChangeText={setTemplateName}
            placeholder="Template name"
            maxLength={40}
            accessibilityLabel="Template name"
          />
          <Button
            label="Save template"
            onPress={saveAsTemplate}
            style={styles.sheetButton}
            accessibilityLabel={`Save ${templateName || 'workout'} as a template`}
          />
        </View>
      </Sheet>
    </Screen>
  );
}
