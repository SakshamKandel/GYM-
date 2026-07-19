import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { formatMoney } from '@gym/shared';
import {
  AppText,
  AppTextInput,
  Button,
  Card,
  Chip,
  ConfirmDialog,
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
import { useMealAddresses, useMealPartners, useMealQuote } from '../../features/meals/hooks';
import {
  createMealOrder,
  toMealsError,
  type MealAddress,
  type MealOrder,
  type MealPaymentMethod,
  type MealQuoteInput,
} from '../../features/meals/api';
import { AddressSheet } from '../../features/meals/components/AddressSheet';
import { deliveryStatus, DeliveryBadge } from '../../features/meals/components/DeliveryBadge';
import { ReceiptUploadPanel } from '../../features/meals/components/ReceiptUploadPanel';
import {
  isDigitalMethod,
  mealErrorMessage,
  mealUnavailableLineMessage,
  priceChangeMessage,
  slotLabel,
  tipOptions,
  tipPresetLabel,
  upcomingSlots,
} from '../../features/meals/logic';
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

  // Checkout gratuity preview (Pack D) — server-repriced on both quote and
  // create; a preset selection resets whenever the cart subtotal changes so a
  // stale absolute amount never survives a cart edit.
  const [tipMinor, setTipMinor] = useState(0);
  useEffect(() => {
    setTipMinor(0);
  }, [lines]);

  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placedOrder, setPlacedOrder] = useState<MealOrder | null>(null);
  // B9/B10/Pack F: a server re-price that disagrees with the shown quote at
  // submit time surfaces here instead of silently charging the new total.
  const [priceChange, setPriceChange] = useState<{ quotedMinor: number; currentMinor: number } | null>(null);
  const orderRequestIdRef = useRef<string | null>(null);

  // A failed request may have committed even when its response was lost. Keep
  // one key for retries of the unchanged checkout intent, but never reuse it
  // after the member changes any field that participates in the order payload.
  useEffect(() => {
    orderRequestIdRef.current = null;
    setPriceChange(null);
  }, [partnerId, lines, addressId, slot?.date, slot?.window, method, notes, tipMinor]);

  const items = Object.values(lines);
  const subtotal = cartSubtotalMinor(lines);
  const currency = partner?.currency ?? items[0]?.meal.currency ?? 'NPR';

  // Live server-priced fee breakdown (subtotal + delivery + small-order + total),
  // refreshed on any cart / address / slot change. `quoteStatus` gates the
  // Place order button so the member never commits against a stale total.
  const quoteInput: MealQuoteInput | null = useMemo(() => {
    if (!partnerId || items.length === 0 || !slot?.orderable) return null;
    return {
      partnerId,
      items: items.map((l) => ({ mealId: l.meal.id, qty: l.qty })),
      ...(addressId ? { addressId } : {}),
      window: slot.window,
      date: slot.date,
      tipMinor,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId, lines, addressId, slot?.date, slot?.window, slot?.orderable, tipMinor]);
  const {
    quote,
    status: quoteStatus,
    errorCode: quoteErrorCode,
    errorDetails: quoteErrorDetails,
  } = useMealQuote(token, quoteInput);
  // B11: a deleted/deactivated meal names the specific line instead of a bare
  // slot message.
  const quoteMealUnavailable =
    quoteStatus === 'error' && quoteErrorCode === 'meal_unavailable'
      ? mealUnavailableLineMessage((quoteErrorDetails?.mealName as string | null | undefined) ?? null)
      : null;

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replacePath('/meals');
  }

  function place(expectedTotalOverride?: number): void {
    if (placing || !token || !partnerId || !slot || !addressId || items.length === 0) return;
    // The shown total must be a fresh server quote before we let money move.
    if (quoteStatus !== 'ready' || !quote) return;
    setPlacing(true);
    setError(null);
    void (async () => {
      try {
        const requestId = orderRequestIdRef.current ?? randomUUID();
        orderRequestIdRef.current = requestId;
        const order = await createMealOrder(token, {
          requestId,
          partnerId,
          deliveryDate: slot.date,
          window: slot.window,
          addressId,
          items: items.map((l) => ({ mealId: l.meal.id, qty: l.qty })),
          paymentMethod: method,
          notes: notes.trim() || undefined,
          tipMinor,
          // B10/Pack F: what the member was just shown. A server re-price that
          // disagrees returns 409 price_changed WITHOUT charging.
          expectedTotalMinor: expectedTotalOverride ?? quote.totalMinor,
        });
        orderRequestIdRef.current = null;
        setPriceChange(null);
        successHaptic();
        clearCart();
        if (isDigitalMethod(order.paymentMethod)) {
          setPlacedOrder(order);
        } else {
          pushPath(`/meals/order-confirmation?orderId=${encodeURIComponent(order.id)}`);
        }
      } catch (err) {
        const apiError = toMealsError(err);
        if (apiError.code === 'price_changed') {
          const quotedMinor = Number(apiError.details?.quotedMinor ?? 0);
          const currentMinor = Number(apiError.details?.currentMinor ?? 0);
          setPriceChange({ quotedMinor, currentMinor });
          warnHaptic();
          return;
        }
        // A conflict is permanent for this key; mint a fresh key if the member
        // retries after the actionable error instead of trapping the checkout.
        if (apiError.code === 'idempotency_conflict') orderRequestIdRef.current = null;
        setError(mealErrorMessage(apiError.code));
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
            onDone={() => pushPath(`/meals/order-confirmation?orderId=${encodeURIComponent(placedOrder.id)}`)}
            onSkip={() => pushPath(`/meals/order-confirmation?orderId=${encodeURIComponent(placedOrder.id)}`)}
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

      <Animated.View entering={enterUp(4)} style={styles.section}>
        <SectionLabel>Add a tip (optional)</SectionLabel>
        <View style={styles.chipRow}>
          {tipOptions(quote?.subtotalMinor ?? subtotal).map((opt) => (
            <Chip
              key={opt.percent}
              label={
                opt.percent === 0
                  ? tipPresetLabel(0)
                  : `${tipPresetLabel(opt.percent)} (${formatMoney(opt.amountMinor, currency)})`
              }
              selected={tipMinor === opt.amountMinor}
              onPress={() => setTipMinor(opt.amountMinor)}
            />
          ))}
        </View>
      </Animated.View>

      <Animated.View entering={enterUp(5)}>
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
            <AppText variant="body" color={colors.textDim}>
              Subtotal
            </AppText>
            <AppText variant="body" tabular>
              {formatMoney(quote?.subtotalMinor ?? subtotal, currency)}
            </AppText>
          </View>
          {quote && quote.subtotalMinor !== subtotal ? (
            <AppText variant="caption" color={colors.warning}>
              Prices may have changed since you added these — the total above is the current, accurate one.
            </AppText>
          ) : null}
          <View style={styles.summaryLine}>
            <AppText variant="body" color={colors.textDim}>
              Delivery fee
            </AppText>
            <AppText variant="body" tabular>
              {quote
                ? quote.deliveryFeeMinor === 0
                  ? 'Free'
                  : formatMoney(quote.deliveryFeeMinor, currency)
                : '—'}
            </AppText>
          </View>
          {quote && quote.smallOrderFeeMinor > 0 ? (
            <View style={styles.summaryLine}>
              <AppText variant="body" color={colors.textDim}>
                Small-order fee
              </AppText>
              <AppText variant="body" tabular>
                {formatMoney(quote.smallOrderFeeMinor, currency)}
              </AppText>
            </View>
          ) : null}
          {quote && quote.tipMinor > 0 ? (
            <View style={styles.summaryLine}>
              <AppText variant="body" color={colors.textDim}>
                Tip
              </AppText>
              <AppText variant="body" tabular>
                {formatMoney(quote.tipMinor, currency)}
              </AppText>
            </View>
          ) : null}
          <View style={styles.summaryLine}>
            <AppText variant="bodyBold">Total</AppText>
            <AppText variant="bodyBold" tabular>
              {quote ? formatMoney(quote.totalMinor, currency) : '—'}
            </AppText>
          </View>
          {quoteStatus === 'loading' ? (
            <AppText variant="caption" color={colors.textDim}>
              Updating totals…
            </AppText>
          ) : quoteStatus === 'error' ? (
            <AppText variant="caption" color={colors.error}>
              {quoteMealUnavailable ?? "Couldn't calculate the total. Adjust your order or try again."}
            </AppText>
          ) : quote?.deliversTo === false ? (
            <AppText variant="caption" color={colors.warning}>
              This address is outside {partner?.name ?? "this partner's"} delivery area — the order may be
              refused.
            </AppText>
          ) : null}
        </Card>
      </Animated.View>

      {error ? (
        <AppText variant="caption" color={colors.error} style={styles.errorText}>
          {error}
        </AppText>
      ) : null}

      <Button
        label="Place order"
        onPress={() => place()}
        disabled={!token || !slot?.orderable || !addressId || items.length === 0 || quoteStatus !== 'ready'}
        loading={placing}
        style={{ marginTop: spacing.gutter }}
      />

      <ConfirmDialog
        visible={priceChange !== null}
        title="Price updated"
        message={priceChange ? priceChangeMessage(priceChange.quotedMinor, priceChange.currentMinor, currency) : undefined}
        confirmLabel="Confirm new price"
        cancelLabel="Review order"
        onConfirm={() => {
          if (priceChange) place(priceChange.currentMinor);
        }}
        onCancel={() => setPriceChange(null)}
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
