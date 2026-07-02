import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
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
  layoutSpring,
} from '../../components/ui';
import { LogEditor } from '../../features/training/components/LogEditor';
import { RestTimerPanel } from '../../features/training/components/RestTimerPanel';
import { ExerciseSection } from '../../features/training/components/ExerciseSection';
import { formatClock } from '../../features/training/logic';
import { pushPath, replacePath } from '../../features/training/nav';
import { useSession } from '../../features/training/session';
import { nowIso, secondsBetween } from '../../lib/dates';
import { useProfile } from '../../state/profile';

/**
 * Gym mode — the active logger. One hand, sweaty thumbs:
 * scrollable exercise sections on top, pinned thumb-zone editor below.
 * The editor becomes the rest timer after every logged set.
 */

/** Breathing room above the top strip — matches Screen's TOP_AIR so the
 * clock never kisses the viewport edge even when insets are 0 (web). */
const TOP_AIR = 16;
/** Keep phone-first line lengths on wide viewports — same cap as Screen. */
const MAX_CONTENT_WIDTH = 640;

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
    paddingHorizontal: 20,
    paddingVertical: spacing.sm,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: spacing.xl },
  editor: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  empty: { alignItems: 'center', paddingVertical: spacing.md, gap: spacing.sm },
  addBtn: { alignSelf: 'center', marginTop: spacing.sm },
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

  if (!ready || session.status !== 'active') {
    return <View style={styles.root} />;
  }

  const totalSets = session.exercises.reduce((n, e) => n + e.loggedSets.length, 0);
  const currentExercise = session.exercises[session.currentIdx] ?? null;

  const doFinish = async (): Promise<void> => {
    const id = await useSession.getState().finish();
    if (id) replacePath(`/workout/complete?id=${id}`);
  };

  const doDiscard = async (): Promise<void> => {
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
        <View>
          <AppText variant="display" tabular style={{ fontSize: 34, lineHeight: 40 }}>
            {formatClock(elapsed)}
          </AppText>
          <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
            {session.workoutName}
          </AppText>
        </View>
        <Button label="FINISH" variant="ghost" onPress={handleFinish} accessibilityLabel="Finish workout" />
      </Animated.View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.contentCap, styles.scrollContent]}
      >
        {session.exercises.map((ex, i) => (
          <Animated.View key={ex.exerciseId} entering={enterUp(Math.min(i, 8))} layout={layoutSpring}>
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
          styles.editor,
          { paddingBottom: Math.max(insets.bottom, spacing.lg) },
        ]}
      >
        {/* Keyed wrappers so the timer↔editor swap fades instead of popping. */}
        {session.rest ? (
          <Animated.View key="rest" entering={enterFade(0)}>
            <RestTimerPanel
              rest={session.rest}
              onAdjust={(d) => useSession.getState().adjustRest(d)}
              onSkip={() => useSession.getState().skipRest()}
            />
          </Animated.View>
        ) : currentExercise ? (
          <Animated.View key="editor" entering={enterFade(0)}>
            <LogEditor
              exercise={currentExercise}
              unitPref={unitPref}
              onLog={handleLog}
              logging={logging}
            />
          </Animated.View>
        ) : (
          <View style={styles.empty}>
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
    </View>
  );
}
