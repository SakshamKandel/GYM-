import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { formatMoney, ktmAddDays, ktmDateString } from '@gym/shared';
import {
  AppText,
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
import { useMealAddresses, useMealMenu, useMealPartners } from '../../features/meals/hooks';
import { createMealSubscription, toMealsError, type MealAddress, type MealPaymentMethod, type MealPlanType, type MealWindow } from '../../features/meals/api';
import { AddressSheet } from '../../features/meals/components/AddressSheet';
import { mealErrorMessage, paymentMethodLabel, weekdayLabel, WEEKDAY_OPTIONS, windowLabel } from '../../features/meals/logic';
import { pushPath, replacePath } from '../../features/meals/nav';

/**
 * /meals/subscribe?partnerId= — recurring plan setup (plan §6: "days-of-week,
 * fixed meal or rotating, start date, price/day, prepaid cycle explainer").
 * `pricePerDayMinor` is entirely server-computed on submit (invariant §8a) —
 * this screen only collects the plan's shape.
 */

const START_OPTIONS = ['today', 'tomorrow'] as const;

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
  explainer: { gap: spacing.xs },
  errorText: { marginTop: spacing.sm },
});

function SectionLabel({ children }: { children: string }) {
  return (
    <AppText variant="label" color={colors.textDim}>
      {children}
    </AppText>
  );
}

export default function SubscribeScreen() {
  const { partnerId } = useLocalSearchParams<{ partnerId: string }>();
  const token = useAuth((s) => s.token);

  const { data: partners } = useMealPartners(token);
  const partner = partners?.find((p) => p.id === partnerId) ?? null;

  const [window, setWindow] = useState<MealWindow>('lunch');
  const { data: menu } = useMealMenu(token, partnerId ?? null, { window });

  const [days, setDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]));
  const [planType, setPlanType] = useState<MealPlanType>('partner_rotating');
  const [mealId, setMealId] = useState<string | null>(null);
  const [startOption, setStartOption] = useState<(typeof START_OPTIONS)[number]>('tomorrow');

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

  const [method, setMethod] = useState<MealPaymentMethod>('cod');
  useEffect(() => {
    if (partner && !partner.acceptsCod && method === 'cod') setMethod('esewa');
  }, [partner, method]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDay(d: number): void {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replacePath(partnerId ? `/meals/${partnerId}` : '/meals');
  }

  const startDate =
    startOption === 'today' ? ktmDateString(new Date()) : ktmAddDays(ktmDateString(new Date()), 1);
  const chosenMeal = menu?.find((m) => m.id === mealId) ?? null;

  const canSubmit =
    !!token &&
    !!partnerId &&
    days.size > 0 &&
    !!addressId &&
    (planType === 'partner_rotating' || !!mealId);

  function submit(): void {
    if (submitting || !canSubmit || !token || !partnerId || !addressId) return;
    setSubmitting(true);
    setError(null);
    void (async () => {
      try {
        await createMealSubscription(token, {
          partnerId,
          daysOfWeek: Array.from(days).sort((a, b) => a - b),
          window,
          planType,
          mealId: planType === 'fixed_meal' ? (mealId ?? undefined) : undefined,
          addressId,
          paymentMethod: method,
          startDate,
        });
        successHaptic();
        pushPath('/meals/subscriptions');
      } catch (err) {
        setError(mealErrorMessage(toMealsError(err).code));
        warnHaptic();
      } finally {
        setSubmitting(false);
      }
    })();
  }

  if (!partnerId) {
    return (
      <Screen scroll>
        <EmptyState icon="repeat-outline" title="No partner selected" body="Open a menu first to set up a plan." />
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

      <ScreenHeader eyebrow={partner?.name ?? 'Weekly plan'} title="Set up your plan" style={styles.header} />

      <Animated.View entering={enterUp(0)} style={styles.section}>
        <SectionLabel>Delivery days</SectionLabel>
        <View style={styles.chipRow}>
          {WEEKDAY_OPTIONS.map((d) => (
            <Chip key={d} label={weekdayLabel(d)} selected={days.has(d)} onPress={() => toggleDay(d)} />
          ))}
        </View>
      </Animated.View>

      <Animated.View entering={enterUp(1)} style={styles.section}>
        <SectionLabel>Window</SectionLabel>
        <View style={styles.chipRow}>
          <Chip label={windowLabel('lunch')} selected={window === 'lunch'} onPress={() => setWindow('lunch')} />
          <Chip label={windowLabel('dinner')} selected={window === 'dinner'} onPress={() => setWindow('dinner')} />
        </View>
      </Animated.View>

      <Animated.View entering={enterUp(2)} style={styles.section}>
        <SectionLabel>Meal plan</SectionLabel>
        <View style={styles.chipRow}>
          <Chip
            label="Chef's rotation"
            selected={planType === 'partner_rotating'}
            onPress={() => setPlanType('partner_rotating')}
          />
          <Chip
            label="Pick one meal"
            selected={planType === 'fixed_meal'}
            onPress={() => setPlanType('fixed_meal')}
          />
        </View>
        {planType === 'fixed_meal' ? (
          <View style={styles.chipRow}>
            {(menu ?? []).map((m) => (
              <Chip key={m.id} label={m.name} selected={mealId === m.id} onPress={() => setMealId(m.id)} />
            ))}
          </View>
        ) : null}
      </Animated.View>

      <Animated.View entering={enterUp(3)} style={styles.section}>
        <SectionLabel>Start date</SectionLabel>
        <View style={styles.chipRow}>
          <Chip label="Tomorrow" selected={startOption === 'tomorrow'} onPress={() => setStartOption('tomorrow')} />
          <Chip label="Today" selected={startOption === 'today'} onPress={() => setStartOption('today')} />
        </View>
      </Animated.View>

      <Animated.View entering={enterUp(4)} style={styles.section}>
        <SectionLabel>Deliver to</SectionLabel>
        {selectedAddress ? (
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
        ) : (
          <Button label="Add a delivery address" variant="secondary" onPress={() => setAddressSheetOpen(true)} />
        )}
      </Animated.View>

      <Animated.View entering={enterUp(5)} style={styles.section}>
        <SectionLabel>Pay with</SectionLabel>
        <View style={styles.chipRow}>
          {partner?.acceptsCod !== false ? (
            <Chip label="Cash on delivery" selected={method === 'cod'} onPress={() => setMethod('cod')} />
          ) : null}
          <Chip label="eSewa" selected={method === 'esewa'} onPress={() => setMethod('esewa')} />
          <Chip label="Khalti" selected={method === 'khalti'} onPress={() => setMethod('khalti')} />
        </View>
      </Animated.View>

      <Animated.View entering={enterUp(6)}>
        <Card style={styles.explainer}>
          <AppText variant="bodyBold">Prepaid weekly billing</AppText>
          <AppText variant="caption" color={colors.textDim}>
            Each week is billed in advance — you&apos;ll get a bill for the coming week&apos;s deliveries once the
            current one closes, payable the same way as above ({paymentMethodLabel(method)}). Deliveries pause
            automatically if a week isn&apos;t paid by its cutoff.
          </AppText>
          {chosenMeal ? (
            <AppText variant="caption" color={colors.textDim}>
              {chosenMeal.name} · {formatMoney(chosenMeal.priceMinor, chosenMeal.currency)}/day + delivery
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
        label="Start plan"
        onPress={submit}
        disabled={!canSubmit}
        loading={submitting}
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
