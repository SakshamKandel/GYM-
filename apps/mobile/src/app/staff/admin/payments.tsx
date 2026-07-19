import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
  exportCsvToFile,
  getAdminPaymentRequests,
  getMemberDetail,
  refundPaymentRequest,
  toStaffError,
  type PaymentRequestRow,
  type PaymentStatus,
  type StaffErrorCode,
  type Tier,
} from '../../../features/staff/api';
import { expiryLabel } from '../../../features/staff/duration';
import { canReviewPayments, replaceStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { ReauthSheet, useReauth } from '../../../features/staff/ReauthGate';
import { useAuth } from '../../../state/auth';

/**
 * P1-10 CSV export contract: exportCsvToFile(kind, token) => Promise<string>
 * (M2 owns features/staff/api.ts — see the fuller note in members.tsx)
 * downloads the CSV straight to a local file (native-side streaming; never
 * buffered into one JS string) and returns its `file://` URI. No
 * expo-sharing dependency exists in this app, so the file goes through RN's
 * built-in Share sheet (`url` so iOS attaches it); the on-device path stays
 * visible as a selectable-text fallback when the share sheet is
 * unavailable/dismissed.
 */
async function shareFile(uri: string): Promise<void> {
  try {
    await Share.share({ url: uri });
  } catch {
    // Share sheet dismissed/unavailable — the file stays on-device; its
    // path stays visible as text.
  }
}

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
  { key: 'refunded', label: 'Refunded' },
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
  // B13-style remap for the refund action's CAS conflicts — a generic "try
  // again" would be actively misleading for both of these (defect: refund
  // 409s).
  if (code === 'already_refunded') return 'This payment was already refunded.';
  if (code === 'not_approved')
    return 'This request is no longer approved — refresh the queue and try again.';
  return "Couldn't load the queue.";
}

const TIER_RANK: Record<Tier, number> = { starter: 0, silver: 1, gold: 2, elite: 3 };

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
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = canReviewPayments(staffPermissions);
  // Step-up (plan §3 #14): a refund reverses a tier grant and posts a wallet
  // adjustment — money-moving and irreversible, same class of action as
  // staff.tsx's role revoke, so it gets the same fresh-password gate.
  // Approve/reject stay ungated (pre-existing, non-money-moving decisions).
  const reauth = useReauth();

  const [status, setStatus] = useState<PaymentStatus>('pending');
  const [rows, setRows] = useState<PaymentRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<PaymentRequestRow | null>(null);
  const [note, setNote] = useState('');
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | 'refund' | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [receiptFailed, setReceiptFailed] = useState(false);
  // Defect A1/#1: the server 409s an approval that would shorten a permanent
  // current tier or downgrade a higher active one (confirm_required) until
  // the caller re-POSTs with confirm:true. Armed only by that exact error, on
  // this exact selected request, so a stale confirmation can never leak onto
  // a different row.
  const [pendingConfirm, setPendingConfirm] = useState(false);

  // P0-2: the member's current effective tier + expiry, fetched fresh whenever
  // a PENDING request opens, so the admin sees what approval would change
  // instead of deciding blind (defect B1). `undefined` = still loading/unknown.
  const [previewTier, setPreviewTier] = useState<Tier | undefined>(undefined);
  const [previewExpiry, setPreviewExpiry] = useState<string | null | undefined>(undefined);
  const [previewError, setPreviewError] = useState(false);

  // B31: pull-to-refresh state.
  const [refreshing, setRefreshing] = useState(false);

  // P1-10: CSV export of the payment-request queue.
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvLink, setCsvLink] = useState<string | null>(null);

  async function exportPaymentsCsv(): Promise<void> {
    if (!token || csvBusy) return;
    setCsvBusy(true);
    setCsvError(null);
    try {
      const uri = await exportCsvToFile('payment-requests', token);
      setCsvLink(uri);
      await shareFile(uri);
    } catch {
      setCsvError("Couldn't export the payment queue.");
    } finally {
      setCsvBusy(false);
    }
  }

  // G8: a slow response for tab A must not clobber a faster tab-switch to B —
  // only the LATEST in-flight request may commit its result.
  const listSeq = useRef(0);

  const load = useCallback(
    async (st: PaymentStatus) => {
      if (!token) return;
      const seq = ++listSeq.current;
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminPaymentRequests(token, st);
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

  // B31: refetch on every focus (not just mount) — approving/refunding on
  // another screen (or the web console) left this queue stale until a full
  // app remount.
  useFocusEffect(
    useCallback(() => {
      if (allowed) void load(status);
    }, [allowed, status, load]),
  );

  async function onRefresh(): Promise<void> {
    setRefreshing(true);
    await load(status);
    setRefreshing(false);
  }

  function openDetail(row: PaymentRequestRow): void {
    setSelected(row);
    setNote('');
    setDecideError(null);
    setConfirmAction(null);
    setReceiptFailed(false);
    setPreviewTier(undefined);
    setPreviewExpiry(undefined);
    setPreviewError(false);
    setPendingConfirm(false);
    if (row.status === 'pending' && token) {
      getMemberDetail(row.account.id, token)
        .then((detail) => {
          setPreviewTier(detail.member.tier);
          setPreviewExpiry(detail.member.tierExpiresAt);
        })
        .catch(() => setPreviewError(true));
    }
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
        await refundPaymentRequest(selected.id, note.trim(), token);
      } else {
        await decidePaymentRequest(
          selected.id,
          action,
          note.trim() || undefined,
          token,
          action === 'approve' ? pendingConfirm : undefined,
        );
      }
      setPendingConfirm(false);
      setConfirmAction(null);
      setSelected(null);
      await load(status);
    } catch (e) {
      // Close the confirm modal so the error (set below, rendered in the
      // Sheet behind it) is actually visible — otherwise it silently
      // reverts to "Approve"/"Reject" with zero feedback and the admin keeps
      // re-firing the same failing request.
      setConfirmAction(null);
      const code = toStaffError(e).code;
      if (action === 'approve' && code === 'confirm_required') {
        // The server flagged this as shortening a permanent tier or
        // downgrading a higher active one (B1) — arm confirm and let the
        // admin re-tap Approve to proceed deliberately, instead of a dead
        // 409 loop (defect #1).
        setPendingConfirm(true);
        setDecideError(
          "This member's current plan is permanent or higher than what's being granted — approving will change it. Tap Approve again to confirm.",
        );
      } else {
        setPendingConfirm(false);
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
    <Screen
      scroll
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={colors.accent}
        />
      }
    >
      <BackRow
        onBack={goBack}
        action={
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Export payment requests as CSV"
            accessibilityState={{ disabled: csvBusy }}
            disabled={csvBusy}
            onPress={() => void exportPaymentsCsv()}
            style={styles.headerActionBtn}
          >
            {csvBusy ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Ionicons name="download-outline" size={20} color={colors.text} />
            )}
          </PressableScale>
        }
      />

      {csvError ? (
        <AppText variant="caption" color={colors.error} style={styles.csvErrorText}>
          {csvError}
        </AppText>
      ) : null}

      {csvLink ? (
        <View style={styles.csvLinkBlock}>
          <AppText variant="caption" color={colors.textDim}>
            Export saved on this device (long-press to copy the file path if the share sheet
            didn&apos;t open):
          </AppText>
          <Text selectable style={styles.selectableLink}>
            {csvLink}
          </Text>
          <Button label="Dismiss" variant="secondary" onPress={() => setCsvLink(null)} />
        </View>
      ) : null}

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
                {/* P0-2: current tier + expiry BEFORE approval, so the admin
                    isn't deciding blind (defect B1 — a renewal can otherwise
                    silently clobber a live paid window). */}
                <SectionLabel>Member&apos;s current plan</SectionLabel>
                {previewError ? (
                  <AppText variant="caption" color={colors.textFaint}>
                    Couldn&apos;t load the member&apos;s current plan.
                  </AppText>
                ) : previewTier === undefined ? (
                  <ActivityIndicator color={colors.textDim} style={styles.previewSpinner} />
                ) : (
                  <View style={styles.previewBlock}>
                    <AppText variant="body">
                      Currently {previewTier}
                      {previewExpiry !== undefined ? ` · ${expiryLabel(previewExpiry)}` : ''}
                    </AppText>
                    {TIER_RANK[previewTier] > TIER_RANK[selected.tier] ? (
                      <AppText variant="caption" color={colors.warning}>
                        This member already holds a HIGHER tier — approving may downgrade
                        them. Confirm this is intended.
                      </AppText>
                    ) : previewTier === selected.tier ? (
                      <AppText variant="caption" color={colors.textDim}>
                        Same tier as today — this extends the existing window by{' '}
                        {selected.months} month{selected.months === 1 ? '' : 's'}.
                      </AppText>
                    ) : (
                      <AppText variant="caption" color={colors.textDim}>
                        Grants {selected.tier} for {selected.months} month
                        {selected.months === 1 ? '' : 's'}.
                      </AppText>
                    )}
                  </View>
                )}

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

                {/* P0-1: refund an approved request — rolls the tier grant
                    back and posts a negative wallet adjustment server-side. */}
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
            ? `Grants ${selected?.account.displayName || selected?.account.email || 'this member'} ${selected?.tier} for ${selected?.months} month${selected?.months === 1 ? '' : 's'}.`
            : confirmAction === 'refund'
              ? `Reverses ${selected?.account.displayName || selected?.account.email || 'this member'}'s tier grant and posts a negative wallet adjustment for any settled commission. This cannot be undone.`
              : 'The member sees this decision and can submit a new request.'
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

      {/* Step-up password prompt for refund (plan §3 #14). */}
      <ReauthSheet controller={reauth} />
    </Screen>
  );
}

/** Shared back row + revamp header. */
function BackRow({ onBack, action }: { onBack: () => void; action?: ReactNode }) {
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
      <ScreenHeader eyebrow="Admin console" title="Payments" style={styles.header} action={action} />
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
  headerActionBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  csvErrorText: { marginBottom: spacing.sm },
  csvLinkBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  selectableLink: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
  },
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
  previewBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  previewSpinner: { marginVertical: spacing.sm, alignSelf: 'flex-start' },
  refundBtn: { marginTop: spacing.lg },
});
