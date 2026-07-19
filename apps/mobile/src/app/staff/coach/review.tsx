import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Divider,
  enterDown,
  enterUp,
  layoutSpring,
  PressableScale,
  Screen,
  ScreenHeader,
  Sheet,
  Tag,
} from '../../../components/ui';
import {
  decideCoachReview,
  getCoachReviewQueue,
  toStaffError,
  type ReviewSuggestion,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { pushStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { successHaptic } from '../../../lib/haptics';
import { useAuth } from '../../../state/auth';

/**
 * Coach · Review — the progression-review queue, the phone twin of the web
 * `/coach/review` `ReviewQueue`. Approve is one tap; Adjust opens a Sheet
 * (weight + optional note) instead of the web's inline expansion — the
 * mobile-idiomatic way to keep a numeric-keyboard form off the scrolling
 * list. The engine never changes exercise selection, so the coach only ever
 * signs off on load; reps are informational context.
 *
 * Grouped by client, server order preserved within and across groups (oldest
 * suggestion first) — same contract as web, no client-side re-sort.
 */

const ACTION_META: Record<string, { label: string; color: string }> = {
  increase: { label: 'Increase', color: colors.success },
  hold: { label: 'Hold', color: colors.textDim },
  deload: { label: 'Deload', color: colors.warning },
};

function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have coach access.";
  return "Couldn't load the review queue.";
}

function rowErrorLine(code: StaffErrorCode): string {
  if (code === 'forbidden') return 'This client is no longer assigned to you.';
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  return "Couldn't save the review. Try again.";
}

/** "82.5 kg" / "100 kg" — canonical kg, one decimal max. */
function formatKg(kg: number): string {
  const rounded = Math.round(kg * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} kg`;
}

function repsLabel(min: number | null, max: number | null): string | null {
  if (min === null || max === null) return null;
  return min === max ? `${min} reps` : `${min}–${max} reps`;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function SuggestionCard({
  s,
  index,
  busy,
  error,
  onApprove,
  onAdjust,
}: {
  s: ReviewSuggestion;
  index: number;
  busy: boolean;
  error: string | null;
  onApprove: () => void;
  onAdjust: () => void;
}) {
  const meta = ACTION_META[s.action] ?? { label: s.action || 'Review', color: colors.textDim };
  const reps = repsLabel(s.targetRepsMin, s.targetRepsMax);

  return (
    <Animated.View entering={enterUp(index)} layout={layoutSpring} style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cardTitle}>
          <AppText variant="bodyBold" numberOfLines={2}>
            {s.exerciseName || 'Exercise'}
          </AppText>
          <Tag label={meta.label} variant="outline" color={meta.color} />
        </View>
        <AppText variant="caption" color={colors.textFaint}>
          {relativeTime(s.createdAt)}
        </AppText>
      </View>

      {s.targetWeightKg !== null ? (
        <AppText variant="body" tabular>
          {formatKg(s.targetWeightKg)}
          {reps ? ` × ${reps}` : ''}
        </AppText>
      ) : null}

      {s.reason ? (
        <AppText variant="caption" color={colors.textDim}>
          {s.reason}
        </AppText>
      ) : null}

      {error ? (
        <AppText variant="caption" color={colors.error}>
          {error}
        </AppText>
      ) : null}

      <View style={styles.cardActions}>
        <Button
          label={busy ? 'Saving…' : 'Approve'}
          variant="secondary"
          loading={busy}
          disabled={busy}
          onPress={onApprove}
          style={styles.actionBtn}
        />
        <Button
          label="Adjust"
          variant="ghost"
          disabled={busy}
          onPress={onAdjust}
          style={styles.actionBtn}
        />
      </View>
    </Animated.View>
  );
}

export default function CoachReviewScreen() {
  const token = useAuth((s) => s.token);

  const [suggestions, setSuggestions] = useState<ReviewSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<StaffErrorCode | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  // Adjust sheet
  const [adjustTarget, setAdjustTarget] = useState<ReviewSuggestion | null>(null);
  const [weightText, setWeightText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError('unauthorized');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setSuggestions(await getCoachReviewQueue(token, 'pending'));
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

  const groups = useMemo(() => {
    const byUser = new Map<string, { name: string; items: ReviewSuggestion[] }>();
    for (const s of suggestions) {
      const existing = byUser.get(s.user.id);
      if (existing) existing.items.push(s);
      else byUser.set(s.user.id, { name: s.user.displayName || s.user.email, items: [s] });
    }
    return [...byUser.values()];
  }, [suggestions]);

  const approve = useCallback(
    async (s: ReviewSuggestion) => {
      if (!token || busyId) return;
      setBusyId(s.id);
      setRowErrors((prev) => {
        if (!(s.id in prev)) return prev;
        const next = { ...prev };
        delete next[s.id];
        return next;
      });
      try {
        await decideCoachReview(s.id, { action: 'approve' }, token);
        successHaptic();
        setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
      } catch (err) {
        const code = toStaffError(err).code;
        if (code === 'not_found') {
          setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
        } else {
          setRowErrors((prev) => ({ ...prev, [s.id]: rowErrorLine(code) }));
        }
      } finally {
        setBusyId(null);
      }
    },
    [token, busyId],
  );

  const openAdjust = useCallback((s: ReviewSuggestion) => {
    setAdjustTarget(s);
    setWeightText(s.targetWeightKg !== null ? String(s.targetWeightKg) : '');
    setNoteText('');
    setAdjustError(null);
  }, []);

  const saveAdjust = useCallback(async () => {
    if (!token || !adjustTarget || busyId) return;
    const weightKg = Number.parseFloat(weightText);
    if (!Number.isFinite(weightKg) || weightKg < 0 || weightKg > 10_000) {
      setAdjustError('Enter a valid weight in kg.');
      return;
    }
    const target = adjustTarget;
    setBusyId(target.id);
    setAdjustError(null);
    try {
      const note = noteText.trim();
      await decideCoachReview(
        target.id,
        { action: 'adjust', weightKg, ...(note ? { note } : {}) },
        token,
      );
      successHaptic();
      setSuggestions((prev) => prev.filter((x) => x.id !== target.id));
      setAdjustTarget(null);
    } catch (err) {
      const code = toStaffError(err).code;
      if (code === 'not_found') {
        setSuggestions((prev) => prev.filter((x) => x.id !== target.id));
        setAdjustTarget(null);
      } else {
        setAdjustError(rowErrorLine(code));
      }
    } finally {
      setBusyId(null);
    }
  }, [token, adjustTarget, busyId, weightText, noteText]);

  return (
    <>
      <Screen scroll keyboardAware>
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
          title="Review"
          meta={
            suggestions.length > 0 ? (
              <View style={styles.metaChip}>
                <AppText variant="label" color={colors.text}>
                  {suggestions.length} pending
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
        ) : error && suggestions.length === 0 ? (
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
        ) : suggestions.length === 0 ? (
          <View style={styles.centre}>
            <Ionicons name="checkmark-done-outline" size={32} color={colors.textFaint} />
            <AppText variant="title" center>
              Nothing to review
            </AppText>
            <AppText variant="caption" center color={colors.textDim}>
              New progression suggestions appear here after your clients finish and sync a
              workout.
            </AppText>
          </View>
        ) : (
          <View style={styles.groups}>
            {groups.map((group) => (
              <View key={group.name} style={styles.group}>
                <AppText variant="label" color={colors.textFaint}>
                  {group.name}
                </AppText>
                {group.items.map((s, i) => (
                  <SuggestionCard
                    key={s.id}
                    s={s}
                    index={i}
                    busy={busyId === s.id}
                    error={rowErrors[s.id] ?? null}
                    onApprove={() => void approve(s)}
                    onAdjust={() => openAdjust(s)}
                  />
                ))}
              </View>
            ))}
          </View>
        )}
      </Screen>

      <Sheet
        visible={adjustTarget !== null}
        onClose={() => {
          if (busyId === null) setAdjustTarget(null);
        }}
        title="Adjust suggestion"
      >
        {adjustTarget ? (
          <View style={styles.sheetBody}>
            <AppText variant="body" color={colors.textDim}>
              {adjustTarget.exerciseName || 'Exercise'} · {adjustTarget.user.displayName}
            </AppText>
            <Divider />
            <AppText variant="label">New weight (kg)</AppText>
            <AppTextInput
              value={weightText}
              onChangeText={setWeightText}
              keyboardType="decimal-pad"
              placeholder="e.g. 62.5"
              accessibilityLabel="New weight in kg"
            />
            <AppText variant="label">Note (optional)</AppText>
            <AppTextInput
              value={noteText}
              onChangeText={setNoteText}
              placeholder="Why you changed it — the member sees this"
              maxLength={500}
              multiline
              style={styles.noteInput}
              accessibilityLabel="Adjustment note"
            />
            {adjustError ? (
              <AppText variant="caption" color={colors.error}>
                {adjustError}
              </AppText>
            ) : null}
            <Button
              label={busyId === adjustTarget.id ? 'Saving…' : 'Save adjustment'}
              loading={busyId === adjustTarget.id}
              disabled={busyId === adjustTarget.id || weightText.trim().length === 0}
              onPress={() => void saveAdjust()}
              style={styles.sheetSave}
            />
          </View>
        ) : null}
      </Sheet>
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
  groups: { gap: spacing.xl },
  group: { gap: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { flex: 1, gap: spacing.xs, minWidth: 0 },
  cardActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  actionBtn: { flex: 1 },
  sheetBody: { gap: spacing.sm, paddingBottom: spacing.md },
  noteInput: { minHeight: 64, paddingTop: 16, textAlignVertical: 'top' },
  sheetSave: { marginTop: spacing.md },
});
