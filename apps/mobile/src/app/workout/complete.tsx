import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
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
  enterDown,
  enterUp,
  Screen,
  SectionLabel,
  Sheet,
  StatBlock,
  Tag,
} from '../../components/ui';
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
import { getRepo } from '../../lib/repo';
import { getPlanWorkout } from '../../lib/seed/plans';
import { useProfile } from '../../state/profile';

/**
 * Editorial recap: duration · volume · sets (· effort), vs-last-time deltas,
 * the PR ledger, and a per-exercise breakdown. A post-workout glance screen —
 * everything scannable, nothing demanding.
 */

/** The previous finished run of this same workout, for the comparison card. */
interface PreviousRun {
  workout: WorkoutLog;
  volumeKg: number;
}

const styles = StyleSheet.create({
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  prRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingLeft: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  prNumbers: { fontFamily: type.display, fontSize: 24, color: colors.text, flexShrink: 0 },
  prName: { flex: 1, minWidth: 0 },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, minWidth: 0 },
  // Each recap stat gets an equal, shrinkable share of the row so a big
  // volume number can't push its neighbours off the card edge.
  statCol: { flexShrink: 1, minWidth: 0 },
  compareCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  compareRow: { flexDirection: 'row', gap: spacing.md },
  compareCol: { flex: 1, minWidth: 0 },
  compareNumbers: { fontFamily: type.display, fontSize: 26, color: colors.text },
  exCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
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
});

export default function WorkoutCompleteScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const unitPref = useProfile((s) => s.unitPref);
  const tier = useProfile((s) => s.tier);
  const [workout, setWorkout] = useState<WorkoutLog | null>(null);
  const [sets, setSets] = useState<SetLog[]>([]);
  const [previous, setPrevious] = useState<PreviousRun | null>(null);
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
      const prev = recent.find(
        (r) =>
          r.id !== w.id &&
          r.startedAt < w.startedAt &&
          (w.planWorkoutId !== null
            ? r.planWorkoutId === w.planWorkoutId
            : r.planWorkoutId === null && r.name === w.name),
      );
      if (!prev) return;
      const prevSets = await repo.getSetsForWorkout(prev.id);
      if (mounted) setPrevious({ workout: prev, volumeKg: totalVolumeKg(prevSets) });
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

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
      <Animated.View entering={enterDown(0)}>
        <AppText variant="label" color={colors.textDim}>
          {workout?.name ?? ''}
        </AppText>
        <AppText variant="heading">Workout complete</AppText>
      </Animated.View>

      <View style={styles.statsRow}>
        <Animated.View entering={enterUp(0)} style={styles.statCol}>
          <StatBlock label="time" value={formatClock(workout?.durationSec ?? 0)} />
        </Animated.View>
        <Animated.View entering={enterUp(1)} style={styles.statCol}>
          <AppText variant="label" numberOfLines={1}>volume</AppText>
          <View style={styles.statValueRow}>
            <AnimatedNumber value={volume} grouped variant="display" style={styles.statCol} />
            <AppText variant="caption" color={colors.textDim}>
              {unitPref}
            </AppText>
          </View>
        </Animated.View>
        <Animated.View entering={enterUp(2)} style={styles.statCol}>
          <AppText variant="label" numberOfLines={1}>sets</AppText>
          <View style={styles.statValueRow}>
            <AnimatedNumber value={sets.length} variant="display" style={styles.statCol} />
          </View>
        </Animated.View>
        {avgRpe !== null ? (
          <Animated.View entering={enterUp(3)} style={styles.statCol}>
            <StatBlock label="effort" value={formatWeightNumber(avgRpe)} unit="rpe" />
          </Animated.View>
        ) : null}
      </View>

      {previous && volumeDelta !== null ? (
        <Animated.View entering={enterUp(4)}>
          <SectionLabel>Vs last time</SectionLabel>
          <View style={styles.compareCard}>
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
              {`Compared with ${posterDate(previous.workout.date)}`}
            </AppText>
          </View>
        </Animated.View>
      ) : null}

      {prSets.length > 0 ? (
        <>
          <Animated.View entering={enterUp(5)}>
            <SectionLabel>New records</SectionLabel>
          </Animated.View>
          {prSets.map((s, i) => (
            <Animated.View key={s.id} entering={enterUp(Math.min(6 + i, 8))} style={styles.prRow}>
              <AppText variant="bodyBold" numberOfLines={1} style={styles.prName}>
                {s.exerciseName}
              </AppText>
              <AppText style={styles.prNumbers} tabular numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                {`${formatWeightNumber(displayWeight(s.weightKg, unitPref))} ${unitPref} × ${s.reps}`}
              </AppText>
            </Animated.View>
          ))}
        </>
      ) : null}

      {exerciseGroups.length > 0 ? (
        <>
          <Animated.View entering={enterUp(6)}>
            <SectionLabel>Exercises</SectionLabel>
          </Animated.View>
          {exerciseGroups.map((g, gi) => (
            <Animated.View
              key={g.exerciseId}
              entering={enterUp(Math.min(7 + gi, 8))}
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
                  {s.isPr ? <Tag label="PR" /> : null}
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

      <Animated.View entering={enterUp(7)} style={styles.footer}>
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
