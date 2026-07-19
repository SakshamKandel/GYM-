import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { canActorAdvance, formatMoney, ORDER_STATUSES, type OrderStatus } from '@gym/shared';
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
  fetchAdminOrders,
  overrideOrderStatus,
  toStaffError,
  type AdminOrderRow,
  type AdminOrderScope,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { canReviewOrders, replaceStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Orders — all-partners meal-order oversight (plan §3 / §6 / §7 P11).
 * Mirrors the web admin semantics 1:1: `GET /api/admin/orders` (materializes
 * due subscription orders server-side, same as the partner queue) narrowed by
 * `scope` (active/history) and an optional `status`, then
 * `POST /api/admin/orders/[id]/override` to force-advance — every transition a
 * partner may drive, PLUS "cancel any non-terminal order" (§3's admin-only
 * override row), gated server-side by `canActorAdvance(from, to, 'admin')`.
 *
 * This screen never sees the member's raw accountId/email — only the
 * delivery-necessary projection (name/phone/address), same discipline as the
 * partner portal (§2), plus the partner's own name since an admin spans every
 * restaurant.
 */

const SCOPE_TABS: { key: AdminOrderScope; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'history', label: 'History' },
];

const ACTIVE_STATUS_FILTERS: { key: OrderStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'out_for_delivery', label: 'Out for delivery' },
];

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refused: 'Refused',
};

const STATUS_ICON: Record<OrderStatus, keyof typeof Ionicons.glyphMap> = {
  pending: 'hourglass-outline',
  confirmed: 'checkmark-circle-outline',
  preparing: 'flame-outline',
  out_for_delivery: 'bicycle-outline',
  delivered: 'checkmark-done-circle-outline',
  cancelled: 'close-circle-outline',
  refused: 'alert-circle-outline',
};

function statusColor(status: OrderStatus): string {
  if (status === 'delivered') return colors.success;
  if (status === 'cancelled' || status === 'refused') return colors.error;
  if (status === 'out_for_delivery' || status === 'preparing') return colors.accent;
  return colors.textDim;
}

const METHOD_LABEL: Record<AdminOrderRow['paymentMethod'], string> = {
  esewa: 'eSewa',
  khalti: 'Khalti',
  cod: 'Cash on delivery',
};

const PAYMENT_STATUS_LABEL: Record<AdminOrderRow['paymentStatus'], string> = {
  unpaid: 'Unpaid',
  receipt_submitted: 'Receipt submitted',
  paid: 'Paid',
  refunded: 'Refunded',
};

function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have access to this.";
  if (code === 'not_found') return 'That order is no longer available.';
  if (code === 'conflict')
    return 'This order already moved on — refresh the queue and try again.';
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

export default function AdminOrdersScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = canReviewOrders(staffPermissions);

  const [scope, setScope] = useState<AdminOrderScope>('active');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');
  const [rows, setRows] = useState<AdminOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<AdminOrderRow | null>(null);
  const [reason, setReason] = useState('');
  const [pendingTarget, setPendingTarget] = useState<OrderStatus | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // G8: a slow response for one tab must not clobber a faster tab-switch.
  const listSeq = useRef(0);

  const load = useCallback(
    async (sc: AdminOrderScope, st: OrderStatus | 'all') => {
      if (!token) return;
      const seq = ++listSeq.current;
      setLoading(true);
      setError(null);
      try {
        const data = await fetchAdminOrders(token, {
          scope: sc,
          ...(sc === 'active' && st !== 'all' ? { status: st } : {}),
        });
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
    if (allowed) void load(scope, statusFilter);
  }, [allowed, scope, statusFilter, load]);

  function openDetail(row: AdminOrderRow): void {
    setSelected(row);
    setReason('');
    setActionError(null);
    setPendingTarget(null);
  }

  function closeDetail(): void {
    setSelected(null);
  }

  async function applyOverride(toStatus: OrderStatus): Promise<void> {
    if (!token || !selected || acting) return;
    setActing(true);
    setActionError(null);
    try {
      await overrideOrderStatus(selected.id, toStatus, reason.trim() || undefined, token);
      setPendingTarget(null);
      setSelected(null);
      await load(scope, statusFilter);
    } catch (e) {
      setPendingTarget(null);
      setActionError(errorLine(toStaffError(e).code));
    } finally {
      setActing(false);
    }
  }

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replaceStaff(STAFF_ROUTES.adminHome);
  }

  // Every status this admin could force the selected order into, per the
  // shared structural machine (server re-checks this authoritatively).
  const candidateTargets: OrderStatus[] = selected
    ? ORDER_STATUSES.filter(
        (to) => to !== selected.status && canActorAdvance(selected.status, to, 'admin'),
      )
    : [];

  if (!allowed) {
    return (
      <Screen>
        <BackRow onBack={goBack} />
        <Animated.View entering={enterUp(0)} style={styles.locked}>
          <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textFaint}>
            Only a super admin or main admin can oversee meal orders.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <BackRow onBack={goBack} />

      <Animated.View entering={enterDown()} style={styles.tabsRow}>
        {SCOPE_TABS.map((t) => (
          <Chip
            key={t.key}
            label={t.label}
            selected={scope === t.key}
            onPress={() => setScope(t.key)}
          />
        ))}
      </Animated.View>

      {scope === 'active' ? (
        <Animated.View entering={enterDown()} style={styles.tabsRow}>
          {ACTIVE_STATUS_FILTERS.map((t) => (
            <Chip
              key={t.key}
              label={t.label}
              selected={statusFilter === t.key}
              onPress={() => setStatusFilter(t.key)}
            />
          ))}
        </Animated.View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.retryWrap}>
          <RetryLine message={error} onRetry={() => void load(scope, statusFilter)} />
        </View>
      ) : rows.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.emptyLine}>
          No {scope === 'active' ? 'active' : 'past'} orders.
        </AppText>
      ) : (
        <View style={styles.list}>
          {rows.map((r, i) => (
            <Animated.View key={r.id} entering={enterUp(Math.min(i, 6))}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Open order for ${r.deliveryName}`}
                onPress={() => openDetail(r)}
                style={styles.row}
              >
                <Ionicons name={STATUS_ICON[r.status]} size={22} color={statusColor(r.status)} />
                <View style={styles.rowText}>
                  <AppText variant="bodyBold" numberOfLines={1}>
                    {r.partnerName} · {r.deliveryName}
                  </AppText>
                  <AppText variant="caption" numberOfLines={1}>
                    {r.deliveryDate} {r.window} · {STATUS_LABEL[r.status]}
                  </AppText>
                </View>
                <View style={styles.rowRight}>
                  <AppText variant="bodyBold" tabular>
                    {formatMoney(r.totalMinor, r.currency)}
                  </AppText>
                  <AppText variant="caption" color={colors.textFaint}>
                    {relativeTime(r.placedAt)}
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
        title={selected ? `${selected.partnerName} · ${STATUS_LABEL[selected.status]}` : 'Order'}
      >
        {selected ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScroll}>
            <View style={styles.amountRow}>
              <AppText variant="display" tabular>
                {formatMoney(selected.totalMinor, selected.currency)}
              </AppText>
              <Tag label={METHOD_LABEL[selected.paymentMethod]} variant="dim" />
            </View>

            <SectionLabel>Customer</SectionLabel>
            <AppText variant="bodyBold">{selected.deliveryName}</AppText>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Call ${selected.deliveryName} at ${selected.deliveryPhone}`}
              onPress={() =>
                void Linking.openURL(`tel:${selected.deliveryPhone.replace(/[^+\d]/g, '')}`)
              }
              style={styles.contactRow}
            >
              <Ionicons name="call-outline" size={18} color={colors.accent} />
              <AppText variant="body" color={colors.accent}>
                {selected.deliveryPhone}
              </AppText>
            </PressableScale>
            <AppText variant="caption" color={colors.textDim}>
              {selected.deliveryAddressText}
            </AppText>
            {selected.deliveryNotes ? (
              <AppText variant="caption" color={colors.textFaint} style={styles.noteLine}>
                Note: {selected.deliveryNotes}
              </AppText>
            ) : null}
            {selected.deliveryLat != null && selected.deliveryLng != null ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Open delivery location in maps"
                onPress={() =>
                  void Linking.openURL(
                    `https://www.google.com/maps?q=${selected.deliveryLat},${selected.deliveryLng}`,
                  )
                }
                style={styles.contactRow}
              >
                <Ionicons name="map-outline" size={18} color={colors.accent} />
                <AppText variant="body" color={colors.accent}>
                  Open map
                </AppText>
              </PressableScale>
            ) : (
              <AppText variant="caption" color={colors.textFaint} style={styles.noteLine}>
                No map pin — address is text-only.
              </AppText>
            )}
            <AppText variant="caption" color={colors.textFaint} style={styles.slotLine}>
              {selected.deliveryDate} · {selected.window} · placed {relativeTime(selected.placedAt)}
            </AppText>

            <SectionLabel>Items</SectionLabel>
            {selected.items.map((it, idx) => (
              <View key={idx} style={styles.itemRow}>
                <AppText variant="body" style={styles.itemName} numberOfLines={1}>
                  {it.qty}× {it.name}
                </AppText>
                <AppText variant="caption" tabular color={colors.textDim}>
                  {formatMoney(it.priceMinorSnapshot * it.qty, selected.currency)}
                </AppText>
              </View>
            ))}

            <SectionLabel>Payment</SectionLabel>
            <AppText variant="body">{PAYMENT_STATUS_LABEL[selected.paymentStatus]}</AppText>

            {selected.cancelReason ? (
              <>
                <SectionLabel>Cancel reason</SectionLabel>
                <AppText variant="caption" color={colors.textDim}>
                  {selected.cancelReason}
                </AppText>
              </>
            ) : null}

            {candidateTargets.length > 0 ? (
              <>
                <SectionLabel>Force status</SectionLabel>
                <AppTextInput
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Reason (optional, audited)"
                  multiline
                  style={styles.noteInput}
                />
                {actionError ? (
                  <AppText variant="caption" color={colors.error} style={styles.actionError}>
                    {actionError}
                  </AppText>
                ) : null}
                <View style={styles.targetGrid}>
                  {candidateTargets.map((to) => (
                    <Button
                      key={to}
                      label={STATUS_LABEL[to]}
                      variant={to === 'cancelled' || to === 'refused' ? 'danger' : 'secondary'}
                      style={styles.targetBtn}
                      onPress={() => setPendingTarget(to)}
                      disabled={acting}
                    />
                  ))}
                </View>
              </>
            ) : (
              <AppText variant="caption" color={colors.textFaint} style={styles.terminalLine}>
                This order is in a terminal state — no further transitions.
              </AppText>
            )}
          </ScrollView>
        ) : null}
      </Sheet>

      <ConfirmDialog
        visible={pendingTarget !== null}
        title={pendingTarget ? `Force status to “${STATUS_LABEL[pendingTarget]}”?` : ''}
        message={
          pendingTarget === 'cancelled'
            ? 'This cancels the order regardless of its current stage — this cannot be undone.'
            : "This overrides the order's fulfillment status directly, bypassing the partner's own console."
        }
        confirmLabel={acting ? 'Working…' : 'Confirm'}
        cancelLabel="Cancel"
        danger={pendingTarget === 'cancelled' || pendingTarget === 'refused'}
        onConfirm={() => {
          if (pendingTarget) void applyOverride(pendingTarget);
        }}
        onCancel={() => setPendingTarget(null)}
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
      <ScreenHeader eyebrow="Admin console" title="Orders" style={styles.header} />
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
  slotLine: { marginTop: spacing.xs },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touch.min,
  },
  noteLine: { marginTop: spacing.xs },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  itemName: { flex: 1 },
  noteInput: {
    marginTop: spacing.sm,
    minHeight: 64,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  actionError: { marginTop: spacing.sm },
  targetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  targetBtn: { minWidth: '46%', flexGrow: 1 },
  terminalLine: { marginTop: spacing.md },
});
