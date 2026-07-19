import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
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
} from '../../components/ui';
import { EmptyArt } from '../../components/visual';
import { warnHaptic } from '../../lib/haptics';
import { useAuth } from '../../state/auth';
import { useMealPartners, useMyMealOrders } from '../../features/meals/hooks';
import { cancelMealOrder, toMealsError, type MealOrder } from '../../features/meals/api';
import { ReceiptUploadPanel } from '../../features/meals/components/ReceiptUploadPanel';
import { LiveOrderCard } from '../../features/meals/components/LiveOrderCard';
import { OrderHistoryCard } from '../../features/meals/components/OrderHistoryCard';
import { OrderDetailSheet } from '../../features/meals/components/OrderDetailSheet';
import { dayGroupLabel } from '../../features/meals/components/orderView';
import { mealErrorMessage, slotLabel } from '../../features/meals/logic';
import { pushPath, replacePath } from '../../features/meals/nav';

/**
 * /meals/orders — the member's order tracker (plan §6/§7 P12). Redesigned as a
 * live tracker rather than a list: non-terminal orders surface as bold
 * status-stepper cards up top, past orders group by delivery date below and
 * open a full detail sheet (macros, fees, timeline, address, reorder). The
 * upcoming/history split comes from two GETs against ?scope — the server keeps
 * `upcoming` = not-yet-terminal and `history` = delivered/cancelled/refused.
 */

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
  header: { marginBottom: spacing.lg },
  sectionLabel: { marginTop: spacing.xl, marginBottom: spacing.md },
  firstSectionLabel: { marginTop: spacing.xs, marginBottom: spacing.md },
  list: { gap: spacing.md },
  groupLabel: { marginTop: spacing.md, marginBottom: spacing.sm },
  historyList: { gap: spacing.sm },
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
  reorderPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: touch.min,
    marginTop: spacing.xs,
  },
  reorderPromptText: { flex: 1 },
});

/** Group orders by delivery date, preserving the server's ordering. */
function groupByDate(orders: MealOrder[]): { date: string; orders: MealOrder[] }[] {
  const groups: { date: string; orders: MealOrder[] }[] = [];
  const index = new Map<string, MealOrder[]>();
  for (const order of orders) {
    let bucket = index.get(order.deliveryDate);
    if (!bucket) {
      bucket = [];
      index.set(order.deliveryDate, bucket);
      groups.push({ date: order.deliveryDate, orders: bucket });
    }
    bucket.push(order);
  }
  return groups;
}

export default function MyMealOrdersScreen() {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const authed = status === 'signedIn' ? token : null;

  const live = useMyMealOrders(authed, 'upcoming');
  const past = useMyMealOrders(authed, 'history');
  const partners = useMealPartners(authed);

  const partnerName = useCallback(
    (id: string): string | undefined => partners.data?.find((p) => p.id === id)?.name,
    [partners.data],
  );

  const [pendingCancel, setPendingCancel] = useState<MealOrder | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [receiptOrder, setReceiptOrder] = useState<MealOrder | null>(null);
  const [detailOrder, setDetailOrder] = useState<MealOrder | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  useEffect(() => {
    if (refreshingRef.current) {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [live.data, live.error, past.data, past.error]);

  function reloadAll(): void {
    live.reload();
    past.reload();
    partners.reload();
  }

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
        live.reload();
        past.reload();
      } catch (err) {
        setActionError(mealErrorMessage(toMealsError(err).code));
        warnHaptic();
      } finally {
        setCancelling(false);
      }
    })();
  }

  const liveOrders = live.data ?? [];
  const pastOrders = past.data ?? [];
  const anyLoading = live.loading || past.loading;
  const nothingYet = live.data === null && past.data === null;
  const bothEmpty = live.data !== null && past.data !== null && liveOrders.length === 0 && pastOrders.length === 0;
  const anyError = live.error || past.error;

  return (
    <Screen
      scroll
      refreshControl={
        authed ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              refreshingRef.current = true;
              setRefreshing(true);
              reloadAll();
            }}
            tintColor={colors.textDim}
          />
        ) : undefined
      }
    >
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
          {anyError ? (
            <Animated.View entering={enterFade(0)}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Couldn't load your orders. Tap to retry."
                onPress={() => {
                  if (live.error) live.retry();
                  if (past.error) past.retry();
                }}
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

          {anyLoading && nothingYet ? (
            <Animated.View entering={enterFade(0)} style={styles.skeletons} accessibilityLabel="Loading orders">
              {Array.from({ length: 3 }, (_, i) => (
                <SkeletonRow key={i} style={styles.skeletonRow} />
              ))}
            </Animated.View>
          ) : bothEmpty ? (
            <Animated.View entering={enterUp(1)}>
              <EmptyState
                icon="receipt-outline"
                title="No orders yet"
                body="Fresh, macro-tracked meals delivered on your schedule. Order from a partner to start tracking here."
                art={<EmptyArt variant="food" />}
                actionLabel="Browse partners"
                onAction={() => pushPath('/meals')}
              />
            </Animated.View>
          ) : (
            <>
              {liveOrders.length > 0 ? (
                <Animated.View entering={enterUp(0)}>
                  <AppText variant="label" style={styles.firstSectionLabel}>
                    On the way
                  </AppText>
                  <View style={styles.list}>
                    {liveOrders.map((o) => (
                      <LiveOrderCard
                        key={o.id}
                        order={o}
                        partnerName={partnerName(o.partnerId)}
                        onOpenDetail={setDetailOrder}
                        onCancel={setPendingCancel}
                        onReceipt={setReceiptOrder}
                      />
                    ))}
                  </View>
                </Animated.View>
              ) : pastOrders.length > 0 ? (
                <Animated.View entering={enterUp(0)}>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="Nothing on the way. Browse partners to order."
                    onPress={() => pushPath('/meals')}
                    style={styles.reorderPrompt}
                  >
                    <Ionicons name="restaurant" size={20} color={colors.accent} />
                    <View style={styles.reorderPromptText}>
                      <AppText variant="bodyBold">Nothing on the way</AppText>
                      <AppText variant="caption" color={colors.textDim}>
                        Browse partners to line up your next meal
                      </AppText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
                  </PressableScale>
                </Animated.View>
              ) : null}

              {pastOrders.length > 0 ? (
                <Animated.View entering={enterUp(1)}>
                  <AppText
                    variant="label"
                    style={liveOrders.length > 0 ? styles.sectionLabel : styles.firstSectionLabel}
                  >
                    History
                  </AppText>
                  {groupByDate(pastOrders).map((group) => (
                    <View key={group.date}>
                      <AppText variant="caption" color={colors.textFaint} style={styles.groupLabel}>
                        {dayGroupLabel(group.date)}
                      </AppText>
                      <View style={styles.historyList}>
                        {group.orders.map((o) => (
                          <OrderHistoryCard
                            key={o.id}
                            order={o}
                            partnerName={partnerName(o.partnerId)}
                            onOpen={setDetailOrder}
                          />
                        ))}
                      </View>
                    </View>
                  ))}
                </Animated.View>
              ) : null}
            </>
          )}
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
              live.reload();
            }}
            onSkip={() => setReceiptOrder(null)}
          />
        ) : null}
      </Sheet>

      <OrderDetailSheet
        order={detailOrder}
        token={token}
        partnerName={detailOrder ? partnerName(detailOrder.partnerId) : undefined}
        onClose={() => setDetailOrder(null)}
      />
    </Screen>
  );
}
