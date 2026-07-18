import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { formatMoney } from '@gym/shared';
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
  decidePayoutRequest,
  getPayoutRequests,
  toStaffError,
  type PayoutQueue,
  type PayoutRequestRow,
  type PayoutStatus,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { canManagePayouts, replaceStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { ReauthSheet, useReauth } from '../../../features/staff/ReauthGate';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Payouts — the coach withdrawal-request review queue (gap build
 * P1-12). One fetch (getPayoutRequests) returns EVERY pending request plus a
 * capped tail of decided history in a single call — the status tabs below
 * are a purely client-side filter over that one payload (the server has no
 * per-status query param; pending never starves behind a page size). Mirrors
 * the Payments screen's shell otherwise: a list + a detail sheet with the
 * decision. Approving REQUIRES a disbursement reference (the bank/eSewa/
 * Khalti transaction id) — the server re-checks the coach's live balance and
 * posts the negative wallet-ledger entry keyed to it; rejecting frees the
 * coach's one-pending slot with an optional note.
 *
 * CAS-conflict friendly: a 404/409 on decide means another admin already
 * acted on this request — the sheet closes and the queue refetches instead
 * of inviting a blind retry (mirrors the payments queue's B13 fix).
 */

const STATUS_TABS: { key: PayoutStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'paid', label: 'Paid' },
  { key: 'rejected', label: 'Rejected' },
];

function statusTone(status: PayoutStatus): { label: string; color: string } {
  if (status === 'approved') return { label: 'Approved', color: colors.success };
  if (status === 'paid') return { label: 'Paid', color: colors.success };
  if (status === 'rejected') return { label: 'Rejected', color: colors.error };
  return { label: 'Pending', color: colors.warning };
}

function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have access to this.";
  if (code === 'not_found' || code === 'conflict')
    return 'Another admin already decided this request — refresh the queue.';
  if (code === 'insufficient_balance')
    return "This coach's balance no longer covers the request.";
  return "Couldn't load the queue.";
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

export default function AdminPayoutsScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = canManagePayouts(staffPermissions);
  // Step-up (plan §3 #14): approving a payout records real money as sent to
  // a coach against a disbursement reference — same class of action as
  // staff.tsx's role revoke, so it gets the same fresh-password gate.
  // Rejecting stays ungated (no money moves).
  const reauth = useReauth();

  const [status, setStatus] = useState<PayoutStatus>('pending');
  const [queue, setQueue] = useState<PayoutQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<PayoutRequestRow | null>(null);
  const [disbursementRef, setDisbursementRef] = useState('');
  const [note, setNote] = useState('');
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setQueue(await getPayoutRequests(token));
    } catch (e) {
      setError(errorLine(toStaffError(e).code));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const rows = useMemo(
    () =>
      status === 'pending'
        ? (queue?.pending ?? [])
        : (queue?.history.filter((r) => r.status === status) ?? []),
    [queue, status],
  );

  function openDetail(row: PayoutRequestRow): void {
    setSelected(row);
    setDisbursementRef(row.disbursementRef ?? '');
    setNote('');
    setDecideError(null);
    setConfirmAction(null);
  }

  function closeDetail(): void {
    setSelected(null);
  }

  async function decide(action: 'approve' | 'reject'): Promise<void> {
    if (!token || !selected || deciding) return;
    if (action === 'approve' && !disbursementRef.trim()) {
      setConfirmAction(null);
      setDecideError('Enter the disbursement reference before approving.');
      return;
    }
    setDeciding(true);
    setDecideError(null);
    try {
      await decidePayoutRequest(
        selected.id,
        action,
        action === 'approve'
          ? { disbursementRef: disbursementRef.trim(), note: note.trim() || undefined }
          : { note: note.trim() || undefined },
        token,
      );
      setConfirmAction(null);
      setSelected(null);
      await load();
    } catch (e) {
      setConfirmAction(null);
      const code = toStaffError(e).code;
      if (code === 'not_found' || code === 'conflict') {
        // Another admin already decided this — close the sheet, don't invite
        // a blind retry, and refetch so the row disappears from Pending.
        setSelected(null);
        setDecideError(null);
        await load();
      } else {
        setDecideError(errorLine(code));
      }
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
            Only a super admin or main admin can review payouts.
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
          <RetryLine message={error} onRetry={() => void load()} />
        </View>
      ) : rows.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.emptyLine}>
          No {status} payout requests.
        </AppText>
      ) : (
        <View style={styles.list}>
          {rows.map((r, i) => {
            const tone = statusTone(r.status);
            return (
              <Animated.View key={r.id} entering={enterUp(Math.min(i, 6))}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Open payout request from ${r.coach.displayName}`}
                  onPress={() => openDetail(r)}
                  style={styles.row}
                >
                  <View style={styles.rowText}>
                    <AppText variant="bodyBold" numberOfLines={1}>
                      {r.coach.displayName}
                    </AppText>
                    <AppText variant="caption" numberOfLines={1}>
                      {r.coach.coachTier} · {tone.label}
                    </AppText>
                  </View>
                  <View style={styles.rowRight}>
                    <AppText variant="bodyBold" tabular>
                      {formatMoney(r.amountMinor, r.currency)}
                    </AppText>
                    <AppText variant="caption" color={colors.textFaint}>
                      {relativeTime(r.requestedAt)}
                    </AppText>
                  </View>
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
        title={selected ? selected.coach.displayName : 'Payout request'}
      >
        {selected ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScroll}>
            <View style={styles.amountRow}>
              <AppText variant="display" tabular>
                {formatMoney(selected.amountMinor, selected.currency)}
              </AppText>
              <Tag label={selected.coach.coachTier} variant="dim" />
            </View>

            {selected.status === 'pending' && selected.balanceMinor !== null ? (
              <AppText variant="caption" color={colors.textDim}>
                Current balance: {formatMoney(selected.balanceMinor, selected.currency)}
                {selected.balanceMinor < selected.amountMinor
                  ? ' — below the requested amount.'
                  : ''}
              </AppText>
            ) : null}

            {selected.note ? (
              <>
                <SectionLabel>Coach note</SectionLabel>
                <AppText variant="body">{selected.note}</AppText>
              </>
            ) : null}

            {selected.status === 'pending' ? (
              <>
                <SectionLabel>Disbursement reference</SectionLabel>
                <AppTextInput
                  value={disbursementRef}
                  onChangeText={setDisbursementRef}
                  placeholder="Bank / eSewa / Khalti transaction id"
                  editable={!deciding}
                  accessibilityLabel="Disbursement reference"
                />
                <AppText variant="caption" color={colors.textFaint} style={styles.hint}>
                  Required to approve — links this request to the money actually sent.
                </AppText>

                <SectionLabel>Note</SectionLabel>
                <AppTextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="Note (optional, audited)"
                  multiline
                  editable={!deciding}
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
                    disabled={deciding || !disbursementRef.trim()}
                  />
                </View>
              </>
            ) : (
              <>
                <SectionLabel>Status</SectionLabel>
                <Tag
                  label={statusTone(selected.status).label}
                  variant="outline"
                  color={statusTone(selected.status).color}
                />
                {selected.disbursementRef ? (
                  <AppText variant="caption" color={colors.textDim} style={styles.reviewNoteText}>
                    Ref: {selected.disbursementRef}
                  </AppText>
                ) : null}
                {selected.decidedAt ? (
                  <AppText variant="caption" color={colors.textFaint}>
                    Decided {relativeTime(selected.decidedAt)} ago
                  </AppText>
                ) : null}
              </>
            )}
          </ScrollView>
        ) : null}
      </Sheet>

      <ConfirmDialog
        visible={confirmAction !== null}
        title={confirmAction === 'approve' ? 'Approve this payout?' : 'Reject this payout?'}
        message={
          confirmAction === 'approve'
            ? `Records ${formatMoney(selected?.amountMinor ?? 0, selected?.currency ?? '')} as paid out to ${selected?.coach.displayName ?? 'this coach'} against reference "${disbursementRef.trim()}".`
            : `${selected?.coach.displayName ?? 'This coach'} can file a new request afterward.`
        }
        confirmLabel={deciding ? 'Working…' : confirmAction === 'approve' ? 'Approve' : 'Reject'}
        cancelLabel="Cancel"
        danger={confirmAction === 'reject'}
        onConfirm={() => {
          if (!confirmAction) return;
          const action = confirmAction;
          if (action === 'approve') {
            reauth.guard(() => void decide(action));
          } else {
            void decide(action);
          }
        }}
        onCancel={() => setConfirmAction(null)}
      />

      {/* Step-up password prompt for payout approval (plan §3 #14). */}
      <ReauthSheet controller={reauth} />
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
      <ScreenHeader eyebrow="Admin console" title="Payouts" style={styles.header} />
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
  rowRight: { alignItems: 'flex-end', gap: 2 },
  sheetScroll: { paddingBottom: spacing.xxl, gap: spacing.sm },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  hint: { marginTop: -spacing.xs },
  noteInput: {
    marginTop: spacing.sm,
    minHeight: 72,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  decideError: { marginTop: spacing.sm },
  decisionButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  decisionBtn: { flex: 1 },
  reviewNoteText: { marginTop: spacing.xs },
});
