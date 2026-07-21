import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import { formatMoney } from '@gym/shared';
import { AppText, Card, PressableScale } from '../../../components/ui';
import { OrderStatusStepper } from './OrderStatusStepper';
import { LiveDot } from './LiveDot';
import {
  orderItemsSummary,
  orderStatusColor,
  orderStatusWash,
  relativeDay,
  formatCalendarDate,
  sumOrderMacros,
  windowName,
  windowTimeRange,
} from './orderView';
import {
  cancelBlockMessage,
  cancelBlockNeedsSupport,
  memberOrderCancelState,
  orderNeedsReceipt,
  orderStatusLabel,
  paymentStatusLabel,
} from '../logic';
import type { MealOrder, MealOrderStatus } from '../api';

/**
 * The live order card — the "track something exciting" centerpiece for a
 * non-terminal order. A live-pulse status pill in the order's semantic status
 * color, partner + window chip, the 5-step status stepper, a macro roll-up
 * (this is a fitness app: kcal + protein lead), and the total, with
 * pre-cutoff cancel / receipt affordances. Cancelled or refused orders render
 * a distinct muted terminal state carrying the reason instead of the stepper.
 */

interface Props {
  order: MealOrder;
  partnerName?: string;
  onOpenDetail: (order: MealOrder) => void;
  onCancel: (order: MealOrder) => void;
  onReceipt: (order: MealOrder) => void;
  /** B2: the member taps into support with this order pre-attached — shown
   * instead of Cancel when money is already in flight (payment under review
   * or captured), so the tap never dead-ends on a guaranteed 409. */
  onSupport?: (order: MealOrder, reason: string) => void;
}

function StatusPill({ status }: { status: MealOrderStatus }) {
  const color = orderStatusColor(status);
  return (
    <View style={[styles.statusPill, { backgroundColor: orderStatusWash(status) }]}>
      <View style={[styles.statusPillDot, { backgroundColor: color }]} />
      <AppText style={[styles.statusPillText, { color }]} tabular={false} numberOfLines={1}>
        {orderStatusLabel(status)}
      </AppText>
    </View>
  );
}

export function LiveOrderCard({ order, partnerName, onOpenDetail, onCancel, onReceipt, onSupport }: Props) {
  const terminal = order.status === 'cancelled' || order.status === 'refused';
  const day = relativeDay(order.deliveryDate) ?? formatCalendarDate(order.deliveryDate);
  const statusColor = orderStatusColor(order.status);
  const cancelState = memberOrderCancelState(order);
  const canCancel = cancelState.allowed;
  const supportBlock =
    !cancelState.allowed && cancelState.blocked && cancelBlockNeedsSupport(cancelState.blocked)
      ? cancelState.blocked
      : null;
  const needsReceipt = orderNeedsReceipt(order);
  const macros = sumOrderMacros(order);

  if (terminal) {
    return (
      <Card style={styles.card}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${orderStatusLabel(order.status)} ${windowName(order.window)} order — view details`}
          onPress={() => onOpenDetail(order)}
          style={styles.pressArea}
        >
          <View style={styles.headerRow}>
            <View style={[styles.iconChip, styles.iconChipMuted]}>
              <Ionicons name="close-circle" size={22} color={colors.error} />
            </View>
            <View style={styles.headerText}>
              <AppText variant="label" color={colors.textFaint}>
                {day} · {windowName(order.window)}
              </AppText>
              <AppText variant="title" numberOfLines={1}>
                {partnerName ?? 'Your order'}
              </AppText>
            </View>
            <StatusPill status={order.status} />
          </View>
          <AppText variant="caption" color={colors.textDim} style={styles.terminalReason}>
            {order.cancelReason || (order.status === 'refused' ? 'Delivery was refused.' : 'This order was cancelled.')}
          </AppText>
          <View style={styles.footerRow}>
            <AppText style={styles.totalText} color={colors.textDim} tabular>
              {formatMoney(order.totalMinor, order.currency)}
            </AppText>
            <AppText variant="caption" color={colors.textDim}>
              {paymentStatusLabel(order)}
            </AppText>
          </View>
        </PressableScale>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${windowName(order.window)} order from ${
          partnerName ?? 'your partner'
        } — ${orderStatusLabel(order.status)}. View details.`}
        onPress={() => onOpenDetail(order)}
        style={styles.pressArea}
      >
        <View style={styles.headerRow}>
          <View style={[styles.iconChip, { backgroundColor: orderStatusWash(order.status) }]}>
            <Ionicons name="bicycle" size={22} color={statusColor} />
          </View>
          <View style={styles.headerText}>
            <View style={styles.liveRow}>
              <LiveDot color={statusColor} />
              <AppText variant="label" color={statusColor}>
                {day}
                {order.orderNumber ? ` · ${order.orderNumber}` : ''}
              </AppText>
            </View>
            <AppText variant="title" numberOfLines={1}>
              {partnerName ?? 'Your order'}
            </AppText>
          </View>
          <StatusPill status={order.status} />
        </View>

        <View style={[styles.windowChip, { backgroundColor: orderStatusWash(order.status) }]}>
          <Ionicons name="time-outline" size={14} color={statusColor} />
          <AppText variant="caption" color={colors.text} tabular={false}>
            {windowName(order.window)} · {windowTimeRange(order.window)}
          </AppText>
        </View>

        <View style={styles.stepperWrap}>
          <OrderStatusStepper status={order.status} />
        </View>

        <AppText variant="caption" color={colors.textDim} numberOfLines={2} style={styles.summary}>
          {orderItemsSummary(order)}
        </AppText>

        <View style={styles.macroRow}>
          <View style={styles.macroItem}>
            <View style={[styles.macroDot, { backgroundColor: colors.kcal }]} />
            <AppText variant="caption" color={colors.textDim} tabular>
              {macros.kcal} kcal
            </AppText>
          </View>
          <View style={styles.macroItem}>
            <View style={[styles.macroDot, { backgroundColor: colors.protein }]} />
            <AppText variant="caption" color={colors.textDim} tabular>
              P {Math.round(macros.proteinG)}g
            </AppText>
          </View>
        </View>

        <View style={styles.footerRow}>
          <AppText style={styles.totalText} tabular>
            {formatMoney(order.totalMinor, order.currency)}
          </AppText>
          <View style={styles.footerRight}>
            <AppText variant="caption" color={colors.textDim}>
              {paymentStatusLabel(order)}
            </AppText>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </View>
        </View>
      </PressableScale>

      {canCancel || needsReceipt || supportBlock ? (
        <View style={styles.actionsRow}>
          {needsReceipt ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Submit payment receipt"
              onPress={() => onReceipt(order)}
              style={styles.actionBtn}
            >
              <AppText variant="bodyBold">Submit receipt</AppText>
            </PressableScale>
          ) : null}
          {canCancel ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Cancel this order"
              onPress={() => onCancel(order)}
              style={[styles.actionBtn, styles.actionBtnDanger]}
            >
              <AppText variant="bodyBold" color={colors.error}>
                Cancel
              </AppText>
            </PressableScale>
          ) : supportBlock && onSupport ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Contact support to cancel this order"
              onPress={() => onSupport(order, cancelBlockMessage(supportBlock) ?? '')}
              style={styles.actionBtn}
            >
              <AppText variant="bodyBold">Contact support</AppText>
            </PressableScale>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  pressArea: { gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconChip: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accentFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconChipMuted: { backgroundColor: colors.surfaceRaised },
  headerText: { flex: 1, gap: 3 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  statusPillDot: { width: 7, height: 7, borderRadius: 4 },
  statusPillText: {
    fontFamily: type.display,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  windowChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  stepperWrap: { marginTop: spacing.xs },
  summary: {},
  macroRow: { flexDirection: 'row', gap: spacing.lg },
  macroItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  macroDot: { width: 7, height: 7, borderRadius: 4 },
  terminalReason: { marginTop: spacing.xs },
  totalText: {
    fontFamily: type.display,
    fontSize: 22,
    color: colors.text,
    letterSpacing: 0.5,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  footerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  actionBtn: {
    flex: 1,
    minHeight: touch.min,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  actionBtnDanger: { borderWidth: 1.5, borderColor: colors.error, backgroundColor: 'transparent' },
});
