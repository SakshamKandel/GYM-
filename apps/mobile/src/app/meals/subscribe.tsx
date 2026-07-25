import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
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
import { useMealAddresses, useMealMenu, useMealPartners, useMealPlanQuote } from '../../features/meals/hooks';
import {
  createMealSubscription,
  mealsPayee,
  toMealsError,
  type MealAddress,
  type MealPaymentMethod,
  type MealPlanQuoteInput,
  type MealPlanType,
  type MealWindow,
} from '../../features/meals/api';
import { supportsRail } from '../../lib/api/payeeLogic';
import { PayeeDetailsCard } from '../../components/payments/PayeeDetailsCard';
import { AddressSheet } from '../../features/meals/components/AddressSheet';
import {
  mealErrorMessage,
  paymentMethodLabel,
  weekdayLabel,
  weeklyPlanTotalMinor,
  WEEKDAY_OPTIONS,
  windowLabel,
} from '../../features/meals/logic';
import { replacePath } from '../../features/meals/nav';

/**
 * /meals/subscribe?partnerId= — recurring plan setup (plan §6: "days-of-week,
 * fixed meal or rotating, start date, price/day, prepaid cycle explainer").
 * `pricePerDayMinor` is entirely server-computed on submit (invariant §8a) —
 * this screen only collects the plan's shape.
 *
 * Payment honesty, same rule as checkout: eSewa and Khalti are offered ONLY
 * when the operator has published a wallet for them, and the chosen one is
 * named right here. A weekly plan bills every week on the rail picked in this
 * form, so starting one on a rail with no destination would leave the member
 * with a bill they can never pay. The wallet arrives on the partners response
 * this screen already loads (features/meals/api.ts), so nothing is fetched
 * twice.
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
  priceCard: { gap: spacing.sm, marginTop: spacing.md },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  priceValue: {
    fontFamily: type.display,
    fontSize: 26,
    color: colors.text,
    letterSpacing: 0.5,
  },
  errorText: { marginTop: spacing.sm },
  menuNote: { paddingVertical: spacing.sm },
  retryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: touch.min,
  },
  retryText: { flex: 1 },
});

function SectionLabel({ children }: { children: string }) {
  return (
    <AppText variant="label" color={colors.textDim}>
      {children}
    </AppText>
  );
}

function BackRow({ onPress }: { onPress: () => void }) {
  return (
    <Animated.View entering={enterDown()} style={styles.backRow}>
      <PressableScale accessibilityRole="button" accessibilityLabel="Go back" onPress={onPress} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </PressableScale>
    </Animated.View>
  );
}

export default function SubscribeScreen() {
  const { partnerId } = useLocalSearchParams<{ partnerId: string }>();
  const token = useAuth((s) => s.token);

  const { data: partners, loading: partnersLoading } = useMealPartners(token);
  const partner = partners?.find((p) => p.id === partnerId) ?? null;

  const [window, setWindow] = useState<MealWindow>('lunch');
  const {
    data: menu,
    loading: menuLoading,
    error: menuError,
    retry: retryMenu,
  } = useMealMenu(token, partnerId ?? null, { window });

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

  // Which rails can actually take this plan's weekly money. A wallet with no
  // published id is not offered at all: the member would have nowhere to send
  // the transfer every bill then asks them to prove.
  const payee = mealsPayee(partners);
  const codAvailable = partner?.acceptsCod !== false;
  const esewaAvailable = supportsRail(payee, 'esewa');
  const khaltiAvailable = supportsRail(payee, 'khalti');
  const anyMethodAvailable = codAvailable || esewaAvailable || khaltiAvailable;

  const [method, setMethod] = useState<MealPaymentMethod>('cod');
  const methodAvailable =
    method === 'cod' ? codAvailable : method === 'esewa' ? esewaAvailable : khaltiAvailable;
  // Move off a method this kitchen or this payee can't take, rather than
  // letting the member start a recurring plan against it. Nothing to move to =
  // no payment method at all, which the section below states plainly.
  useEffect(() => {
    if (partnersLoading || methodAvailable) return;
    const next: MealPaymentMethod | null = codAvailable
      ? 'cod'
      : esewaAvailable
        ? 'esewa'
        : khaltiAvailable
          ? 'khalti'
          : null;
    if (next && next !== method) setMethod(next);
  }, [partnersLoading, methodAvailable, codAvailable, esewaAvailable, khaltiAvailable, method]);

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

  // What this plan actually costs, priced by the server before anything is
  // created (the create call re-runs the same quote, so this is the real
  // number). Until this existed, a member started a recurring charge without
  // ever being shown a price.
  const planQuoteInput: MealPlanQuoteInput | null = useMemo(() => {
    if (!partnerId || !addressId || days.size === 0) return null;
    if (planType === 'fixed_meal' && !mealId) return null;
    return {
      partnerId,
      daysOfWeek: Array.from(days).sort((a, b) => a - b),
      window,
      planType,
      mealId: planType === 'fixed_meal' ? mealId : null,
      addressId,
      paymentMethod: method,
    };
  }, [partnerId, addressId, days, planType, mealId, window, method]);
  const {
    quote: planQuote,
    status: planQuoteStatus,
    errorCode: planQuoteErrorCode,
  } = useMealPlanQuote(token, planQuoteInput);
  const weeklyTotalMinor = planQuote ? weeklyPlanTotalMinor(planQuote.pricePerDayMinor, days.size) : null;

  const canSubmit =
    !!token &&
    !!partnerId &&
    days.size > 0 &&
    !!addressId &&
    (planType === 'partner_rotating' || !!mealId) &&
    methodAvailable;

  function submit(): void {
    if (submitting || !canSubmit || !token || !partnerId || !addressId) return;
    // Never start a weekly plan on a rail that can't take the money.
    if (!methodAvailable) return;
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
        // Replace, not push: the plan is created, so Android back must never
        // reopen this (now spent) form.
        replacePath('/meals/subscriptions');
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
        <BackRow onPress={goBack} />
        <EmptyState
          icon="repeat-outline"
          title="No partner selected"
          body="Open a menu first to set up a meal plan."
          actionLabel="Browse partners"
          onAction={() => replacePath('/meals')}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <BackRow onPress={goBack} />

      <ScreenHeader eyebrow={partner?.name ?? 'Weekly meal plan'} title="Set up your meal plan" style={styles.header} />

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
          menuLoading ? (
            <AppText variant="caption" color={colors.textDim} style={styles.menuNote}>
              Loading meals…
            </AppText>
          ) : menuError ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Couldn't load meals. Tap to retry."
              onPress={retryMenu}
              style={styles.retryRow}
            >
              <Ionicons name="cloud-offline" size={14} color={colors.textDim} />
              <AppText variant="caption" color={colors.textDim} style={styles.retryText}>
                Couldn&apos;t load meals. Tap to retry.
              </AppText>
              <Ionicons name="refresh" size={15} color={colors.textDim} />
            </PressableScale>
          ) : (menu ?? []).length === 0 ? (
            <AppText variant="caption" color={colors.textDim} style={styles.menuNote}>
              No meals available for this window.
            </AppText>
          ) : (
            <View style={styles.chipRow}>
              {(menu ?? []).map((m) => (
                <Chip key={m.id} label={m.name} selected={mealId === m.id} onPress={() => setMealId(m.id)} />
              ))}
            </View>
          )
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
          {codAvailable ? (
            <Chip label="Cash on delivery" selected={method === 'cod'} onPress={() => setMethod('cod')} />
          ) : null}
          {esewaAvailable ? (
            <Chip label="eSewa" selected={method === 'esewa'} onPress={() => setMethod('esewa')} />
          ) : null}
          {khaltiAvailable ? (
            <Chip label="Khalti" selected={method === 'khalti'} onPress={() => setMethod('khalti')} />
          ) : null}
        </View>
        {partnersLoading && !anyMethodAvailable ? (
          <AppText variant="caption" color={colors.textDim}>
            Checking how you can pay…
          </AppText>
        ) : null}
        {!partnersLoading && !anyMethodAvailable ? (
          <AppText variant="body" color={colors.warning}>
            We can&apos;t take payment for a meal plan in the app yet. Please check back soon.
          </AppText>
        ) : null}
        {/* The wallet, right where the choice is made. Every weekly bill goes
            to these details, so the member sees them before starting. */}
        {payee && method !== 'cod' && methodAvailable ? (
          <PayeeDetailsCard payee={payee} rails={[method]} />
        ) : null}
      </Animated.View>

      <Animated.View entering={enterUp(6)}>
        <Card style={styles.explainer}>
          <AppText variant="bodyBold">Prepaid weekly billing</AppText>
          <AppText variant="caption" color={colors.textDim}>
            Each week is billed in advance. You&apos;ll get a bill for the coming week&apos;s deliveries once the
            current one closes. Deliveries pause automatically if a week isn&apos;t paid by its cutoff.
          </AppText>
          {/* Only names a way to pay while there is one. Saying "payable the
              same way as above" when no rail is on offer would promise a
              settlement route the member does not have. */}
          {methodAvailable ? (
            <AppText variant="caption" color={colors.textDim}>
              Every bill is paid the way you picked above: {paymentMethodLabel(method)}.
            </AppText>
          ) : null}
          {chosenMeal ? (
            <AppText variant="caption" color={colors.textDim}>
              Your meal each day: {chosenMeal.name}
            </AppText>
          ) : null}
        </Card>
      </Animated.View>

      <Animated.View entering={enterUp(7)}>
        <Card style={styles.priceCard}>
          <View style={styles.priceRow}>
            <AppText variant="label" color={colors.textDim}>
              Price per day
            </AppText>
            <AppText style={styles.priceValue} tabular>
              {planQuote ? formatMoney(planQuote.pricePerDayMinor, planQuote.currency) : '—'}
            </AppText>
          </View>
          <View style={styles.priceRow}>
            <AppText variant="body" color={colors.textDim}>
              A full week · {days.size} delivery {days.size === 1 ? 'day' : 'days'}
            </AppText>
            <AppText variant="bodyBold" tabular>
              {planQuote && weeklyTotalMinor !== null
                ? formatMoney(weeklyTotalMinor, planQuote.currency)
                : '—'}
            </AppText>
          </View>
          {planQuoteStatus === 'loading' ? (
            <AppText variant="caption" color={colors.textDim}>
              Working out your price…
            </AppText>
          ) : planQuoteStatus === 'error' ? (
            <AppText variant="caption" color={colors.warning}>
              We couldn&apos;t work out the price right now.{' '}
              {mealErrorMessage(planQuoteErrorCode ?? 'network')}
            </AppText>
          ) : planQuoteStatus === 'idle' ? (
            <AppText variant="caption" color={colors.textDim}>
              Pick your days, meal and address to see the price.
            </AppText>
          ) : (
            <AppText variant="caption" color={colors.textFaint}>
              Delivery included. Your first bill may be smaller if the plan starts mid-week, and we
              confirm the price when the plan starts.
            </AppText>
          )}
        </Card>
      </Animated.View>

      {error ? (
        <AppText variant="caption" color={colors.error} style={styles.errorText}>
          {error}
        </AppText>
      ) : null}

      <Button
        label="Start meal plan"
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
