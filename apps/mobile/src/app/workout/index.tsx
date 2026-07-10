import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  ConfirmDialog,
  enterDown,
  enterFade,
  enterUp,
  FractionStat,
  layoutSpring,
} from '../../components/ui';
import { SuggestionRow } from '../../features/progression/components/SuggestionRow';
import { refreshServerSuggestions, useSuggestion } from '../../features/progression/hooks';
import { LogEditor } from '../../features/training/components/LogEditor';
import { RestTimerPanel } from '../../features/training/components/RestTimerPanel';
import { ExerciseSection } from '../../features/training/components/ExerciseSection';
import { PrCelebration } from '../../features/training/components/PrCelebration';
import { formatClock } from '../../features/training/logic';
import { pushPath, replacePath } from '../../features/training/nav';
import { useSession } from '../../features/training/session';
import { nowIso, secondsBetween } from '../../lib/dates';
import {
  clearActiveWorkout,
  showActiveWorkout,
  updateRest,
} from '../../lib/workoutNotification';
import { useProfile } from '../../state/profile';

/**
 * Gym mode — the active logger. One hand, sweaty thumbs:
 * scrollable exercise sections on top, pinned thumb-zone dock below.
 * Blocked language (REVAMP-BRIEF): the current exercise is the screen's ONE
 * red hero block (name + set x/y fraction) pinned above the editor; the rest
 * timer takes over as the cream counterpoint block; exercise sections stack
 * as borderless charcoal cards. The editor becomes the rest timer after
 * every logged set.
 */

/** Breathing room above the top strip — matches Screen's TOP_AIR so the
 * clock never kisses the viewport edge even when insets are 0 (web). */
const TOP_AIR = 16;
/** Keep phone-first line lengths on wide viewports — same cap as Screen. */
const MAX_CONTENT_WIDTH = 640;
/** Scoped tag so this screen's keep-awake claim can't collide with another. */
const KEEP_AWAKE_TAG = 'workout-session';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  /** Center the content column on wide viewports (web/tablet). */
  contentCap: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
  topStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.sm,
  },
  /** Eyebrow (workout name) over the big Oswald elapsed clock — header order. */
  clockWrap: { flex: 1, gap: spacing.xs },
  clock: { lineHeight: 46 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.xl },
  /** Charcoal exercise card — borderless block; the section's own bottom
   * margin (spacing.lg) provides the inner bottom inset, hence paddingBottom 0. */
  exerciseCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.lg,
    paddingBottom: 0,
    marginBottom: spacing.md,
  },
  /** Pinned thumb-zone dock — canvas-colored; the blocks inside carry the color. */
  dock: {
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  /** The screen's ONE red hero block: current exercise + set fraction. */
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.blockRed,
    borderRadius: radius.block,
    padding: spacing.gutter,
  },
  heroLeft: { flex: 1, gap: spacing.xs },
  /** Charcoal block housing the suggestion row + log editor. */
  editorBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.lg,
  },
  /** Cream counterpoint block — the rest-timer takeover. */
  creamBlock: {
    backgroundColor: colors.blockCream,
    borderRadius: radius.block,
    padding: spacing.gutter,
  },
  empty: { alignItems: 'center', paddingVertical: spacing.md, gap: spacing.sm },
  addBtn: { alignSelf: 'center', marginTop: spacing.sm },
  celebrationOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function WorkoutScreen() {
  const insets = useSafeAreaInsets();
  const unitPref = useProfile((s) => s.unitPref);
  const session = useSession();
  const [ready, setReady] = useState(session.status === 'active');
  const [elapsed, setElapsed] = useState(0);
  const [logging, setLogging] = useState(false);
  /** Branded finish confirmation: 'finish' saves, 'discard' throws away an empty session. */
  const [finishPrompt, setFinishPrompt] = useState<null | 'finish' | 'discard'>(null);
  /** Progression target the user tapped Apply on — piped into the editor prefill. */
  const [appliedSuggestion, setAppliedSuggestion] = useState<{
    exerciseId: string;
    weightKg: number;
    reps: number;
  } | null>(null);

  // Suggested next target for the exercise under the editor. The hook is
  // local-first; the one-shot fetch below only adds coach-review state.
  const currentExercise = session.exercises[session.currentIdx] ?? null;
  const suggestion = useSuggestion(
    currentExercise
      ? {
          exerciseId: currentExercise.exerciseId,
          exerciseName: currentExercise.exerciseName,
          repRange: currentExercise.repRange,
        }
      : null,
  );

  // Workout start: pull coach-reviewed suggestions once. Fire-and-forget —
  // offline or unreviewed silently falls back to the local engine result.
  useEffect(() => {
    void refreshServerSuggestions();
  }, []);

  // Memoized: the elapsed clock re-renders this screen every second, and a
  // fresh object literal per render would refire LogEditor's prefill effect
  // on every tick — snapping the steppers back to the applied target while
  // the user is adjusting them.
  const currentExerciseId = currentExercise?.exerciseId ?? null;
  const appliedForCurrent = useMemo(
    () =>
      appliedSuggestion !== null && appliedSuggestion.exerciseId === currentExerciseId
        ? { weightKg: appliedSuggestion.weightKg, reps: appliedSuggestion.reps }
        : null,
    [appliedSuggestion, currentExerciseId],
  );

  // Resume from the repo if the store is cold (app restart, deep link).
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const ok = await useSession.getState().hydrate();
      if (!mounted) return;
      if (!ok) {
        replacePath('/(tabs)/train');
        return;
      }
      setReady(true);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Ticking elapsed clock in the top strip.
  const startedAt = session.startedAt;
  useEffect(() => {
    if (!startedAt) return;
    setElapsed(secondsBetween(startedAt, nowIso()));
    const t = setInterval(() => setElapsed(secondsBetween(startedAt, nowIso())), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  // Ongoing status-bar notification mirroring the live workout (Android only;
  // no-op elsewhere). Present once when the workout becomes active…
  const isActive = ready && session.status === 'active';
  const workoutName = session.workoutName;
  useEffect(() => {
    if (!isActive) return;
    void showActiveWorkout({ workoutName, elapsedLabel: formatClock(elapsed) });
    // Only re-fire the initial show when the session flips to active. `elapsed`
    // is intentionally read fresh here but excluded from deps — the tick effect
    // below keeps the body current (updateRest throttles the spam).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, workoutName]);

  // …then keep it current on every tick / rest change. updateRest throttles to
  // ~once per 3s internally, so driving it from the 1s tick is safe.
  const restRemainingSec = session.rest ? session.rest.remainingSec : null;
  useEffect(() => {
    if (!isActive) return;
    void updateRest({
      workoutName,
      restRemainingLabel: restRemainingSec === null ? null : formatClock(restRemainingSec),
      elapsedLabel: formatClock(elapsed),
    });
  }, [isActive, workoutName, restRemainingSec, elapsed]);

  // Keep the screen awake for the length of the workout — sweaty thumbs
  // shouldn't have to fight a lock timeout mid-set.
  useEffect(() => {
    if (!isActive) return;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [isActive]);

  // Fire the PR burst once per flashed set — decoupled from flashSetId's own
  // lifetime (the row clears its flash well before the burst finishes).
  const [celebrateId, setCelebrateId] = useState<string | null>(null);
  useEffect(() => {
    if (session.flashSetId && session.flashSetId !== celebrateId) {
      setCelebrateId(session.flashSetId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.flashSetId]);

  // Clear on unmount — covers navigation away / screen teardown so no stale
  // "workout in progress" lingers (finish/discard also clear explicitly below).
  useEffect(() => {
    return () => {
      void clearActiveWorkout();
    };
  }, []);

  if (!ready || session.status !== 'active') {
    return <View style={styles.root} />;
  }

  const totalSets = session.exercises.reduce((n, e) => n + e.loggedSets.length, 0);

  const doFinish = async (): Promise<void> => {
    void clearActiveWorkout();
    const id = await useSession.getState().finish();
    if (id) replacePath(`/workout/complete?id=${id}`);
  };

  const doDiscard = async (): Promise<void> => {
    void clearActiveWorkout();
    await useSession.getState().discard();
    replacePath('/(tabs)/train');
  };

  const handleFinish = (): void => {
    setFinishPrompt(totalSets === 0 ? 'discard' : 'finish');
  };

  const handleLog = (weightKg: number, reps: number): void => {
    if (logging) return;
    setLogging(true);
    void useSession
      .getState()
      .commitSet(weightKg, reps)
      .finally(() => setLogging(false));
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + TOP_AIR }]}>
      <Animated.View entering={enterDown(0)} style={[styles.contentCap, styles.topStrip]}>
        <View style={styles.clockWrap}>
          <AppText variant="label" numberOfLines={1}>
            {session.workoutName}
          </AppText>
          <AppText variant="display" tabular style={styles.clock}>
            {formatClock(elapsed)}
          </AppText>
        </View>
        <Button label="FINISH" variant="secondary" onPress={handleFinish} accessibilityLabel="Finish workout" />
      </Animated.View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.contentCap, styles.scrollContent]}
      >
        {session.exercises.map((ex, i) => (
          <Animated.View
            key={ex.exerciseId}
            entering={enterUp(Math.min(i, 8))}
            layout={layoutSpring}
            style={styles.exerciseCard}
          >
            <ExerciseSection
              exercise={ex}
              isCurrent={i === session.currentIdx}
              flashSetId={session.flashSetId}
              unitPref={unitPref}
              onSelect={() => useSession.getState().setCurrent(i)}
              onFlashDone={() => useSession.getState().clearFlash()}
            />
          </Animated.View>
        ))}
        {session.exercises.length === 0 ? (
          <View style={styles.empty}>
            <AppText variant="body" color={colors.textDim} center>
              Freestyle session — add your first exercise.
            </AppText>
          </View>
        ) : null}
        <Animated.View entering={enterUp(Math.min(session.exercises.length, 8))} layout={layoutSpring}>
          <Button
            label="+ Add exercise"
            variant="ghost"
            onPress={() => pushPath('/exercises?select=1')}
            style={styles.addBtn}
            accessibilityLabel="Add exercise to workout"
          />
        </Animated.View>
      </ScrollView>

      <Animated.View
        entering={enterUp(1)}
        style={[
          styles.contentCap,
          styles.dock,
          { paddingBottom: Math.max(insets.bottom, spacing.lg) },
        ]}
      >
        {/* The ONE red hero block: what you're lifting + which set you're on. */}
        {currentExercise ? (
          <View style={styles.hero}>
            <View style={styles.heroLeft}>
              <AppText variant="label" color={colors.onBlock}>
                Now lifting
              </AppText>
              <AppText variant="title" color={colors.onBlock} numberOfLines={2}>
                {currentExercise.exerciseName}
              </AppText>
            </View>
            <FractionStat
              value={currentExercise.loggedSets.length + 1}
              total={currentExercise.targetSets}
              label="Set"
              onBlock
            />
          </View>
        ) : null}
        {/* Keyed wrappers so the timer↔editor swap fades instead of popping. */}
        {session.rest ? (
          <Animated.View key="rest" entering={enterFade(0)} style={styles.creamBlock}>
            <RestTimerPanel
              rest={session.rest}
              onAdjust={(d) => useSession.getState().adjustRest(d)}
              onSkip={() => useSession.getState().skipRest()}
            />
          </Animated.View>
        ) : currentExercise ? (
          <Animated.View key="editor" entering={enterFade(0)} style={styles.editorBlock}>
            {suggestion && currentExercise.loggedSets.length === 0 ? (
              <SuggestionRow
                suggestion={suggestion}
                unitPref={unitPref}
                applied={appliedForCurrent !== null}
                onApply={(weightKg, reps) =>
                  setAppliedSuggestion({
                    exerciseId: currentExercise.exerciseId,
                    weightKg,
                    reps,
                  })
                }
              />
            ) : null}
            <LogEditor
              exercise={currentExercise}
              unitPref={unitPref}
              onLog={handleLog}
              logging={logging}
              appliedSuggestion={appliedForCurrent}
            />
          </Animated.View>
        ) : (
          <View style={[styles.editorBlock, styles.empty]}>
            <Button
              label="Add exercise"
              variant="secondary"
              onPress={() => pushPath('/exercises?select=1')}
            />
          </View>
        )}
      </Animated.View>

      {/* Branded finish confirmations — no system alerts. */}
      <ConfirmDialog
        visible={finishPrompt === 'finish'}
        title="Finish workout?"
        message={
          totalSets === 1
            ? 'Only 1 set logged — save it and see your recap?'
            : 'Save this session and see your recap.'
        }
        confirmLabel="Finish"
        cancelLabel="Keep training"
        onConfirm={() => {
          setFinishPrompt(null);
          void doFinish();
        }}
        onCancel={() => setFinishPrompt(null)}
      />
      <ConfirmDialog
        visible={finishPrompt === 'discard'}
        title="Discard workout?"
        message="Nothing logged yet — this session won't be saved."
        confirmLabel="Discard"
        cancelLabel="Keep training"
        danger
        onConfirm={() => {
          setFinishPrompt(null);
          void doDiscard();
        }}
        onCancel={() => setFinishPrompt(null)}
      />

      {celebrateId ? (
        <View style={styles.celebrationOverlay} pointerEvents="none">
          <PrCelebration key={celebrateId} onDone={() => setCelebrateId(null)} />
        </View>
      ) : null}
    </View>
  );
}
