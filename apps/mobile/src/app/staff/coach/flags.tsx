import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  ConfirmDialog,
  Divider,
  enterDown,
  enterUp,
  layoutSpring,
  PressableScale,
  Screen,
  ScreenHeader,
  Tag,
} from '../../../components/ui';
import {
  getCoachFlags,
  restoreCoachFlag,
  toStaffError,
  type CoachFlagRow,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { pushStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { successHaptic } from '../../../lib/haptics';
import { useAuth } from '../../../state/auth';

/**
 * Coach · Flags — flagged (unranked) workouts, the phone twin of the web
 * `/coach/flags` `FlagsList`. Unacknowledged-first (server order, no
 * re-sort). Acknowledge is a one-tap idempotent seen-mark; Restore clears a
 * false positive (re-ranks the workout so it counts toward badges/
 * leaderboards/PR credit again) — the ONLY path to un-flag a workout, so it
 * sits behind a ConfirmDialog. Copy stays neutral throughout: no accusations.
 */

const REASON_LABEL: Record<string, string> = {
  absolute_bounds: 'Outside plausible limits',
  velocity: 'Jumped well past recent bests',
};

const REASON_DETAIL: Record<string, string> = {
  absolute_bounds:
    'A logged weight, rep count, or estimated one-rep max fell outside what the plausibility check allows.',
  velocity:
    'The estimated one-rep max for a lift came in over 20% above this member’s rolling 90-day best.',
};

function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have coach access.";
  return "Couldn't load the flags list.";
}

function rowErrorLine(code: StaffErrorCode, action: 'acknowledge' | 'restore'): string {
  if (code === 'forbidden') return 'This client is no longer assigned to you.';
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  return action === 'restore'
    ? "Couldn't restore this workout. Try again."
    : "Couldn't acknowledge this flag. Try again.";
}

/** "82.5 kg" / "100 kg" — canonical kg, one decimal max. */
function formatKg(kg: number): string {
  const rounded = Math.round(kg * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} kg`;
}

function FlagCard({
  item,
  index,
  busy,
  busyAction,
  error,
  onAcknowledge,
  onRestore,
}: {
  item: CoachFlagRow;
  index: number;
  busy: boolean;
  busyAction: 'acknowledge' | 'restore' | null;
  error: string | null;
  onAcknowledge: () => void;
  onRestore: () => void;
}) {
  const reason = item.reason ?? '';
  const reasonLabel = REASON_LABEL[reason] ?? (reason || 'Flagged');
  const reasonDetail = REASON_DETAIL[reason] ?? null;

  return (
    <Animated.View entering={enterUp(index)} layout={layoutSpring} style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cardTitle}>
          <View style={styles.nameLine}>
            <AppText variant="bodyBold" numberOfLines={1} style={styles.name}>
              {item.name || 'Workout'}
            </AppText>
            {item.acked ? <Tag label="Acknowledged" variant="outline" color={colors.success} /> : null}
          </View>
          <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
            {item.displayName || 'Member'} · {item.date}
          </AppText>
        </View>
        <Tag label={reasonLabel} variant="outline" color={colors.warning} />
      </View>

      {item.topSet ? (
        <>
          <Divider />
          <AppText variant="caption" color={colors.textDim}>
            Heaviest set logged:{' '}
            <AppText variant="caption" tabular color={colors.text}>
              {item.topSet.exerciseName} — {formatKg(item.topSet.weightKg)} × {item.topSet.reps}{' '}
              {item.topSet.reps === 1 ? 'rep' : 'reps'}
            </AppText>
          </AppText>
        </>
      ) : null}

      {reasonDetail ? (
        <AppText variant="caption" color={colors.textFaint}>
          {reasonDetail}
        </AppText>
      ) : null}

      {error ? (
        <AppText variant="caption" color={colors.error}>
          {error}
        </AppText>
      ) : null}

      <View style={styles.cardActions}>
        <Button
          label="Restore"
          variant="ghost"
          disabled={busy}
          loading={busy && busyAction === 'restore'}
          onPress={onRestore}
          style={styles.actionBtn}
        />
        <Button
          label={item.acked ? 'Acknowledged' : busy && busyAction === 'acknowledge' ? 'Saving…' : 'Acknowledge'}
          variant="secondary"
          disabled={busy || item.acked}
          loading={busy && busyAction === 'acknowledge'}
          onPress={onAcknowledge}
          style={styles.actionBtn}
        />
      </View>
    </Animated.View>
  );
}

export default function CoachFlagsScreen() {
  const token = useAuth((s) => s.token);

  const [items, setItems] = useState<CoachFlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<StaffErrorCode | null>(null);

  const [busy, setBusy] = useState<{ id: string; action: 'acknowledge' | 'restore' } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [restoreTarget, setRestoreTarget] = useState<CoachFlagRow | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError('unauthorized');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setItems(await getCoachFlags(token));
      setError(null);
    } catch (err) {
      setError(toStaffError(err).code);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const clearRowError = useCallback((id: string) => {
    setRowErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const acknowledge = useCallback(
    async (item: CoachFlagRow) => {
      if (!token || busy || item.acked) return;
      setBusy({ id: item.workoutId, action: 'acknowledge' });
      clearRowError(item.workoutId);
      try {
        await restoreCoachFlag(item.workoutId, token, 'acknowledge');
        setItems((prev) =>
          prev.map((i) => (i.workoutId === item.workoutId ? { ...i, acked: true } : i)),
        );
      } catch (err) {
        const code = toStaffError(err).code;
        if (code === 'not_found') {
          setItems((prev) => prev.filter((i) => i.workoutId !== item.workoutId));
        } else {
          setRowErrors((prev) => ({ ...prev, [item.workoutId]: rowErrorLine(code, 'acknowledge') }));
        }
      } finally {
        setBusy(null);
      }
    },
    [token, busy, clearRowError],
  );

  const restore = useCallback(
    async (item: CoachFlagRow) => {
      if (!token) return;
      setRestoreTarget(null);
      setBusy({ id: item.workoutId, action: 'restore' });
      clearRowError(item.workoutId);
      try {
        await restoreCoachFlag(item.workoutId, token, 'restore');
        successHaptic();
        setItems((prev) => prev.filter((i) => i.workoutId !== item.workoutId));
      } catch (err) {
        const code = toStaffError(err).code;
        if (code === 'not_found') {
          setItems((prev) => prev.filter((i) => i.workoutId !== item.workoutId));
        } else {
          setRowErrors((prev) => ({ ...prev, [item.workoutId]: rowErrorLine(code, 'restore') }));
        }
      } finally {
        setBusy(null);
      }
    },
    [token, clearRowError],
  );

  const unackedCount = items.filter((i) => !i.acked).length;

  return (
    <>
      <Screen scroll>
        <Animated.View entering={enterDown()} style={styles.backRow}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Back to coach console"
            onPress={() => pushStaff(STAFF_ROUTES.coachInbox)}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </PressableScale>
        </Animated.View>

        <ScreenHeader
          eyebrow="Coach console"
          title="Flags"
          meta={
            items.length > 0 ? (
              <View style={styles.metaChip}>
                <AppText variant="label" color={colors.text}>
                  {items.length} {items.length === 1 ? 'flag' : 'flags'}
                  {unackedCount > 0 ? ` · ${unackedCount} unread` : ''}
                </AppText>
              </View>
            ) : undefined
          }
          style={styles.header}
        />

        {loading ? (
          <View style={styles.centre}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error && items.length === 0 ? (
          <View style={styles.centre}>
            <Ionicons name="cloud-offline-outline" size={28} color={colors.textFaint} />
            <AppText variant="caption" center color={colors.textDim}>
              {errorLine(error)}
            </AppText>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Retry"
              onPress={() => void load()}
              style={styles.retryBtn}
            >
              <AppText variant="label" color={colors.accent}>
                Tap to retry
              </AppText>
            </PressableScale>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.centre}>
            <Ionicons name="flag-outline" size={32} color={colors.textFaint} />
            <AppText variant="title" center>
              No flags
            </AppText>
            <AppText variant="caption" center color={colors.textDim}>
              Workouts only land here when a logged weight, rep count, or jump versus recent
              bests falls outside what the plausibility check allows.
            </AppText>
          </View>
        ) : (
          <View style={styles.list}>
            {items.map((item, i) => (
              <FlagCard
                key={item.workoutId}
                item={item}
                index={i}
                busy={busy?.id === item.workoutId}
                busyAction={busy?.id === item.workoutId ? busy.action : null}
                error={rowErrors[item.workoutId] ?? null}
                onAcknowledge={() => void acknowledge(item)}
                onRestore={() => setRestoreTarget(item)}
              />
            ))}
          </View>
        )}
      </Screen>

      <ConfirmDialog
        visible={restoreTarget !== null}
        title="Restore this workout?"
        message={
          restoreTarget
            ? `"${restoreTarget.name || 'Workout'}" will count again toward badges, leaderboards, and PR credit for ${restoreTarget.displayName || 'this member'}.`
            : undefined
        }
        confirmLabel="Restore"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (restoreTarget) void restore(restoreTarget);
        }}
        onCancel={() => setRestoreTarget(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backRow: { marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.gutter },
  metaChip: {
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centre: { paddingVertical: spacing.xxl, alignItems: 'center', gap: spacing.md },
  retryBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  list: { gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.md,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { flex: 1, gap: 3, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flexShrink: 1 },
  cardActions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: { flex: 1 },
});
