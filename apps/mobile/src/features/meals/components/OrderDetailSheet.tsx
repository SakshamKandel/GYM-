import { useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { formatMoney } from '@gym/shared';
import { AppText, Button, PressableScale, Sheet, Tag } from '../../../components/ui';
import { fetchMealMenu, toMealsError, type MealOrder } from '../api';
import { useMealCart } from '../cartStore';
import { pushPath } from '../nav';
import {
  mealErrorMessage,
  orderStatusLabel,
  orderStatusTone,
  paymentMethodLabel,
  paymentStatusLabel,
} from '../logic';
import {
  formatEventTime,
  orderEventRows,
  orderFeeRows,
  orderItemCount,
  orderItemsSummary,
  relativeDay,
  formatCalendarDate,
  sumOrderMacros,
  windowName,
  windowTimeRange,
} from './orderView';
import { RatingPanel } from './RatingPanel';
import { TipPanel } from './TipPanel';
import { DisputePanel } from './DisputePanel';

/**
 * Full order detail sheet: macro roll-up (protein + calories lead — this is a
 * fitness app), the itemized list, fee breakdown, payment, the event timeline
 * built from the order's frozen timestamps, the delivery address, and a
 * one-tap Reorder that rebuilds the cart from this order and drops the member
 * back on the partner's menu (items no longer on the menu are skipped).
 */

const TONE_COLOR: Record<'accent' | 'success' | 'error' | 'dim', string> = {
  accent: colors.accent,
  success: colors.success,
  error: colors.error,
  dim: colors.textDim,
};

type ReorderState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'none' };

type ActivePanel = 'none' | 'rating' | 'tip' | 'dispute';

interface Props {
  order: MealOrder | null;
  token: string | null;
  partnerName?: string;
  onClose: () => void;
  /** Fires after a tip update changes the order's total, or after a rating /
   * dispute submits — lets the caller refresh its own list state. */
  onOrderChanged?: (order?: MealOrder) => void;
}

export function OrderDetailSheet({ order, token, partnerName, onClose, onOrderChanged }: Props) {
  const [reorder, setReorder] = useState<ReorderState>({ phase: 'idle' });
  const [panel, setPanel] = useState<ActivePanel>('none');

  // Reset the reorder affordance + any open panel whenever a different order
  // opens the sheet (or the sheet closes).
  useEffect(() => {
    setReorder({ phase: 'idle' });
    setPanel('none');
  }, [order?.id]);

  function shareReceipt(): void {
    if (!order) return;
    const lines = order.items.map((item) => `${item.qty}x ${item.name} — ${formatMoney(item.priceMinorSnapshot * item.qty, order.currency)}`);
    const message = [
      `Order ${order.orderNumber || order.id}`,
      partnerName ?? '',
      orderItemsSummary(order),
      ...lines,
      `Total: ${formatMoney(order.totalMinor, order.currency)}`,
      `Status: ${orderStatusLabel(order.status)}`,
    ]
      .filter(Boolean)
      .join('\n');
    void Share.share({ message, title: `Order ${order.orderNumber || order.id}` });
  }

  function doReorder(): void {
    if (!order || !token || reorder.phase === 'loading') return;
    setReorder({ phase: 'loading' });
    void (async () => {
      try {
        const menu = await fetchMealMenu(token, order.partnerId);
        const byId = new Map(menu.map((m) => [m.id, m]));
        const matched = order.items.flatMap((item) => {
          const meal = byId.get(item.mealId);
          return meal ? [{ meal, qty: item.qty }] : [];
        });
        if (matched.length === 0) {
          setReorder({ phase: 'none' });
          return;
        }
        const cart = useMealCart.getState();
        cart.setPartner(order.partnerId);
        cart.clear();
        for (const { meal, qty } of matched) cart.setQty(meal, Math.min(qty, 20));
        onClose();
        pushPath(`/meals/${order.partnerId}`);
      } catch (err) {
        setReorder({ phase: 'error', message: mealErrorMessage(toMealsError(err).code) });
      }
    })();
  }

  const macros = order ? sumOrderMacros(order) : null;
  const tone = order ? orderStatusTone(order.status) : 'dim';
  const day = order ? (relativeDay(order.deliveryDate) ?? formatCalendarDate(order.deliveryDate)) : '';

  return (
    <Sheet visible={order !== null} onClose={onClose} title="Order details">
      {order && macros ? (
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <AppText variant="bodyBold" numberOfLines={1}>
                {partnerName ?? 'Your order'}
              </AppText>
              <AppText variant="caption" color={colors.textDim}>
                {order.orderNumber ? `${order.orderNumber} · ` : ''}
                {day} · {windowName(order.window)} · {windowTimeRange(order.window)}
              </AppText>
            </View>
            <Tag label={orderStatusLabel(order.status)} variant="outline" color={TONE_COLOR[tone]} />
          </View>

          {/* Macro roll-up — protein + calories front and center. */}
          <View style={styles.macroHero}>
            <View style={styles.macroPrimary}>
              <View style={styles.macroTile}>
                <AppText variant="display" color={colors.protein} style={styles.macroNumber}>
                  {Math.round(macros.proteinG)}
                </AppText>
                <AppText variant="label" color={colors.textDim}>
                  Protein · g
                </AppText>
              </View>
              <View style={styles.macroDivider} />
              <View style={styles.macroTile}>
                <AppText variant="display" color={colors.kcal} style={styles.macroNumber}>
                  {Math.round(macros.kcal)}
                </AppText>
                <AppText variant="label" color={colors.textDim}>
                  Calories
                </AppText>
              </View>
            </View>
            <AppText variant="caption" color={colors.textFaint} center style={styles.macroSecondary} tabular>
              {Math.round(macros.carbsG)} g carbs · {Math.round(macros.fatG)} g fat ·{' '}
              {orderItemCount(order)} {orderItemCount(order) === 1 ? 'meal' : 'meals'}
            </AppText>
          </View>

          {/* Items */}
          <AppText variant="label" style={styles.sectionLabel}>
            Items
          </AppText>
          <View style={styles.section}>
            {order.items.map((item) => (
              <View key={item.mealId} style={styles.itemRow}>
                <View style={styles.qtyBadge}>
                  <AppText variant="caption" color={colors.text} tabular>
                    {item.qty}×
                  </AppText>
                </View>
                <View style={styles.itemMain}>
                  <AppText variant="body" numberOfLines={2}>
                    {item.name}
                  </AppText>
                  <AppText variant="caption" color={colors.textFaint} tabular>
                    {formatMoney(item.priceMinorSnapshot, order.currency)} each · {Math.round(item.macros.proteinG)} g
                    protein
                  </AppText>
                </View>
                <AppText variant="bodyBold" tabular>
                  {formatMoney(item.priceMinorSnapshot * item.qty, order.currency)}
                </AppText>
              </View>
            ))}
          </View>

          {/* Fees */}
          <View style={styles.feeBlock}>
            {orderFeeRows(order).map((row) => (
              <View key={row.label} style={styles.feeRow}>
                <AppText
                  variant={row.total ? 'bodyBold' : 'caption'}
                  color={row.total ? colors.text : colors.textDim}
                >
                  {row.label}
                </AppText>
                <AppText variant={row.total ? 'bodyBold' : 'caption'} color={row.total ? colors.text : colors.textDim} tabular>
                  {formatMoney(row.amountMinor, order.currency)}
                </AppText>
              </View>
            ))}
          </View>

          {/* Payment */}
          <AppText variant="label" style={styles.sectionLabel}>
            Payment
          </AppText>
          <View style={styles.paymentRow}>
            <View style={styles.paymentText}>
              <AppText variant="body">{paymentMethodLabel(order.paymentMethod)}</AppText>
              <AppText variant="caption" color={colors.textDim}>
                {paymentStatusLabel(order)}
              </AppText>
            </View>
            <Ionicons
              name={order.paymentStatus === 'paid' ? 'checkmark-circle' : 'card-outline'}
              size={22}
              color={order.paymentStatus === 'paid' ? colors.success : colors.textDim}
            />
          </View>

          {/* Timeline */}
          <AppText variant="label" style={styles.sectionLabel}>
            Timeline
          </AppText>
          <View style={styles.timeline}>
            {orderEventRows(order).map((row, i, rows) => (
              <View key={row.key} style={styles.eventRow}>
                <View style={styles.eventRail}>
                  <View
                    style={[
                      styles.eventDot,
                      { backgroundColor: row.reached ? TONE_COLOR[row.tone] : colors.surface,
                        borderColor: row.reached ? TONE_COLOR[row.tone] : colors.borderStrong },
                    ]}
                  />
                  {i < rows.length - 1 ? (
                    <View
                      style={[styles.eventLine, { backgroundColor: row.reached ? colors.accent : colors.borderStrong }]}
                    />
                  ) : null}
                </View>
                <View style={styles.eventText}>
                  <AppText variant="body" color={row.reached ? colors.text : colors.textFaint}>
                    {row.label}
                  </AppText>
                  {row.at ? (
                    <AppText variant="caption" color={colors.textFaint}>
                      {formatEventTime(row.at)}
                    </AppText>
                  ) : null}
                </View>
              </View>
            ))}
          </View>

          {/* Delivery address */}
          <AppText variant="label" style={styles.sectionLabel}>
            Delivering to
          </AppText>
          <View style={styles.addressBlock}>
            <AppText variant="bodyBold">{order.deliveryName}</AppText>
            <AppText variant="caption" color={colors.textDim}>
              {order.deliveryPhone}
            </AppText>
            <AppText variant="body" color={colors.textDim} style={styles.addressLine}>
              {order.deliveryAddressText}
            </AppText>
            {order.deliveryNotes ? (
              <AppText variant="caption" color={colors.textFaint}>
                Note: {order.deliveryNotes}
              </AppText>
            ) : null}
          </View>

          {/* Receipt / rate / tip / report — Pack A/C/D/E */}
          <View style={styles.quickActionsRow}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Share order receipt"
              onPress={shareReceipt}
              style={styles.quickActionBtn}
            >
              <Ionicons name="share-outline" size={16} color={colors.text} />
              <AppText variant="caption">Receipt</AppText>
            </PressableScale>
            {order.status === 'delivered' ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Rate this order"
                onPress={() => setPanel(panel === 'rating' ? 'none' : 'rating')}
                style={styles.quickActionBtn}
              >
                <Ionicons name="star-outline" size={16} color={colors.text} />
                <AppText variant="caption">Rate</AppText>
              </PressableScale>
            ) : null}
            {order.paymentStatus === 'unpaid' && order.status !== 'cancelled' && order.status !== 'refused' ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Add or change tip"
                onPress={() => setPanel(panel === 'tip' ? 'none' : 'tip')}
                style={styles.quickActionBtn}
              >
                <Ionicons name="cash-outline" size={16} color={colors.text} />
                <AppText variant="caption">Tip</AppText>
              </PressableScale>
            ) : null}
            {order.status === 'delivered' ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Report a problem with this order"
                onPress={() => setPanel(panel === 'dispute' ? 'none' : 'dispute')}
                style={styles.quickActionBtn}
              >
                <Ionicons name="flag-outline" size={16} color={colors.text} />
                <AppText variant="caption">Report</AppText>
              </PressableScale>
            ) : null}
          </View>

          {panel === 'rating' && token ? (
            <View style={styles.panelWrap}>
              <RatingPanel
                token={token}
                orderId={order.id}
                onDone={() => {
                  setPanel('none');
                  onOrderChanged?.();
                }}
              />
            </View>
          ) : null}
          {panel === 'tip' && token ? (
            <View style={styles.panelWrap}>
              <TipPanel
                token={token}
                order={order}
                onDone={(updated) => {
                  setPanel('none');
                  onOrderChanged?.(updated);
                }}
              />
            </View>
          ) : null}
          {panel === 'dispute' && token ? (
            <View style={styles.panelWrap}>
              <DisputePanel
                token={token}
                orderId={order.id}
                onDone={() => {
                  setPanel('none');
                  onOrderChanged?.();
                }}
              />
            </View>
          ) : null}

          {/* Reorder */}
          {reorder.phase === 'none' ? (
            <AppText variant="caption" color={colors.textDim} center style={styles.reorderNote}>
              None of these meals are on the menu right now.
            </AppText>
          ) : reorder.phase === 'error' ? (
            <AppText variant="caption" color={colors.error} center style={styles.reorderNote}>
              {reorder.message}
            </AppText>
          ) : null}
          <Button
            label={reorder.phase === 'none' ? 'Browse the menu' : 'Reorder'}
            onPress={reorder.phase === 'none' ? () => { onClose(); pushPath(`/meals/${order.partnerId}`); } : doReorder}
            loading={reorder.phase === 'loading'}
            disabled={order.items.length === 0}
            accessibilityLabel={reorder.phase === 'none' ? 'Browse the partner menu' : 'Reorder these meals'}
            style={styles.reorderBtn}
          />
        </ScrollView>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  headerText: { flex: 1, gap: 2 },
  macroHero: {
    marginTop: spacing.lg,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  macroPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  macroTile: { flex: 1, alignItems: 'center', gap: 2 },
  macroNumber: { lineHeight: 44 },
  macroDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: colors.borderStrong, marginVertical: spacing.xs },
  macroSecondary: { marginTop: spacing.xs },
  sectionLabel: { marginTop: spacing.xl, marginBottom: spacing.sm },
  section: { gap: spacing.md },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  qtyBadge: {
    minWidth: 34,
    height: 30,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemMain: { flex: 1, gap: 1 },
  feeBlock: {
    marginTop: spacing.lg,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  feeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  paymentText: { gap: 2 },
  timeline: { gap: 0 },
  eventRow: { flexDirection: 'row', gap: spacing.md },
  eventRail: { width: 14, alignItems: 'center' },
  eventDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, marginTop: 3 },
  eventLine: { width: 2, flex: 1, minHeight: 20, marginVertical: 2 },
  eventText: { flex: 1, paddingBottom: spacing.md, gap: 1 },
  addressBlock: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  addressLine: { marginTop: 2 },
  quickActionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, flexWrap: 'wrap' },
  quickActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touch.min,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  panelWrap: {
    marginTop: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  reorderNote: { marginTop: spacing.lg },
  reorderBtn: { marginTop: spacing.md, marginBottom: spacing.sm },
});
