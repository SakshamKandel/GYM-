import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { displayWeight, unitLabel } from '@gym/shared';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  enterDown,
  enterUp,
  Screen,
  Tag,
} from '../../components/ui';
import { BackHeader } from '../../features/body/components/BackHeader';
import { forgetWorkoutStats, useWorkoutDetail } from '../../features/history/hooks';
import { clockLabel, formatCompact, formatWeightNumber, vsLastLine } from '../../features/history/logic';
import { getGamificationFlagForWorkout } from '../../lib/api/gamification';
import { posterDate } from '../../lib/dates';
import { logHaptic } from '../../lib/haptics';
import { getRepo } from '../../lib/repo';
import { useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';

/**
 * True if this workout is currently unranked (plausibility-flagged). Quiet,
 * best-effort — see history/index.tsx's identical hook for the rationale;
 * duplicated rather than shared since neither screen owns a common
 * feature/history file in the MOBILE-SOCIAL ownership map.
 *
 * Uses the single-workout lookup (not the 20-newest list) so an older
 * flagged workout still shows the notice correctly.
 */
function useIsFlagged(workoutId: string | undefined): boolean {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const [flagged, setFlagged] = useState(false);

  useEffect(() => {
    if (workoutId === undefined || status !== 'signedIn' || token === null) {
      setFlagged(false);
      return;
    }
    let mounted = true;
    void (async () => {
      try {
        const flag = await getGamificationFlagForWorkout(token, workoutId);
        if (mounted) setFlagged(flag !== null);
      } catch {
        // Best-effort — stays unflagged this load.
      }
    })();
    return () => {
      mounted = false;
    };
  }, [workoutId, status, token]);

  return flagged;
}

/**
 * True when the primary session fetch rejects. useWorkoutDetail swallows this:
 * if getWorkout/getSetsForWorkout throws it never flips `loaded`, so the screen
 * would otherwise sit blank forever. This mirrors that same primary fetch purely
 * to observe success vs. failure, letting the screen show an explicit error.
 */
function useWorkoutLoadError(workoutId: string | undefined): boolean {
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
    if (workoutId === undefined) return;
    let mounted = true;
    void (async () => {
      try {
        const repo = await getRepo();
        await Promise.all([repo.getWorkout(workoutId), repo.getSetsForWorkout(workoutId)]);
      } catch {
        if (mounted) setError(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [workoutId]);

  return error;
}

/** Full session detail: red summary block, every set per exercise, vs-last-time. */

const styles = StyleSheet.create({
  headingWrap: { marginBottom: spacing.lg, gap: spacing.sm },
  title: { textTransform: 'uppercase' },
  loadingWrap: { paddingVertical: spacing.xxl, alignItems: 'center' },
  // The screen's ONE red block: date eyebrow, Oswald volume headline, meta pills.
  summary: { gap: spacing.md },
  volumeRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  volumeValue: { flexShrink: 1 },
  volumeUnit: { opacity: 0.6 },
  summaryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  breakdownLabel: { marginTop: spacing.xl, marginBottom: spacing.xs },
  // Charcoal exercise blocks — fill contrast, no hairline dividers.
  groupCard: { marginTop: spacing.md },
  groupTitle: { marginBottom: spacing.xs },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  setNo: { width: 20 },
  setNumbers: { fontFamily: type.display, fontSize: 20, color: colors.text, flex: 1 },
  vsLine: { marginTop: spacing.sm },
  deleteWrap: { marginTop: spacing.xxl },
  deleteError: { marginBottom: spacing.sm },
  flagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  flagText: { flex: 1 },
});

export default function HistoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const workoutId = typeof id === 'string' && id.length > 0 ? id : undefined;
  const unitPref = useProfile((s) => s.unitPref);
  const unit = unitLabel(unitPref);
  const { workout, loaded, stats, groups, vsLast } = useWorkoutDetail(workoutId);
  const loadError = useWorkoutLoadError(workoutId);
  const flagged = useIsFlagged(workoutId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  async function doDelete(): Promise<void> {
    if (workout === null || deleting) return;
    setDeleting(true);
    setDeleteError(false);
    try {
      const repo = await getRepo();
      await repo.deleteWorkout(workout.id);
      forgetWorkoutStats(workout.id);
      logHaptic();
      router.back();
    } catch {
      setDeleteError(true);
    } finally {
      setDeleting(false);
    }
  }

  const prCount = stats?.prCount ?? 0;

  return (
    <Screen scroll>
      <BackHeader />

      {loadError ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Couldn't open this session"
          body="Something went wrong loading this workout. Head back and try again."
        />
      ) : !loaded ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : workout === null ? (
        <AppText variant="body" color={colors.textDim}>
          This session is no longer in your log.
        </AppText>
      ) : (
        <>
          <Animated.View entering={enterDown(1)} style={styles.headingWrap}>
            <AppText variant="label">Session</AppText>
            <AppText variant="display" numberOfLines={2} style={styles.title}>
              {workout.name}
            </AppText>
          </Animated.View>

          <Animated.View entering={enterUp(0)}>
            <Card variant="red" style={styles.summary}>
              <AppText variant="label" color={colors.onBlock}>
                {posterDate(workout.date)}
              </AppText>
              <View style={styles.volumeRow}>
                <AppText
                  variant="stat"
                  color={colors.onBlock}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                  style={styles.volumeValue}
                >
                  {formatCompact(displayWeight(stats?.volumeKg ?? 0, unitPref))}
                </AppText>
                <AppText variant="title" color={colors.onBlock} style={styles.volumeUnit}>
                  {`${unit} total`}
                </AppText>
              </View>
              <View style={styles.summaryChips}>
                <Tag variant="onBlock" label={clockLabel(workout.durationSec)} />
                <Tag variant="onBlock" label={`${stats?.setCount ?? 0} sets`} />
                <Tag variant="onBlock" label={prCount === 1 ? '1 PR' : `${prCount} PRS`} />
              </View>
            </Card>
          </Animated.View>

          {flagged ? (
            <Animated.View entering={enterUp(1)} style={styles.flagRow}>
              <Ionicons name="information-circle-outline" size={18} color={colors.textDim} />
              <AppText variant="caption" color={colors.textDim} style={styles.flagText}>
                Not counted toward rankings — fix this entry?
              </AppText>
            </Animated.View>
          ) : null}

          <Animated.View entering={enterUp(1)} style={styles.breakdownLabel}>
            <AppText variant="label">
              {`Exercise breakdown · ${groups.length}`}
            </AppText>
          </Animated.View>

          {groups.map((g, gi) => {
            const comparison = vsLast[g.exerciseId];
            return (
              <Animated.View key={g.exerciseId} entering={enterUp(Math.min(gi + 2, 6))}>
                <Card style={styles.groupCard}>
                  <AppText variant="title" numberOfLines={2} style={styles.groupTitle}>
                    {g.exerciseName}
                  </AppText>
                  {g.sets.map((s, si) => (
                    <View key={s.id} style={styles.setRow}>
                      <AppText variant="caption" color={colors.textFaint} tabular style={styles.setNo}>
                        {si + 1}
                      </AppText>
                      <AppText style={styles.setNumbers} tabular numberOfLines={1}>
                        {`${formatWeightNumber(displayWeight(s.weightKg, unitPref))} ${unit} × ${s.reps}`}
                      </AppText>
                      {s.rpe !== null ? <AppText variant="caption">{`RPE ${s.rpe}`}</AppText> : null}
                      {s.isPr ? <Tag label="PR" variant="filled" /> : null}
                    </View>
                  ))}
                  {comparison !== undefined ? (
                    <AppText variant="caption" style={styles.vsLine}>
                      {comparison.kind === 'first'
                        ? 'First time logging this one — nothing to compare yet.'
                        : vsLastLine(
                            displayWeight(comparison.deltaVolumeKg, unitPref),
                            displayWeight(comparison.deltaBestKg, unitPref),
                            unit,
                          )}
                    </AppText>
                  ) : null}
                </Card>
              </Animated.View>
            );
          })}

          <Animated.View
            entering={enterUp(Math.min(groups.length + 2, 7))}
            style={styles.deleteWrap}
          >
            {deleteError ? (
              <AppText variant="caption" color={colors.error} center style={styles.deleteError}>
                {"Couldn't delete — try again."}
              </AppText>
            ) : null}
            <Button
              label="Delete workout"
              variant="danger"
              loading={deleting}
              onPress={() => setConfirmingDelete(true)}
            />
          </Animated.View>
        </>
      )}

      <ConfirmDialog
        visible={confirmingDelete}
        title="Delete this workout?"
        message="The session and its sets come off your log for good."
        confirmLabel="Delete"
        cancelLabel="Keep it"
        danger
        onConfirm={() => {
          setConfirmingDelete(false);
          void doDelete();
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </Screen>
  );
}
