import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { formatMoney } from '@gym/shared';
import {
  AppText,
  Card,
  Chip,
  ConfirmDialog,
  EmptyState,
  enterDown,
  enterFade,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  Sheet,
  SkeletonRow,
  Tag,
} from '../../components/ui';
import { EmptyArt } from '../../components/visual';
import { warnHaptic } from '../../lib/haptics';
import { useAuth } from '../../state/auth';
import { useMyMealOrders } from '../../features/meals/hooks';
import { cancelMealOrder, toMealsError, type MealOrder } from '../../features/meals/api';
import { ReceiptUploadPanel } from '../../features/meals/components/ReceiptUploadPanel';
import {
  canMemberCancelOrder,
  mealErrorMessage,
  orderNeedsReceipt,
  orderStatusLabel,
  orderStatusTone,
  orderTimeline,
  paymentStatusLabel,
  slotLabel,
} from '../../features/meals/logic';
import { pushPath, replacePath } from '../../features/meals/nav';

/**
 * /meals/orders — "my orders" (plan §6/§7 P12): upcoming + history tabs, a
 * status timeline built from the order's own timestamps (there is no
 * member-facing `meal_order_events` read route — §3's engine only exposes
 * order rows), pre-cutoff cancel, and the receipt-submitted state with an
 * inline upload action for unpaid digital orders.
 */

const TONE_COLOR: Record<'accent' | 'success' | 'error' | 'dim', string> = {
  accent: colors.accent,
  success: colors.success,
  error: colors.error,
  dim: colors.textDim,
};

const styles = StyleSheet.create({
  backRow: { marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.md },
  tabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  list: { gap: spacing.md },
  card: { gap: spacing.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemLine: { flexDirection: 'row', justifyContent: 'space-between' },
  timeline: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
  timelineDot: { width: 7, height: 7, borderRadius: 4 },
  timelineBar: { flex: 1, height: 2 },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actionBtn: {
    flex: 1,
    minHeight: touch.min,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  actionBtnDanger: { borderWidth: 1.5, borderColor: colors.error, backgroundColor: 'transparent' },
  skeletons: { gap: spacing.md },
  skeletonRow: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, height: 96 },
  retryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: touch.min,
    marginBottom: spacing.md,
  },
  retryText: { flex: 1 },
});

function OrderTimelineRow({ order }: { order: MealOrder }) {
  if (order.status === 'cancelled' || order.status === 'refused') {
    return (
      <AppText variant="caption" color={colors.error}>
        {order.cancelReason || (order.status === 'refused' ? 'Delivery refused' : 'Cancelled')}
      </AppText>
    );
  }
  const steps = orderTimeline(order);
  return (
    <View>
      <View
        style={styles.timeline}
        accessibilityLabel={`Order status: ${steps.map((s) => s.label).join(' then ')}`}
      >
        {steps.map((step, i) => (
          <View
            key={step.key}
            style={{ flex: i === steps.length - 1 ? 0 : 1, flexDirection: 'row', alignItems: 'center' }}
          >
            <View style={[styles.timelineDot, { backgroundColor: colors.accent }]} />
            {i < steps.length - 1 ? <View style={[styles.timelineBar, { backgroundColor: colors.accent }]} /> : null}
          </View>
        ))}
      </View>
      <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
        {steps.map((s) => s.label).join(' → ')}
      </AppText>
    </View>
  );
}

function OrderCard({
  order,
  onCancel,
  onReceipt,
}: {
  order: MealOrder;
  onCancel: (order: MealOrder) => void;
  onReceipt: (order: MealOrder) => void;
}) {
  const tone = orderStatusTone(order.status);
  return (
    <Card style={styles.card}>
      <View style={styles.cardTop}>
        <AppText variant="bodyBold">{slotLabel(order.deliveryDate, order.window)}</AppText>
        <Tag label={orderStatusLabel(order.status)} variant="outline" color={TONE_COLOR[tone]} />
      </View>

      <OrderTimelineRow order={order} />

      {order.items.map((item) => (
        <View key={item.mealId} style={styles.itemLine}>
          <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
            {item.qty}× {item.name}
          </AppText>
        </View>
      ))}

      <View style={styles.itemLine}>
        <AppText variant="bodyBold">{formatMoney(order.totalMinor, order.currency)}</AppText>
        <AppText variant="caption" color={colors.textDim}>
          {paymentStatusLabel(order)}
        </AppText>
      </View>

      {canMemberCancelOrder(order) || orderNeedsReceipt(order) ? (
        <View style={styles.actionsRow}>
          {orderNeedsReceipt(order) ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Submit payment receipt"
              onPress={() => onReceipt(order)}
              style={styles.actionBtn}
            >
              <AppText variant="bodyBold">Submit receipt</AppText>
            </PressableScale>
          ) : null}
          {canMemberCancelOrder(order) ? (
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

export default function MyMealOrdersScreen() {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const [scope, setScope] = useState<'upcoming' | 'history'>('upcoming');
  const { data: orders, loading, error, retry, reload } = useMyMealOrders(status === 'signedIn' ? token : null, scope);

  const [pendingCancel, setPendingCancel] = useState<MealOrder | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [receiptOrder, setReceiptOrder] = useState<MealOrder | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replacePath('/meals');
  }

  function confirmCancel(): void {
    if (!pendingCancel || !token || cancelling) return;
    setCancelling(true);
    setActionError(null);
    void (async () => {
      try {
        await cancelMealOrder(token, pendingCancel.id);
        setPendingCancel(null);
        reload();
      } catch (err) {
        setActionError(mealErrorMessage(toMealsError(err).code));
        warnHaptic();
      } finally {
        setCancelling(false);
      }
    })();
  }

  return (
    <Screen scroll>
      <Animated.View entering={enterDown()} style={styles.backRow}>
        <PressableScale accessibilityRole="button" accessibilityLabel="Go back" onPress={goBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>

      <ScreenHeader eyebrow="Meals" title="My orders" style={styles.header} />

      {status !== 'signedIn' ? (
        <EmptyState
          icon="receipt-outline"
          title="Sign in to see your orders"
          actionLabel="Sign in"
          onAction={() => pushPath('/auth/sign-in')}
        />
      ) : (
        <>
          <Animated.View entering={enterUp(0)} style={styles.tabs}>
            <Chip label="Upcoming" selected={scope === 'upcoming'} onPress={() => setScope('upcoming')} />
            <Chip label="History" selected={scope === 'history'} onPress={() => setScope('history')} />
          </Animated.View>

          {error ? (
            <Animated.View entering={enterFade(0)}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Couldn't load your orders. Tap to retry."
                onPress={retry}
                style={styles.retryRow}
              >
                <Ionicons name="cloud-offline" size={14} color={colors.textDim} />
                <AppText variant="caption" style={styles.retryText}>
                  Couldn&apos;t load your orders — tap to retry.
                </AppText>
                <Ionicons name="refresh" size={15} color={colors.textDim} />
              </PressableScale>
            </Animated.View>
          ) : null}

          {loading ? (
            <Animated.View entering={enterFade(0)} style={styles.skeletons} accessibilityLabel="Loading orders">
              {Array.from({ length: 3 }, (_, i) => (
                <SkeletonRow key={i} style={styles.skeletonRow} />
              ))}
            </Animated.View>
          ) : orders !== null && orders.length === 0 ? (
            <Animated.View entering={enterUp(1)}>
              <EmptyState
                icon="receipt-outline"
                title={scope === 'upcoming' ? 'Nothing on the way' : 'No past orders'}
                body={scope === 'upcoming' ? 'Order from a partner to see it here.' : undefined}
                art={<EmptyArt variant="food" />}
                actionLabel={scope === 'upcoming' ? 'Browse partners' : undefined}
                onAction={scope === 'upcoming' ? () => pushPath('/meals') : undefined}
              />
            </Animated.View>
          ) : orders !== null ? (
            <Animated.View entering={enterUp(1)} style={styles.list}>
              {orders.map((o) => (
                <OrderCard key={o.id} order={o} onCancel={setPendingCancel} onReceipt={setReceiptOrder} />
              ))}
            </Animated.View>
          ) : null}
        </>
      )}

      <ConfirmDialog
        visible={pendingCancel !== null}
        title="Cancel order"
        message={
          actionError ??
          (pendingCancel ? `Cancel your ${slotLabel(pendingCancel.deliveryDate, pendingCancel.window)} order?` : undefined)
        }
        confirmLabel="Cancel order"
        cancelLabel="Keep it"
        danger
        onConfirm={confirmCancel}
        onCancel={() => {
          setPendingCancel(null);
          setActionError(null);
        }}
      />

      <Sheet visible={receiptOrder !== null} onClose={() => setReceiptOrder(null)} title="Payment receipt">
        {receiptOrder && token ? (
          <ReceiptUploadPanel
            token={token}
            order={receiptOrder}
            onDone={() => {
              setReceiptOrder(null);
              reload();
            }}
            onSkip={() => setReceiptOrder(null)}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}
