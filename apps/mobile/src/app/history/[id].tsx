import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { displayWeight, unitLabel } from '@gym/shared';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  ConfirmDialog,
  Divider,
  enterDown,
  enterUp,
  Screen,
  SectionLabel,
  StatBlock,
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

/** Full session detail: header stats, every set per exercise, vs-last-time. */

const styles = StyleSheet.create({
  headingWrap: { marginBottom: spacing.sm },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  // Equal, shrinkable shares so a big volume number can't push "prs" off the card.
  statCol: { flexShrink: 1, minWidth: 0 },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  setNo: { width: 20 },
  setNumbers: { fontFamily: type.display, fontSize: 20, color: colors.text, flex: 1 },
  vsLine: { marginTop: spacing.sm },
  deleteBtn: { marginTop: spacing.xxl },
  flagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  const flagged = useIsFlagged(workoutId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function doDelete(): Promise<void> {
    if (workout === null || deleting) return;
    setDeleting(true);
    const repo = await getRepo();
    await repo.deleteWorkout(workout.id);
    forgetWorkoutStats(workout.id);
    logHaptic();
    router.back();
  }

  return (
    <Screen scroll>
      <BackHeader />

      {workout === null ? (
        loaded ? (
          <AppText variant="body" color={colors.textDim}>
            This session is no longer in your log.
          </AppText>
        ) : null
      ) : (
        <>
          <Animated.View entering={enterDown(1)} style={styles.headingWrap}>
            <AppText variant="label">{posterDate(workout.date)}</AppText>
            <AppText variant="heading" numberOfLines={2}>
              {workout.name}
            </AppText>
          </Animated.View>

          <Animated.View entering={enterUp(0)} style={styles.statsRow}>
            <StatBlock label="time" value={clockLabel(workout.durationSec)} style={styles.statCol} />
            <StatBlock
              label="volume"
              value={formatCompact(displayWeight(stats?.volumeKg ?? 0, unitPref))}
              unit={unit}
              style={styles.statCol}
            />
            <StatBlock label="sets" value={stats?.setCount ?? 0} style={styles.statCol} />
            <StatBlock
              label="prs"
              value={stats?.prCount ?? 0}
              accent={(stats?.prCount ?? 0) > 0}
              style={styles.statCol}
            />
          </Animated.View>

          {flagged ? (
            <Animated.View entering={enterUp(1)} style={styles.flagRow}>
              <Ionicons name="information-circle-outline" size={18} color={colors.textDim} />
              <AppText variant="caption" color={colors.textDim} style={styles.flagText}>
                Not counted toward rankings — fix this entry?
              </AppText>
            </Animated.View>
          ) : null}

          {groups.map((g, gi) => {
            const comparison = vsLast[g.exerciseId];
            return (
              <Animated.View key={g.exerciseId} entering={enterUp(Math.min(gi + 1, 6))}>
                <SectionLabel>{g.exerciseName}</SectionLabel>
                <Divider />
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
                <Divider />
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
              </Animated.View>
            );
          })}

          <Animated.View entering={enterUp(Math.min(groups.length + 1, 7))}>
            <Button
              label="Delete workout"
              variant="danger"
              loading={deleting}
              onPress={() => setConfirmingDelete(true)}
              style={styles.deleteBtn}
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
