import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  decideMealPayment,
  fetchMealPaymentQueue,
  refundMealPayment,
  toStaffError,
  type MealPaymentRequestRow,
  type MealPaymentReviewStatus,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { canReviewPayments, replaceStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { ReauthSheet, useReauth } from '../../../features/staff/ReauthGate';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Meal payments — the meal-delivery manual-payment (eSewa/Khalti)
 * review queue (plan §3 / §6 / §7 P11), a sibling of the subscription
 * Payments screen it deliberately mirrors: same status tabs, same
 * receipt-sheet + Approve/Reject/Refund shell. Reuses `payments.review` — no
 * new permission key (the plan folds meal-payment review into the existing
 * one).
 *
 * Each row can target either a one-time ORDER (approving does not itself
 * advance fulfillment — that happens separately via the Orders oversight
 * screen / partner console) or a weekly subscription CYCLE (approving
 * un-gates that week's materialization). The list renders whichever target
 * context the row carries.
 */

const STATUS_TABS: { key: MealPaymentReviewStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'refunded', label: 'Refunded' },
];

const METHOD_LABEL: Record<MealPaymentRequestRow['method'], string> = {
  esewa: 'eSewa',
  khalti: 'Khalti',
};

/**
 * True when the receipt URL isn't actually a loadable image — e.g. the
 * server's degraded 'unsigned:<uid>' placeholder (CLOUDINARY_URL_SIGNING_KEY
 * missing at request time). Checked up-front so the fallback message shows
 * immediately instead of waiting on an Image load failure that may never come.
 */
function receiptUnusable(url: string): boolean {
  return !/^https?:\/\//i.test(url);
}

/**
 * P1-17: the refund action can fail three DISTINCT ways
 * (`refundMealPayment`'s doc comment / apps/web .../[id]/refund/route.ts) —
 * before this fix all three fell through to the generic 'conflict' copy
 * ("Another admin already decided this"), which is actively misleading for
 * `non_refundable` (the request is still perfectly valid; the ORDER moved
 * into production or the cycle's week began) and for `not_approved` (a race
 * against a reject, not a double-decision).
 */
function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have access to this.";
  if (code === 'not_found') return 'That request is no longer available.';
  if (code === 'already_refunded') return 'This payment was already refunded.';
  if (code === 'not_approved')
    return "This request isn't approved — refresh the queue to see its current state.";
  if (code === 'non_refundable')
    return "This can no longer be refunded — the order is already in production or past its cutoff, or the cycle's billed week has begun.";
  if (code === 'conflict')
    return 'Another admin already decided this — refresh the queue and try again.';
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

/** Short label for the row's target — an order's delivery slot, or a cycle's week. */
function targetLabel(row: MealPaymentRequestRow): string {
  if (row.target.kind === 'order') {
    return row.target.deliveryDate
      ? `Order · ${row.target.deliveryDate} ${row.target.window ?? ''}`.trim()
      : 'Order';
  }
  return row.target.weekStart && row.target.weekEnd
    ? `Weekly plan · ${row.target.weekStart} – ${row.target.weekEnd}`
    : 'Weekly plan';
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

export default function AdminMealPaymentsScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = canReviewPayments(staffPermissions);
  // Step-up (mirrors the subscription Payments screen): a refund reverses a
  // paid mark and is irreversible money-adjacent state — Approve/Reject stay
  // ungated (non-money-moving decisions), Refund gets the fresh-password gate.
  const reauth = useReauth();

  const [status, setStatus] = useState<MealPaymentReviewStatus>('pending');
  const [rows, setRows] = useState<MealPaymentRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<MealPaymentRequestRow | null>(null);
  const [note, setNote] = useState('');
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | 'refund' | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [receiptFailed, setReceiptFailed] = useState(false);

  // G8: a slow response for tab A must not clobber a faster tab-switch to B.
  const listSeq = useRef(0);

  const load = useCallback(
    async (st: MealPaymentReviewStatus) => {
      if (!token) return;
      const seq = ++listSeq.current;
      setLoading(true);
      setError(null);
      try {
        const data = await fetchMealPaymentQueue(token, st);
        if (listSeq.current !== seq) return; // superseded by a newer tab switch
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

  function openDetail(row: MealPaymentRequestRow): void {
    setSelected(row);
    setNote('');
    setDecideError(null);
    setConfirmAction(null);
    setReceiptFailed(false);
  }

  function closeDetail(): void {
    setSelected(null);
  }

  async function decide(action: 'approve' | 'reject' | 'refund'): Promise<void> {
    if (!token || !selected || deciding) return;
    setDeciding(true);
    setDecideError(null);
    try {
      if (action === 'refund') {
        await refundMealPayment(selected.id, note.trim() || undefined, token);
      } else {
        await decideMealPayment(selected.id, action, note.trim() || undefined, token);
      }
      setConfirmAction(null);
      setSelected(null);
      await load(status);
    } catch (e) {
      setConfirmAction(null);
      setDecideError(errorLine(toStaffError(e).code));
    } finally {
      setDeciding(false);
    }
  }

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replaceStaff(STAFF_ROUTES.adminHome);
  }

  // Never let a real payment be approved against a receipt the admin never
  // actually saw.
  const receiptBad = selected ? receiptUnusable(selected.receiptUrl) || receiptFailed : false;

  if (!allowed) {
    return (
      <Screen>
        <BackRow onBack={goBack} />
        <Animated.View entering={enterUp(0)} style={styles.locked}>
          <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textFaint}>
            Only a member admin, main admin or super admin can review payments.
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
          No {status} meal payment requests.
        </AppText>
      ) : (
        <View style={styles.list}>
          {rows.map((r, i) => (
            <Animated.View key={r.id} entering={enterUp(Math.min(i, 6))}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Open meal payment request from ${r.account.displayName || r.account.email}`}
                onPress={() => openDetail(r)}
                style={styles.row}
              >
                <View style={styles.rowText}>
                  <AppText variant="bodyBold" numberOfLines={1}>
                    {r.account.displayName.trim() || r.account.email}
                  </AppText>
                  <AppText variant="caption" numberOfLines={1}>
                    {targetLabel(r)} · {METHOD_LABEL[r.method]}
                  </AppText>
                </View>
                <View style={styles.rowRight}>
                  <AppText variant="bodyBold" tabular>
                    {formatMoney(r.amountMinor, r.currency)}
                  </AppText>
                  <AppText variant="caption" color={colors.textFaint}>
                    {relativeTime(r.createdAt)}
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
              </PressableScale>
            </Animated.View>
          ))}
        </View>
      )}

      <Sheet
        visible={selected !== null}
        onClose={closeDetail}
        title={selected ? targetLabel(selected) : 'Meal payment'}
      >
        {selected ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScroll}>
            <AppText variant="caption" color={colors.textDim}>
              {selected.account.displayName.trim() || selected.account.email} ·{' '}
              {selected.account.email}
            </AppText>
            <View style={styles.amountRow}>
              <AppText variant="display" tabular>
                {formatMoney(selected.amountMinor, selected.currency)}
              </AppText>
              <Tag label={METHOD_LABEL[selected.method]} variant="dim" />
            </View>

            <SectionLabel>Receipt</SectionLabel>
            {receiptBad ? (
              <View style={styles.receiptFallback}>
                <Ionicons name="image-outline" size={22} color={colors.textFaint} />
                <AppText variant="caption" color={colors.textFaint} center>
                  Couldn&apos;t load the receipt image.
                </AppText>
              </View>
            ) : (
              <Image
                source={{ uri: selected.receiptUrl }}
                style={styles.receiptImage}
                contentFit="contain"
                transition={100}
                onError={() => setReceiptFailed(true)}
              />
            )}

            {selected.note ? (
              <>
                <SectionLabel>Member note</SectionLabel>
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
                {receiptBad ? (
                  <AppText variant="caption" color={colors.textFaint} style={styles.decideError}>
                    Approve is disabled until the receipt loads — reload the queue and try again.
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
                    disabled={deciding || receiptBad}
                  />
                </View>
              </>
            ) : (
              <>
                <SectionLabel>Status</SectionLabel>
                <Tag
                  label={
                    selected.status === 'approved'
                      ? 'Approved'
                      : selected.status === 'refunded'
                        ? 'Refunded'
                        : 'Rejected'
                  }
                  variant="outline"
                  color={
                    selected.status === 'approved'
                      ? colors.success
                      : selected.status === 'refunded'
                        ? colors.warning
                        : colors.error
                  }
                />
                {selected.reviewNote ? (
                  <AppText variant="caption" color={colors.textDim} style={styles.reviewNoteText}>
                    {selected.reviewNote}
                  </AppText>
                ) : null}

                {/* Refund an approved request — non-refundable once the order
                    is in production / past cutoff, or the cycle's week has
                    begun (server-enforced; surfaces as a generic conflict). */}
                {selected.status === 'approved' ? (
                  <>
                    <SectionLabel>Refund</SectionLabel>
                    <AppTextInput
                      value={note}
                      onChangeText={setNote}
                      placeholder="Refund reason (optional, audited)"
                      multiline
                      style={styles.noteInput}
                    />
                    {decideError ? (
                      <AppText variant="caption" color={colors.error} style={styles.decideError}>
                        {decideError}
                      </AppText>
                    ) : null}
                    <Button
                      label="Refund this payment"
                      variant="danger"
                      style={styles.refundBtn}
                      onPress={() => setConfirmAction('refund')}
                      disabled={deciding}
                    />
                  </>
                ) : null}
              </>
            )}
          </ScrollView>
        ) : null}
      </Sheet>

      <ConfirmDialog
        visible={confirmAction !== null}
        title={
          confirmAction === 'approve'
            ? 'Approve this payment?'
            : confirmAction === 'refund'
              ? 'Refund this payment?'
              : 'Reject this payment?'
        }
        message={
          confirmAction === 'approve'
            ? `Marks this ${selected?.target.kind === 'cycle' ? 'weekly plan' : 'order'} as paid. Fulfillment status is unaffected.`
            : confirmAction === 'refund'
              ? "Reverses this payment's paid mark. This cannot be undone, and is refused once the order is in production or the cycle's week has begun."
              : 'The member sees this decision and can submit a new receipt.'
        }
        confirmLabel={
          deciding
            ? 'Working…'
            : confirmAction === 'approve'
              ? 'Approve'
              : confirmAction === 'refund'
                ? 'Refund'
                : 'Reject'
        }
        cancelLabel="Cancel"
        danger={confirmAction === 'reject' || confirmAction === 'refund'}
        onConfirm={() => {
          if (!confirmAction) return;
          const action = confirmAction;
          if (action === 'refund') {
            reauth.guard(() => void decide(action));
          } else {
            void decide(action);
          }
        }}
        onCancel={() => setConfirmAction(null)}
      />

      {/* Step-up password prompt for refund. */}
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
      <ScreenHeader eyebrow="Admin console" title="Meal payments" style={styles.header} />
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
  receiptImage: {
    width: '100%',
    height: 320,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  receiptFallback: {
    width: '100%',
    height: 160,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
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
  refundBtn: { marginTop: spacing.lg },
});
