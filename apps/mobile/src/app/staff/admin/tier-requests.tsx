import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Chip,
  ConfirmDialog,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Sheet,
  Tag,
} from '../../../components/ui';
import {
  decideCoachTierRequest,
  getAdminCoachTierRequests,
  toStaffError,
  type AdminCoachTierRequest,
  type CoachTier,
  type StaffErrorCode,
  type TierRequestStatus,
} from '../../../features/staff/api';
import { replaceStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Tier requests — the coach-seniority upgrade queue (gap build P0-5,
 * wiring the previously-dead getAdminCoachTierRequests/decideCoachTierRequest
 * client fns — a coach could file a silver→gold/elite request from the coach
 * console, but no mobile screen could decide it). Permission:
 * `coach.application.review` (same as the coach-application queue).
 */

const STATUS_TABS: { key: TierRequestStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const COACH_TIER_RANK: Record<CoachTier, number> = { silver: 1, gold: 2, elite: 3 };

const TIER_LABEL: Record<CoachTier, string> = {
  silver: 'Silver',
  gold: 'Gold',
  elite: 'Elite',
};

function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have access to this.";
  if (code === 'not_found') return 'That request is no longer available.';
  return "Couldn't load the queue.";
}

/** decide() failures are distinct from a queue-load failure — reusing
 * errorLine() previously mislabeled a stale-request rejection (server's 409
 * `not_an_upgrade`, C11's guard against approving a request the coach's
 * current tier has already overtaken) as "Couldn't load the queue.", which
 * names the wrong operation and gives no actionable next step. */
function decideErrorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have access to this.";
  if (code === 'not_an_upgrade')
    return "The coach's tier already changed — this request is no longer an upgrade. Refresh the queue.";
  if (code === 'not_found' || code === 'conflict')
    return 'This request was already decided — refresh the queue.';
  if (code === 'invalid') return 'Review note is too long — shorten it and try again.';
  if (code === 'rate_limited') return 'Too many attempts — wait a moment and try again.';
  return "Couldn't submit that decision. Try again.";
}

/** Short relative age ("3m", "2h", "5d") with an absolute fallback. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < 0) return 'now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

function RetryLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Retry"
      onPress={onRetry}
      style={styles.retry}
    >
      <Ionicons name="refresh" size={15} color={colors.textDim} />
      <AppText variant="caption">{message} Tap to retry.</AppText>
    </PressableScale>
  );
}

export default function AdminTierRequestsScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = staffCan(staffPermissions, 'coach.application.review');

  const [status, setStatus] = useState<TierRequestStatus>('pending');
  const [rows, setRows] = useState<AdminCoachTierRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<AdminCoachTierRequest | null>(null);
  const [note, setNote] = useState('');
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);

  // A slow response for tab A must not clobber a faster tab-switch to B
  // (same reqSeq pattern as members.tsx / payments.tsx).
  const listSeq = useRef(0);

  const load = useCallback(
    async (st: TierRequestStatus) => {
      if (!token) return;
      const seq = ++listSeq.current;
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminCoachTierRequests(token, st);
        if (listSeq.current !== seq) return;
        setRows(data);
      } catch (e) {
        if (listSeq.current !== seq) return;
        setError(errorLine(toStaffError(e).code));
      } finally {
        if (listSeq.current === seq) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (allowed) void load(status);
  }, [allowed, status, load]);

  function openDetail(row: AdminCoachTierRequest): void {
    setSelected(row);
    setNote('');
    setDecideError(null);
    setConfirmAction(null);
  }

  function closeDetail(): void {
    setSelected(null);
  }

  async function decide(action: 'approve' | 'reject'): Promise<void> {
    if (!token || !selected || deciding) return;
    setDeciding(true);
    setDecideError(null);
    try {
      await decideCoachTierRequest(selected.id, action, note.trim() || undefined, token);
      setConfirmAction(null);
      setSelected(null);
      await load(status);
    } catch (e) {
      setConfirmAction(null);
      setDecideError(decideErrorLine(toStaffError(e).code));
    } finally {
      setDeciding(false);
    }
  }

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replaceStaff(STAFF_ROUTES.adminHome);
  }

  if (!allowed) {
    return (
      <Screen>
        <BackRow onBack={goBack} />
        <Animated.View entering={enterUp(0)} style={styles.locked}>
          <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textFaint}>
            Only a member admin, main admin or super admin can review tier requests.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <BackRow onBack={goBack} />

      <Animated.View entering={enterDown()} style={styles.tabsRow}>
        {STATUS_TABS.map((t) => (
          <Chip
            key={t.key}
            label={t.label}
            selected={status === t.key}
            onPress={() => setStatus(t.key)}
          />
        ))}
      </Animated.View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.retryWrap}>
          <RetryLine message={error} onRetry={() => void load(status)} />
        </View>
      ) : rows.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.emptyLine}>
          No {status} tier requests.
        </AppText>
      ) : (
        <View style={styles.list}>
          {rows.map((r, i) => {
            const downgrade = COACH_TIER_RANK[r.requestedTier] <= COACH_TIER_RANK[r.coach.coachTier];
            return (
              <Animated.View key={r.id} entering={enterUp(Math.min(i, 6))}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Open tier request from ${r.coach.displayName}`}
                  onPress={() => openDetail(r)}
                  style={styles.row}
                >
                  <View style={styles.rowText}>
                    <AppText variant="bodyBold" numberOfLines={1}>
                      {r.coach.displayName}
                    </AppText>
                    <AppText variant="caption" numberOfLines={1}>
                      {TIER_LABEL[r.coach.coachTier]} → {TIER_LABEL[r.requestedTier]}
                      {downgrade ? ' · not an upgrade' : ''}
                    </AppText>
                  </View>
                  <AppText variant="caption" color={colors.textFaint}>
                    {relativeTime(r.createdAt)}
                  </AppText>
                  <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
                </PressableScale>
              </Animated.View>
            );
          })}
        </View>
      )}

      <Sheet
        visible={selected !== null}
        onClose={closeDetail}
        title={selected ? selected.coach.displayName : 'Tier request'}
      >
        {selected ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScroll}>
            <View style={styles.tierChangeRow}>
              <Tag label={TIER_LABEL[selected.coach.coachTier]} variant="outline" />
              <Ionicons name="arrow-forward" size={16} color={colors.textDim} />
              <Tag label={TIER_LABEL[selected.requestedTier]} variant="outline" color={colors.accent} />
            </View>

            {COACH_TIER_RANK[selected.requestedTier] <= COACH_TIER_RANK[selected.coach.coachTier] ? (
              <AppText variant="caption" color={colors.warning}>
                The requested tier isn&apos;t higher than the coach&apos;s current badge — approving
                won&apos;t change anything meaningful. Consider rejecting instead.
              </AppText>
            ) : null}

            {selected.note ? (
              <>
                <SectionLabel>Coach&apos;s note</SectionLabel>
                <AppText variant="body">{selected.note}</AppText>
              </>
            ) : null}

            {selected.status === 'pending' ? (
              <>
                <SectionLabel>Decision</SectionLabel>
                <AppTextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="Review note (optional)"
                  multiline
                  style={styles.noteInput}
                />
                {decideError ? (
                  <AppText variant="caption" color={colors.error} style={styles.decideError}>
                    {decideError}
                  </AppText>
                ) : null}
                <View style={styles.decisionButtons}>
                  <Button
                    label="Reject"
                    variant="danger"
                    style={styles.decisionBtn}
                    onPress={() => setConfirmAction('reject')}
                    disabled={deciding}
                  />
                  <Button
                    label="Approve"
                    style={styles.decisionBtn}
                    onPress={() => setConfirmAction('approve')}
                    disabled={deciding}
                  />
                </View>
              </>
            ) : (
              <>
                <SectionLabel>Status</SectionLabel>
                <Tag
                  label={selected.status === 'approved' ? 'Approved' : 'Rejected'}
                  variant="outline"
                  color={selected.status === 'approved' ? colors.success : colors.error}
                />
              </>
            )}
          </ScrollView>
        ) : null}
      </Sheet>

      <ConfirmDialog
        visible={confirmAction !== null}
        title={confirmAction === 'approve' ? 'Approve this upgrade?' : 'Reject this upgrade?'}
        message={
          confirmAction === 'approve'
            ? `Raises ${selected?.coach.displayName ?? 'this coach'} to ${
                selected ? TIER_LABEL[selected.requestedTier] : ''
              }.`
            : 'The coach can file a new request later.'
        }
        confirmLabel={deciding ? 'Working…' : confirmAction === 'approve' ? 'Approve' : 'Reject'}
        cancelLabel="Cancel"
        danger={confirmAction === 'reject'}
        onConfirm={() => confirmAction && void decide(confirmAction)}
        onCancel={() => setConfirmAction(null)}
      />
    </Screen>
  );
}

/** Shared back row + revamp header. */
function BackRow({ onBack }: { onBack: () => void }) {
  return (
    <>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>
      <ScreenHeader eyebrow="Admin console" title="Tier requests" style={styles.header} />
    </>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.gutter },
  locked: {
    marginTop: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  tabsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  retryWrap: { marginTop: spacing.md },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  emptyLine: { marginTop: spacing.lg, paddingHorizontal: spacing.xs },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 64,
  },
  rowText: { flex: 1, gap: 2 },
  sheetScroll: { paddingBottom: spacing.xxl, gap: spacing.sm },
  tierChangeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  noteInput: {
    marginTop: spacing.sm,
    minHeight: 72,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  decideError: { marginTop: spacing.sm },
  decisionButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  decisionBtn: { flex: 1 },
});
