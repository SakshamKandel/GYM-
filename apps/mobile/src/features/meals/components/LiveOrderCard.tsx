import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { formatMoney } from '@gym/shared';
import { AppText, Card, PressableScale, Tag } from '../../../components/ui';
import { OrderStatusStepper } from './OrderStatusStepper';
import { orderItemsSummary, relativeDay, formatCalendarDate, windowName, windowTimeRange } from './orderView';
import {
  canMemberCancelOrder,
  orderNeedsReceipt,
  orderStatusLabel,
  orderStatusTone,
  paymentStatusLabel,
} from '../logic';
import type { MealOrder } from '../api';

/**
 * The live order card — the "track something exciting" centerpiece for a
 * non-terminal order. A window/time countdown chip, partner + item summary,
 * the 5-step status stepper, and the total, with pre-cutoff cancel / receipt
 * affordances. Cancelled or refused orders render a distinct muted terminal
 * state carrying the reason instead of the stepper.
 */

const TONE_COLOR: Record<'accent' | 'success' | 'error' | 'dim', string> = {
  accent: colors.accent,
  success: colors.success,
  error: colors.error,
  dim: colors.textDim,
};

interface Props {
  order: MealOrder;
  partnerName?: string;
  onOpenDetail: (order: MealOrder) => void;
  onCancel: (order: MealOrder) => void;
  onReceipt: (order: MealOrder) => void;
}

export function LiveOrderCard({ order, partnerName, onOpenDetail, onCancel, onReceipt }: Props) {
  const terminal = order.status === 'cancelled' || order.status === 'refused';
  const day = relativeDay(order.deliveryDate) ?? formatCalendarDate(order.deliveryDate);
  const tone = orderStatusTone(order.status);
  const canCancel = canMemberCancelOrder(order);
  const needsReceipt = orderNeedsReceipt(order);

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
              <Ionicons name="close-circle" size={22} color={colors.textDim} />
            </View>
            <View style={styles.headerText}>
              <AppText variant="label" color={colors.textFaint}>
                {day} · {windowName(order.window)}
              </AppText>
              <AppText variant="bodyBold" numberOfLines={1}>
                {partnerName ?? 'Your order'}
              </AppText>
            </View>
            <Tag label={orderStatusLabel(order.status)} variant="outline" color={colors.error} />
          </View>
          <AppText variant="caption" color={colors.textDim} style={styles.terminalReason}>
            {order.cancelReason || (order.status === 'refused' ? 'Delivery was refused.' : 'This order was cancelled.')}
          </AppText>
          <View style={styles.footerRow}>
            <AppText variant="bodyBold" color={colors.textDim}>
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
          <View style={styles.iconChip}>
            <Ionicons name="bicycle" size={22} color={colors.accent} />
          </View>
          <View style={styles.headerText}>
            <AppText variant="label" color={colors.accent}>
              {day}
            </AppText>
            <AppText variant="bodyBold" numberOfLines={1}>
              {partnerName ?? 'Your order'}
            </AppText>
          </View>
          <Tag label={orderStatusLabel(order.status)} variant="outline" color={TONE_COLOR[tone]} />
        </View>

        <View style={styles.windowChip}>
          <Ionicons name="time-outline" size={14} color={colors.accent} />
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

        <View style={styles.footerRow}>
          <AppText variant="bodyBold">{formatMoney(order.totalMinor, order.currency)}</AppText>
          <View style={styles.footerRight}>
            <AppText variant="caption" color={colors.textDim}>
              {paymentStatusLabel(order)}
            </AppText>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </View>
        </View>
      </PressableScale>

      {canCancel || needsReceipt ? (
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
  headerText: { flex: 1, gap: 2 },
  windowChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.accentFaint,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  stepperWrap: { marginTop: spacing.xs },
  summary: {},
  terminalReason: { marginTop: spacing.xs },
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
