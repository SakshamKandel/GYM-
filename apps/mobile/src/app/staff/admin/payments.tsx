import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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
  decidePaymentRequest,
  getAdminPaymentRequests,
  toStaffError,
  type PaymentRequestRow,
  type PaymentStatus,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { canReviewPayments, replaceStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Payments — the Nepal manual-payment (eSewa/Khalti/bank) review queue
 * (SCALE-UP-PLAN §1.5 / §4.1).
 *
 * Status tabs (pending default). Tapping a row opens a detail sheet with the
 * receipt image (a SIGNED url minted fresh per GET — never cached beyond this
 * screen's lifetime), the requested tier/duration/amount, and — for pending
 * rows — Approve/Reject behind a confirm. Approve grants the dated tier
 * window and settles any promo commission server-side; this screen only
 * fires the decision and refetches.
 */

const STATUS_TABS: { key: PaymentStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const METHOD_LABEL: Record<PaymentRequestRow['method'], string> = {
  esewa: 'eSewa',
  khalti: 'Khalti',
  bank: 'Bank transfer',
  other: 'Other',
};

/**
 * True when the receipt URL isn't actually a loadable image — e.g. the
 * server's degraded 'unsigned:<uid>' placeholder (CLOUDINARY_URL_SIGNING_KEY
 * missing at request time; see /api/admin/payment-requests). Checked
 * up-front so the fallback message shows immediately instead of waiting on
 * an Image load failure that will never come (a non-URL string never fires
 * onError in some environments).
 */
function receiptUnusable(url: string): boolean {
  return !/^https?:\/\//i.test(url);
}

function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have access to this.";
  if (code === 'not_found') return 'That request is no longer available.';
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

export default function AdminPaymentsScreen() {
  const token = useAuth((s) => s.token);
  const staffRole = useAuth((s) => s.staffRole);
  const allowed = canReviewPayments(staffRole);

  const [status, setStatus] = useState<PaymentStatus>('pending');
  const [rows, setRows] = useState<PaymentRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<PaymentRequestRow | null>(null);
  const [note, setNote] = useState('');
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [receiptFailed, setReceiptFailed] = useState(false);

  const load = useCallback(
    async (st: PaymentStatus) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        setRows(await getAdminPaymentRequests(token, st));
      } catch (e) {
        setError(errorLine(toStaffError(e).code));
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (allowed) void load(status);
  }, [allowed, status, load]);

  function openDetail(row: PaymentRequestRow): void {
    setSelected(row);
    setNote('');
    setDecideError(null);
    setConfirmAction(null);
    setReceiptFailed(false);
  }

  function closeDetail(): void {
    setSelected(null);
  }

  async function decide(action: 'approve' | 'reject'): Promise<void> {
    if (!token || !selected || deciding) return;
    setDeciding(true);
    setDecideError(null);
    try {
      await decidePaymentRequest(selected.id, action, note.trim() || undefined, token);
      setConfirmAction(null);
      setSelected(null);
      await load(status);
    } catch (e) {
      // Close the confirm modal so the error (set below, rendered in the
      // Sheet behind it) is actually visible — otherwise it silently
      // reverts to "Approve"/"Reject" with zero feedback and the admin keeps
      // re-firing the same failing request.
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

  // Never let a real tier grant + coach commission be approved against a
  // receipt the admin never actually saw.
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
          No {status} payment requests.
        </AppText>
      ) : (
        <View style={styles.list}>
          {rows.map((r, i) => (
            <Animated.View key={r.id} entering={enterUp(Math.min(i, 6))}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Open payment request from ${r.account.displayName || r.account.email}`}
                onPress={() => openDetail(r)}
                style={styles.row}
              >
                <View style={styles.rowText}>
                  <AppText variant="bodyBold" numberOfLines={1}>
                    {r.account.displayName.trim() || r.account.email}
                  </AppText>
                  <AppText variant="caption" numberOfLines={1}>
                    {r.tier} · {r.months} mo · {METHOD_LABEL[r.method]}
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
        title={selected ? `${selected.tier} · ${selected.months} mo` : 'Payment request'}
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
                  label={selected.status === 'approved' ? 'Approved' : 'Rejected'}
                  variant="outline"
                  color={selected.status === 'approved' ? colors.success : colors.error}
                />
                {selected.reviewNote ? (
                  <AppText variant="caption" color={colors.textDim} style={styles.reviewNoteText}>
                    {selected.reviewNote}
                  </AppText>
                ) : null}
              </>
            )}
          </ScrollView>
        ) : null}
      </Sheet>

      <ConfirmDialog
        visible={confirmAction !== null}
        title={confirmAction === 'approve' ? 'Approve this payment?' : 'Reject this payment?'}
        message={
          confirmAction === 'approve'
            ? `Grants ${selected?.account.displayName || selected?.account.email || 'this member'} ${selected?.tier} for ${selected?.months} month${selected?.months === 1 ? '' : 's'}.`
            : 'The member sees this decision and can submit a new request.'
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
      <ScreenHeader eyebrow="Admin console" title="Payments" style={styles.header} />
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
  // Charcoal list row (brief §11c): fill contrast, no hairline borders.
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
});
