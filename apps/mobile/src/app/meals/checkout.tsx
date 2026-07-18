import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { formatMoney } from '@gym/shared';
import {
  AppText,
  AppTextInput,
  Button,
  Card,
  Chip,
  EmptyState,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  Sheet,
} from '../../components/ui';
import { successHaptic, warnHaptic } from '../../lib/haptics';
import { useAuth } from '../../state/auth';
import { cartSubtotalMinor, useMealCart } from '../../features/meals/cartStore';
import { useMealAddresses, useMealPartners } from '../../features/meals/hooks';
import {
  createMealOrder,
  toMealsError,
  type MealAddress,
  type MealOrder,
  type MealPaymentMethod,
} from '../../features/meals/api';
import { AddressSheet } from '../../features/meals/components/AddressSheet';
import { deliveryStatus, DeliveryBadge } from '../../features/meals/components/DeliveryBadge';
import { ReceiptUploadPanel } from '../../features/meals/components/ReceiptUploadPanel';
import { isDigitalMethod, mealErrorMessage, slotLabel, upcomingSlots } from '../../features/meals/logic';
import { pushPath, replacePath } from '../../features/meals/nav';

/**
 * /meals/checkout — one-time order flow (plan §6): slot picker gated by the
 * live cutoff, saved-address select (CRUD via AddressSheet), COD or
 * eSewa/Khalti-with-receipt payment. Reads the in-memory cart built on the
 * menu screen; the server re-prices and re-freezes everything on submit
 * (invariant §8a) — this screen only assembles the request.
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
  header: { marginBottom: spacing.md },
  section: { gap: spacing.sm, marginBottom: spacing.gutter },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: touch.min,
  },
  addressMain: { flex: 1, gap: 2 },
  deliveryBadgeRow: { flexDirection: 'row', marginTop: spacing.xs },
  summaryCard: { gap: spacing.sm },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between' },
  errorText: { marginTop: spacing.sm },
});

function SectionLabel({ children }: { children: string }) {
  return (
    <AppText variant="label" color={colors.textDim}>
      {children}
    </AppText>
  );
}

export default function CheckoutScreen() {
  const token = useAuth((s) => s.token);
  const partnerId = useMealCart((s) => s.partnerId);
  const lines = useMealCart((s) => s.lines);
  const clearCart = useMealCart((s) => s.clear);

  const { data: partners } = useMealPartners(token);
  const partner = partners?.find((p) => p.id === partnerId) ?? null;

  const slots = useMemo(() => upcomingSlots(new Date(), 6), []);
  const [slotIdx, setSlotIdx] = useState(0);
  const slot = slots[slotIdx] ?? slots[0];

  const { data: addresses, reload: reloadAddresses } = useMealAddresses(token);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [addressSheetOpen, setAddressSheetOpen] = useState(false);
  useEffect(() => {
    if (!addresses) return;
    // Re-validate on every address-list change, not just when addressId is
    // unset — otherwise deleting the currently-selected address (e.g. via the
    // AddressSheet trash icon) leaves a stale, now-nonexistent id selected.
    if (addressId && addresses.some((a) => a.id === addressId)) return;
    setAddressId(addresses.length > 0 ? (addresses.find((a) => a.isDefault)?.id ?? addresses[0].id) : null);
  }, [addresses, addressId]);
  const selectedAddress: MealAddress | null = addresses?.find((a) => a.id === addressId) ?? null;
  // Client-side courtesy only — the server is the sole authority on whether
  // an order is actually accepted (DeliveryBadge doc comment).
  const deliveryState = useMemo(
    () =>
      partner && selectedAddress
        ? deliveryStatus(partner, { lat: selectedAddress.lat, lng: selectedAddress.lng }, selectedAddress.area)
        : 'unknown',
    [partner, selectedAddress],
  );

  const [method, setMethod] = useState<MealPaymentMethod>('cod');
  useEffect(() => {
    if (partner && !partner.acceptsCod && method === 'cod') setMethod('esewa');
  }, [partner, method]);
  const [notes, setNotes] = useState('');

  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placedOrder, setPlacedOrder] = useState<MealOrder | null>(null);

  const items = Object.values(lines);
  const subtotal = cartSubtotalMinor(lines);
  const currency = partner?.currency ?? items[0]?.meal.currency ?? 'NPR';

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replacePath('/meals');
  }

  function place(): void {
    if (placing || !token || !partnerId || !slot || !addressId || items.length === 0) return;
    setPlacing(true);
    setError(null);
    void (async () => {
      try {
        const order = await createMealOrder(token, {
          partnerId,
          deliveryDate: slot.date,
          window: slot.window,
          addressId,
          items: items.map((l) => ({ mealId: l.meal.id, qty: l.qty })),
          paymentMethod: method,
          notes: notes.trim() || undefined,
        });
        successHaptic();
        clearCart();
        if (isDigitalMethod(order.paymentMethod)) {
          setPlacedOrder(order);
        } else {
          pushPath('/meals/orders');
        }
      } catch (err) {
        setError(mealErrorMessage(toMealsError(err).code));
        warnHaptic();
      } finally {
        setPlacing(false);
      }
    })();
  }

  if (items.length === 0 && !placedOrder) {
    return (
      <Screen scroll>
        <Animated.View entering={enterDown()} style={styles.backRow}>
          <PressableScale accessibilityRole="button" accessibilityLabel="Go back" onPress={goBack} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </PressableScale>
        </Animated.View>
        <EmptyState
          icon="cart-outline"
          title="Your cart is empty"
          body="Add a meal from the menu to check out."
          actionLabel="Browse menu"
          onAction={() => (partnerId ? pushPath(`/meals/${partnerId}`) : pushPath('/meals'))}
        />
      </Screen>
    );
  }

  if (placedOrder && token) {
    return (
      <Screen scroll>
        <ScreenHeader eyebrow="Order placed" title="Almost done" style={styles.header} />
        <Card style={styles.summaryCard}>
          <ReceiptUploadPanel
            token={token}
            order={placedOrder}
            onDone={() => pushPath('/meals/orders')}
            onSkip={() => pushPath('/meals/orders')}
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Animated.View entering={enterDown()} style={styles.backRow}>
        <PressableScale accessibilityRole="button" accessibilityLabel="Go back" onPress={goBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>

      <ScreenHeader eyebrow="Review order" title="Checkout" style={styles.header} />

      <Animated.View entering={enterUp(0)} style={styles.section}>
        <SectionLabel>Delivery slot</SectionLabel>
        <View style={styles.chipRow}>
          {slots.map((s, i) => (
            <Chip
              key={`${s.date}-${s.window}`}
              label={slotLabel(s.date, s.window)}
              selected={slotIdx === i}
              onPress={() => s.orderable && setSlotIdx(i)}
            />
          ))}
        </View>
        {!slot?.orderable ? (
          <AppText variant="caption" color={colors.error}>
            That slot has passed its cutoff — pick another.
          </AppText>
        ) : null}
      </Animated.View>

      <Animated.View entering={enterUp(1)} style={styles.section}>
        <SectionLabel>Deliver to</SectionLabel>
        {selectedAddress ? (
          <>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Delivering to ${selectedAddress.line}. Tap to change`}
              onPress={() => setAddressSheetOpen(true)}
              style={styles.addressRow}
            >
              <Ionicons name="location-outline" size={20} color={colors.textDim} />
              <View style={styles.addressMain}>
                <AppText variant="bodyBold" numberOfLines={1}>
                  {selectedAddress.label || selectedAddress.line}
                </AppText>
                <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
                  {[selectedAddress.line, selectedAddress.area].filter(Boolean).join(', ')}
                </AppText>
              </View>
              <AppText variant="caption" color={colors.accent}>
                Change
              </AppText>
            </PressableScale>
            {deliveryState !== 'unknown' ? (
              <View style={styles.deliveryBadgeRow}>
                <DeliveryBadge status={deliveryState} />
              </View>
            ) : null}
            {deliveryState === 'out' ? (
              <AppText variant="caption" color={colors.warning}>
                This address looks outside {partner?.name ?? "this partner's"} usual delivery area — the order
                may be refused. Double-check before paying.
              </AppText>
            ) : null}
          </>
        ) : (
          <Button label="Add a delivery address" variant="secondary" onPress={() => setAddressSheetOpen(true)} />
        )}
      </Animated.View>

      <Animated.View entering={enterUp(2)} style={styles.section}>
        <SectionLabel>Pay with</SectionLabel>
        <View style={styles.chipRow}>
          {partner?.acceptsCod !== false ? (
            <Chip label="Cash on delivery" selected={method === 'cod'} onPress={() => setMethod('cod')} />
          ) : null}
          <Chip label="eSewa" selected={method === 'esewa'} onPress={() => setMethod('esewa')} />
          <Chip label="Khalti" selected={method === 'khalti'} onPress={() => setMethod('khalti')} />
        </View>
      </Animated.View>

      <Animated.View entering={enterUp(3)} style={styles.section}>
        <SectionLabel>Delivery notes (optional)</SectionLabel>
        <AppTextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Gate code, landmark, etc."
          accessibilityLabel="Delivery notes"
          multiline
        />
      </Animated.View>

      <Animated.View entering={enterUp(4)}>
        <Card style={styles.summaryCard}>
          {items.map((l) => (
            <View key={l.meal.id} style={styles.summaryLine}>
              <AppText variant="body" numberOfLines={1}>
                {l.qty}× {l.meal.name}
              </AppText>
              <AppText variant="body" tabular>
                {formatMoney(l.meal.priceMinor * l.qty, l.meal.currency)}
              </AppText>
            </View>
          ))}
          <View style={styles.summaryLine}>
            <AppText variant="bodyBold">Subtotal</AppText>
            <AppText variant="bodyBold" tabular>
              {formatMoney(subtotal, currency)}
            </AppText>
          </View>
          <AppText variant="caption" color={colors.textDim}>
            Delivery + small-order fees are calculated at checkout.
          </AppText>
        </Card>
      </Animated.View>

      {error ? (
        <AppText variant="caption" color={colors.error} style={styles.errorText}>
          {error}
        </AppText>
      ) : null}

      <Button
        label="Place order"
        onPress={place}
        disabled={!token || !slot?.orderable || !addressId || items.length === 0}
        loading={placing}
        style={{ marginTop: spacing.gutter }}
      />

      <Sheet visible={addressSheetOpen} onClose={() => setAddressSheetOpen(false)} title="Delivery address">
        {token ? (
          <AddressSheet
            token={token}
            addresses={addresses ?? []}
            selectedId={addressId}
            onSelect={(a) => {
              setAddressId(a.id);
              setAddressSheetOpen(false);
            }}
            onChanged={reloadAddresses}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}
