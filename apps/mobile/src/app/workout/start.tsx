import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLocalSearchParams } from 'expo-router';
import type { WorkoutLog } from '@gym/shared';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, Button, enterFade } from '../../components/ui';
import { isSessionStale, sessionAgeLabel } from '../../features/training/logic';
import { replacePath } from '../../features/training/nav';
import { useSession } from '../../features/training/session';
import { getRepo } from '../../lib/repo';

/**
 * /workout/start?planWorkoutId=<id> — route contract shared with the Home tab.
 * Creates the workout log (or resumes an already-active one) and hands off to
 * the logger. No param → freestyle session.
 *
 * One extra stop: a session left open for hours (phone died, forgot to press
 * finish) is NOT silently adopted. Every start would otherwise quietly reopen
 * it — days later, with the wrong exercises and a running clock — so the
 * member gets an explicit keep-or-start-fresh choice instead. Fresh sessions
 * still resume straight through, which is what "resume" is supposed to mean.
 */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.gutter,
  },
  center: { alignItems: 'center', gap: spacing.md, alignSelf: 'stretch' },
  actions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm },
});

export default function StartWorkoutScreen() {
  const { planWorkoutId } = useLocalSearchParams<{ planWorkoutId?: string }>();
  const [failed, setFailed] = useState(false);
  /** Set only when an abandoned session needs a decision before anything starts. */
  const [stale, setStale] = useState<WorkoutLog | null>(null);
  const [busy, setBusy] = useState(false);

  const requestedId =
    typeof planWorkoutId === 'string' && planWorkoutId.length > 0 ? planWorkoutId : null;

  // Navigating (or setting state) after this screen is gone would hijack
  // whatever the member moved on to.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const beginWorkout = useCallback(async () => {
    try {
      await useSession.getState().start(requestedId);
      if (mountedRef.current) replacePath('/workout');
    } catch {
      if (mountedRef.current) setFailed(true);
    }
  }, [requestedId]);

  useEffect(() => {
    void (async () => {
      // Local read only — offline-safe, and it never blocks logging.
      const repo = await getRepo();
      const active = await repo.getActiveWorkout();
      if (!mountedRef.current) return;
      if (active !== null && isSessionStale(active.startedAt)) {
        setStale(active);
        return;
      }
      await beginWorkout();
    })();
  }, [beginWorkout]);

  const resumeStale = (): void => {
    if (busy) return;
    setBusy(true);
    // The logger rebuilds itself from the repo on mount (hydrate).
    replacePath('/workout');
  };

  const startFresh = (): void => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      await useSession.getState().discard();
      await beginWorkout();
    })();
  };

  return (
    <View style={styles.root}>
      <Animated.View entering={enterFade(0)} style={styles.center}>
        {failed ? (
          <>
            <AppText variant="bodyBold">Workout unavailable</AppText>
            <AppText variant="body" color={colors.textDim} center>
              This workout is no longer published for your account.
            </AppText>
            <Button
              label="Back to Train"
              variant="secondary"
              onPress={() => replacePath('/(tabs)/train')}
            />
          </>
        ) : stale !== null ? (
          <>
            <AppText variant="bodyBold" center>
              {`Still working on ${stale.name}?`}
            </AppText>
            <AppText variant="body" color={colors.textDim} center>
              {`It has been open for ${sessionAgeLabel(stale.startedAt)}. Pick it back up, or start fresh. Starting fresh throws away the sets logged in it.`}
            </AppText>
            <View style={styles.actions}>
              <Button
                label="Pick it back up"
                onPress={resumeStale}
                loading={busy}
                accessibilityLabel={`Resume ${stale.name}`}
              />
              <Button
                label="Start fresh"
                variant="secondary"
                onPress={startFresh}
                accessibilityLabel="Discard the old workout and start a new one"
              />
            </View>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.accent} />
            <AppText variant="label" color={colors.textDim}>Starting…</AppText>
          </>
        )}
      </Animated.View>
    </View>
  );
}
