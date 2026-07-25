import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { formatMoney } from '@gym/shared';
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
import {
  useMealAddresses,
  useMealMenu,
  useMealSubscriptionEditQuote,
  useMyMealSubscriptions,
} from '../../features/meals/hooks';
import { editMealSubscription, toMealsError, type MealAddress, type MealPlanType, type MealWindow } from '../../features/meals/api';
import { AddressSheet } from '../../features/meals/components/AddressSheet';
import { mealErrorMessage, weekdayLabel, WEEKDAY_OPTIONS, windowLabel } from '../../features/meals/logic';
import { replacePath } from '../../features/meals/nav';

/**
 * /meals/subscription-edit?id= — the front door for the previously-unreachable
 * subscription EDIT engine (B3): wires the built `useMealSubscriptionEditQuote`
 * + `editMealSubscription` (`apps/web/.../subscriptions/[id]/route.ts`
 * `action='edit'`) to a real screen. Editing only touches FUTURE, unmaterialized
 * deliveries — already-frozen order snapshots (and paid weeks) are untouched,
 * which is why the server returns `effective.preservedOrderDates` on success.
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
  quoteCard: { gap: spacing.xs },
  errorText: { marginTop: spacing.sm },
  doneCard: { alignItems: 'center', gap: spacing.sm },
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

export default function SubscriptionEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuth((s) => s.token);
  const {
    data: subs,
    loading: subsLoading,
    error: subsError,
    retry: retrySubs,
  } = useMyMealSubscriptions(token);
  const sub = subs?.find((s) => s.id === id) ?? null;

  const [days, setDays] = useState<Set<number>>(new Set());
  const [window, setWindow] = useState<MealWindow>('lunch');
  const [planType, setPlanType] = useState<MealPlanType>('partner_rotating');
  const [mealId, setMealId] = useState<string | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [addressSheetOpen, setAddressSheetOpen] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Seed the form from the current plan exactly once (avoids clobbering edits
  // in progress on a background refetch).
  useEffect(() => {
    if (seeded || !sub) return;
    setDays(new Set(sub.daysOfWeek));
    setWindow(sub.window);
    setPlanType(sub.planType);
    setMealId(sub.mealId);
    setAddressId(sub.addressId);
    setSeeded(true);
  }, [seeded, sub]);

  const {
    data: menu,
    loading: menuLoading,
    error: menuError,
    retry: retryMenu,
  } = useMealMenu(token, sub?.partnerId ?? null, { window });
  const { data: addresses, reload: reloadAddresses } = useMealAddresses(token);
  const selectedAddress: MealAddress | null = addresses?.find((a) => a.id === addressId) ?? null;

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ preservedOrderDates: string[] } | null>(null);

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
    else replacePath('/meals/subscriptions');
  }

  const editInput = useMemo(() => {
    if (!seeded || !addressId || days.size === 0) return null;
    if (planType === 'fixed_meal' && !mealId) return null;
    return {
      daysOfWeek: Array.from(days).sort((a, b) => a - b),
      window,
      planType,
      mealId: planType === 'fixed_meal' ? mealId : null,
      addressId,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeded, days, window, planType, mealId, addressId]);

  const { quote, status: quoteStatus } = useMealSubscriptionEditQuote(token, sub?.id ?? null, editInput);

  function submit(): void {
    if (!token || !sub || !editInput || submitting || quoteStatus !== 'ready') return;
    setSubmitting(true);
    setError(null);
    void (async () => {
      try {
        const result = await editMealSubscription(token, sub.id, editInput);
        successHaptic();
        setDone({ preservedOrderDates: result.effective.preservedOrderDates });
      } catch (err) {
        setError(mealErrorMessage(toMealsError(err).code));
        warnHaptic();
      } finally {
        setSubmitting(false);
      }
    })();
  }

  if (!id) {
    return (
      <Screen scroll>
        <BackRow onPress={goBack} />
        <EmptyState
          icon="repeat-outline"
          title="No meal plan selected"
          body="Open a meal plan from My meal plans to edit it."
          actionLabel="Back to my meal plans"
          onAction={() => replacePath('/meals/subscriptions')}
        />
      </Screen>
    );
  }

  if (!sub) {
    // Three very different states used to share one "Loading…" screen: a failed
    // fetch, a plan that no longer exists, and a genuinely in-flight load.
    return (
      <Screen scroll>
        <BackRow onPress={goBack} />
        {subsError ? (
          <EmptyState
            icon="cloud-offline"
            title="Your meal plan could not be loaded"
            body="Check your connection and try again."
            actionLabel="Try again"
            onAction={retrySubs}
          />
        ) : subsLoading ? (
          <EmptyState icon="repeat-outline" title="Loading your meal plan…" body="One moment." />
        ) : (
          <EmptyState
            icon="repeat-outline"
            title="Meal plan not found"
            body="This meal plan may have been cancelled or already changed."
            actionLabel="Back to my meal plans"
            onAction={() => replacePath('/meals/subscriptions')}
          />
        )}
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen scroll>
        <ScreenHeader eyebrow="Meal plan updated" title="Changes saved" style={styles.header} />
        <Card style={styles.doneCard}>
          <Ionicons name="checkmark-circle" size={32} color={colors.success} />
          <AppText variant="bodyBold" center>
            Your meal plan is updated from today onward.
          </AppText>
          {done.preservedOrderDates.length > 0 ? (
            <AppText variant="caption" color={colors.textDim} center>
              Already-scheduled deliveries on {done.preservedOrderDates.join(', ')} keep their original details.
            </AppText>
          ) : null}
        </Card>
        <Button
          label="Back to my meal plans"
          // Replace, not push: the changes are saved, so Android back must
          // never reopen this (now spent) form.
          onPress={() => replacePath('/meals/subscriptions')}
          style={{ marginTop: spacing.gutter }}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <BackRow onPress={goBack} />

      <ScreenHeader eyebrow="Weekly meal plan" title="Edit your meal plan" style={styles.header} />

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

      <Animated.View entering={enterUp(4)}>
        <Card style={styles.quoteCard}>
          <AppText variant="bodyBold">New daily price</AppText>
          {quoteStatus === 'loading' ? (
            <AppText variant="caption" color={colors.textDim}>
              Calculating…
            </AppText>
          ) : quoteStatus === 'ready' && quote ? (
            <AppText variant="body" tabular>
              {formatMoney(quote.pricePerDayMinor, quote.currency)}/day + {formatMoney(quote.deliveryFeeMinor, quote.currency)} delivery
            </AppText>
          ) : quoteStatus === 'error' ? (
            <AppText variant="caption" color={colors.error}>
              Couldn&apos;t price this change. Adjust your selection.
            </AppText>
          ) : (
            <AppText variant="caption" color={colors.textDim}>
              Pick delivery days, a window, and an address to preview the new price.
            </AppText>
          )}
          <AppText variant="caption" color={colors.textFaint}>
            Changes apply to future deliveries only. Anything already scheduled keeps its original price.
          </AppText>
        </Card>
      </Animated.View>

      {error ? (
        <AppText variant="caption" color={colors.error} style={styles.errorText}>
          {error}
        </AppText>
      ) : null}

      <Button
        label="Save changes"
        onPress={submit}
        disabled={!editInput || quoteStatus !== 'ready'}
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
