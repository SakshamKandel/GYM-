import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
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
  decideDispute,
  getDisputes,
  toStaffError,
  type DisputeRow,
  type DisputeScope,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { canReviewOrders, replaceStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { successHaptic } from '../../../lib/haptics';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Disputes — every problem a member has raised about a delivered meal
 * order, and the place someone decides what happens about it. The phone twin
 * of the web `/admin/disputes` queue: same route, same permission
 * (`orders.review`), same state machine.
 *
 * Deciding here NEVER moves money. The route only records the outcome and
 * tells the member; a refund is a separate action on the Meal payments queue,
 * which carries its own reversal and audit. The sheet says so rather than
 * letting an operator assume a resolved claim paid someone back.
 *
 * Rejecting closes a member's complaint for good, so it takes a confirmation
 * that restates what the member will be told.
 */

const TABS: { key: DisputeScope; label: string }[] = [
  { key: 'live', label: 'To review' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

const REASON_LABEL: Record<string, string> = {
  not_delivered: 'Never arrived',
  wrong_items: 'Wrong items',
  quality: 'Quality problem',
  late: 'Arrived late',
  other: 'Something else',
};

const STATUS_LABEL: Record<DisputeRow['status'], string> = {
  open: 'New',
  reviewing: 'Looking into it',
  resolved: 'Resolved',
  rejected: 'Not upheld',
};

const STATUS_COLOR: Record<DisputeRow['status'], string> = {
  open: colors.warning,
  reviewing: colors.blue,
  resolved: colors.success,
  rejected: colors.error,
};

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting on the kitchen',
  confirmed: 'Confirmed',
  preparing: 'Being cooked',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refused: 'Refused',
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  unpaid: 'Not paid',
  receipt_submitted: 'Receipt sent in',
  paid: 'Paid',
  refunded: 'Refunded',
};

const RESOLUTION_MAX_LEN = 1000;

function errorLine(code: StaffErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired. Sign in again.';
    case 'forbidden':
      return "You don't have access to review disputes.";
    case 'not_found':
      return 'That claim is no longer there. Pull down to refresh.';
    case 'conflict':
      return 'Someone else already decided this one. Pull down to refresh.';
    case 'invalid':
      return 'That note is too long. Shorten it and try again.';
    default:
      return "Couldn't reach the server. Check your connection and try again.";
  }
}

function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? 'Something else';
}

function windowLabel(w: string): string {
  return w === 'lunch' ? 'Lunch' : w === 'dinner' ? 'Dinner' : '';
}

/** 'YYYY-MM-DD' (or a full stamp) → "12 Mar 2026". */
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatDay(iso: string): string {
  const parts = iso.slice(0, 10).split('-');
  const y = Number.parseInt(parts[0] ?? '', 10);
  const m = Number.parseInt(parts[1] ?? '', 10);
  const d = Number.parseInt(parts[2] ?? '', 10);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return iso;
  return `${d} ${MONTHS[m - 1] ?? m} ${y}`;
}

/** "3h" / "5 days" — how long this claim has been sitting there. */
function ageLabel(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Name the member by display name; the address is the fallback, never the lead. */
function memberLabel(row: DisputeRow): string {
  return row.account.displayName.trim() || row.account.email || 'Member';
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <AppText variant="caption" color={colors.textFaint}>
        {label}
      </AppText>
      <AppText variant="body">{value}</AppText>
    </View>
  );
}

export default function AdminDisputesScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = canReviewOrders(staffPermissions);

  const [scope, setScope] = useState<DisputeScope>('live');
  const [rows, setRows] = useState<DisputeRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingReject, setConfirmingReject] = useState(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!token) return;
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);
      setLoadError(null);
      try {
        setRows(await getDisputes(token, scope));
      } catch (err) {
        setLoadError(errorLine(toStaffError(err).code));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token, scope],
  );

  useEffect(() => {
    if (allowed) void load('initial');
  }, [allowed, load]);

  const selected = useMemo(
    () => rows?.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );

  function openRow(row: DisputeRow): void {
    setSelectedId(row.id);
    setResolution('');
    setActionError(null);
    setConfirmingReject(false);
  }

  function closeSheet(): void {
    if (busy) return;
    setSelectedId(null);
    setConfirmingReject(false);
  }

  const decide = useCallback(
    async (toStatus: 'reviewing' | 'resolved' | 'rejected') => {
      if (!token || !selected || busy) return;
      setBusy(true);
      setActionError(null);
      try {
        await decideDispute(selected.id, toStatus, resolution.trim() || undefined, token);
        successHaptic();
        setConfirmingReject(false);
        setSelectedId(null);
        setResolution('');
        void load('refresh');
      } catch (err) {
        setActionError(errorLine(toStaffError(err).code));
        setConfirmingReject(false);
      } finally {
        setBusy(false);
      }
    },
    [token, selected, busy, resolution, load],
  );

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
            You don&apos;t have access to review order disputes.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  const liveCount = rows?.filter((r) => r.status === 'open' || r.status === 'reviewing').length ?? 0;

  return (
    <Screen
      scroll
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load('refresh')}
          tintColor={colors.accent}
          colors={[colors.accent]}
        />
      }
    >
      <BackRow onBack={goBack} />

      <View style={styles.filterRow}>
        {TABS.map((t) => (
          <Chip
            key={t.key}
            label={t.label}
            selected={scope === t.key}
            onPress={() => {
              if (scope !== t.key) {
                setScope(t.key);
                setRows(null);
              }
            }}
          />
        ))}
      </View>

      {scope === 'live' && liveCount > 0 ? (
        <AppText variant="caption" color={colors.textDim} style={styles.countLine}>
          {liveCount} claim{liveCount === 1 ? '' : 's'} waiting on a decision, longest first.
        </AppText>
      ) : null}

      {loading && !rows ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : loadError && !rows ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Retry loading disputes"
          onPress={() => void load('initial')}
          style={styles.retry}
        >
          <Ionicons name="refresh" size={15} color={colors.textDim} />
          <AppText variant="caption">{loadError} Tap to retry.</AppText>
        </PressableScale>
      ) : !rows || rows.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="checkmark-circle-outline" size={32} color={colors.textFaint} />
          <AppText variant="title" center>
            Nothing here
          </AppText>
          <AppText variant="caption" center color={colors.textDim}>
            {scope === 'live'
              ? 'When a member reports a problem with a delivered order, it lands here.'
              : 'No claims in this view yet.'}
          </AppText>
        </View>
      ) : (
        <View style={styles.list}>
          {loadError ? (
            <AppText variant="caption" color={colors.error}>
              {loadError}
            </AppText>
          ) : null}
          {rows.map((row, i) => (
            <Animated.View key={row.id} entering={enterUp(Math.min(i, 6))}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Open the claim on order ${row.orderNumber} from ${memberLabel(row)}`}
                onPress={() => openRow(row)}
                style={styles.row}
              >
                <View style={styles.rowText}>
                  <View style={styles.rowHead}>
                    <AppText variant="bodyBold" numberOfLines={1} style={styles.rowTitle}>
                      {memberLabel(row)}
                    </AppText>
                    <Tag
                      label={STATUS_LABEL[row.status]}
                      variant="outline"
                      color={STATUS_COLOR[row.status]}
                    />
                  </View>
                  <AppText variant="caption" numberOfLines={1}>
                    {reasonLabel(row.reason)} · {row.partnerName || 'Restaurant'} · order{' '}
                    {row.orderNumber}
                  </AppText>
                  <AppText variant="caption" color={colors.textFaint} numberOfLines={1}>
                    {formatMoney(row.order.totalMinor, row.order.currency)} ·{' '}
                    {ageLabel(row.createdAt)}
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
              </PressableScale>
            </Animated.View>
          ))}
        </View>
      )}

      <Sheet
        visible={selected !== null}
        onClose={closeSheet}
        title={selected ? `Order ${selected.orderNumber}` : 'Claim'}
      >
        {selected ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.sheetScroll}
          >
            <View style={styles.tagRow}>
              <Tag
                label={STATUS_LABEL[selected.status]}
                variant="outline"
                color={STATUS_COLOR[selected.status]}
              />
              <Tag label={reasonLabel(selected.reason)} variant="dim" />
            </View>

            <DetailRow label="Member" value={memberLabel(selected)} />
            <DetailRow label="Restaurant" value={selected.partnerName || '—'} />
            <DetailRow
              label="Order total"
              value={formatMoney(selected.order.totalMinor, selected.order.currency)}
            />
            <DetailRow
              label="Delivery"
              value={
                windowLabel(selected.order.window)
                  ? `${formatDay(selected.order.deliveryDate)} · ${windowLabel(selected.order.window)}`
                  : formatDay(selected.order.deliveryDate)
              }
            />
            <DetailRow
              label="Order"
              value={ORDER_STATUS_LABEL[selected.order.status] ?? selected.order.status}
            />
            <DetailRow
              label="Payment"
              value={PAYMENT_STATUS_LABEL[selected.order.paymentStatus] ?? selected.order.paymentStatus}
            />
            <DetailRow label="Raised" value={ageLabel(selected.createdAt)} />

            <SectionLabel>What the member said</SectionLabel>
            <AppText variant="body">{selected.note.trim() || 'They left no note.'}</AppText>

            {selected.resolution ? (
              <>
                <SectionLabel>What we told them</SectionLabel>
                <AppText variant="body">{selected.resolution}</AppText>
              </>
            ) : null}

            {selected.status === 'open' || selected.status === 'reviewing' ? (
              <>
                <SectionLabel>Note for the member (optional)</SectionLabel>
                <AppTextInput
                  value={resolution}
                  onChangeText={setResolution}
                  placeholder="They will read this word for word"
                  multiline
                  maxLength={RESOLUTION_MAX_LEN}
                  editable={!busy}
                  style={styles.resolutionInput}
                  accessibilityLabel="Note for the member"
                />

                <View style={styles.moneyNote}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.textDim} />
                  <AppText variant="caption" color={colors.textDim} style={styles.moneyNoteText}>
                    Deciding here doesn&apos;t move money. If this member is owed a refund, do that
                    on Meal payments first.
                  </AppText>
                </View>

                {actionError ? (
                  <AppText variant="caption" color={colors.error}>
                    {actionError}
                  </AppText>
                ) : null}

                {selected.status === 'open' ? (
                  <Button
                    label="Start looking into it"
                    variant="secondary"
                    onPress={() => void decide('reviewing')}
                    disabled={busy}
                    style={styles.actionBtn}
                  />
                ) : null}
                <Button
                  label={busy ? 'Saving…' : 'Mark resolved'}
                  onPress={() => void decide('resolved')}
                  loading={busy}
                  disabled={busy}
                  style={styles.actionBtn}
                />
                <Button
                  label="Reject the claim"
                  variant="danger"
                  onPress={() => setConfirmingReject(true)}
                  disabled={busy}
                  style={styles.actionBtn}
                />
              </>
            ) : (
              <AppText variant="caption" color={colors.textDim} style={styles.closedLine}>
                This claim is closed. Nothing left to do.
              </AppText>
            )}
          </ScrollView>
        ) : null}
      </Sheet>

      <ConfirmDialog
        visible={selected !== null && confirmingReject}
        title="Reject this claim?"
        message={
          selected
            ? `${memberLabel(selected)} is told their claim about order ${
                selected.orderNumber
              } was not upheld, and no money moves. It closes for good.${
                resolution.trim() ? '' : ' You have not written a note, so they get no reason.'
              }`
            : undefined
        }
        confirmLabel={busy ? 'Rejecting…' : 'Reject claim'}
        cancelLabel="Go back"
        danger
        onConfirm={() => void decide('rejected')}
        onCancel={() => {
          if (!busy) setConfirmingReject(false);
        }}
      />
    </Screen>
  );
}

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
      <ScreenHeader eyebrow="Admin console" title="Disputes" style={styles.header} />
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
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  countLine: { marginBottom: spacing.md },
  center: { paddingVertical: spacing.xxl, alignItems: 'center', gap: spacing.md },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    minHeight: touch.min,
  },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },
  rowText: { flex: 1, gap: 3 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { flexShrink: 1 },
  sheetScroll: { paddingBottom: spacing.xxl, gap: spacing.sm },
  tagRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap' },
  detailRow: { gap: 2, paddingVertical: spacing.xs },
  resolutionInput: { minHeight: 96, paddingTop: spacing.md, textAlignVertical: 'top' },
  moneyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  moneyNoteText: { flex: 1 },
  actionBtn: { marginTop: spacing.md },
  closedLine: { marginTop: spacing.lg },
});
