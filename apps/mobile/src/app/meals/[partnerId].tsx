import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  enterDown,
  enterFade,
  enterUp,
  FLOATING_TAB_SPACE,
  PressableScale,
  Screen,
  ScreenHeader,
  SkeletonRow,
  Tag,
} from '../../components/ui';
import { formatMoney } from '@gym/shared';
import { useBottomClearance } from '../../lib/systemBars';
import { useAuth } from '../../state/auth';
import { useMealMenu } from '../../features/meals/hooks';
import { cartLineCount, cartSubtotalMinor, useMealCart } from '../../features/meals/cartStore';
import { dietLabel, goalLabel, macroLine, upcomingSlots, windowLabel } from '../../features/meals/logic';
import { pushPath, replacePath } from '../../features/meals/nav';
import type { MealDietType, MealGoalTag, MealWindow, MenuMeal } from '../../features/meals/api';

/**
 * /meals/[partnerId] — a partner's menu (plan §6: "menu browse: macro badges
 * kcal/P/C/F, diet/goal filters, partner grouping"). Quantity pickers build
 * an in-memory cart (features/meals/cartStore) shared with /meals/checkout;
 * a "Set up a weekly plan" link hands off to /meals/subscribe for the same
 * partner without needing a cart.
 */

const DIET_FILTERS: MealDietType[] = ['veg', 'non_veg', 'egg'];
const GOAL_FILTERS: MealGoalTag[] = ['cutting', 'bulking', 'balanced'];

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
  filterGroup: { marginBottom: spacing.md },
  filterLabel: { marginBottom: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  subscribeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: touch.min,
    marginBottom: spacing.gutter,
  },
  subscribeText: { flex: 1 },
  list: { gap: spacing.md },
  card: { gap: spacing.sm },
  cardSoldOut: { opacity: 0.6 },
  cardTop: { flexDirection: 'row', gap: spacing.md },
  photo: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  cardMain: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nameText: { flex: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  qtyBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletons: { gap: spacing.md },
  skeletonRow: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, height: 96 },
  cartBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.blockRed,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    minHeight: touch.primary,
  },
  cartInfo: { flex: 1 },
});

function MealItemCard({ meal }: { meal: MenuMeal }) {
  const qty = useMealCart((s) => s.lines[meal.id]?.qty ?? 0);
  const setQty = useMealCart((s) => s.setQty);
  // Pack F real inventory (B... sold-out surfacing): disable ordering instead
  // of hiding the meal outright, and zero any quantity already in the cart —
  // a partner toggling sold-out mid-browse must not leave a stale cart line.
  const soldOut = meal.soldOut;
  useEffect(() => {
    if (soldOut && qty > 0) setQty(meal, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soldOut]);

  return (
    <Card style={[styles.card, soldOut && styles.cardSoldOut]}>
      <View style={styles.cardTop}>
        {meal.imageUrl ? (
          <Image source={{ uri: meal.imageUrl }} style={styles.photo} accessibilityIgnoresInvertColors />
        ) : (
          <View style={styles.photo} />
        )}
        <View style={styles.cardMain}>
          <View style={styles.nameRow}>
            <AppText variant="bodyBold" numberOfLines={1} style={styles.nameText}>
              {meal.name}
            </AppText>
            {soldOut ? <Tag label="Sold out" variant="outline" color={colors.textDim} /> : null}
          </View>
          <AppText variant="caption" color={colors.textDim} numberOfLines={2}>
            {meal.description || dietLabel(meal.dietType)}
          </AppText>
          <View style={styles.priceRow}>
            <AppText variant="bodyBold" tabular>
              {formatMoney(meal.priceMinor, meal.currency)}
            </AppText>
            <AppText variant="caption" color={colors.textDim} tabular>
              · {meal.kcal} kcal
            </AppText>
          </View>
        </View>
      </View>

      <AppText variant="caption" color={colors.textDim} tabular>
        {macroLine(meal.proteinG, meal.carbsG, meal.fatG)}
      </AppText>

      <View style={styles.qtyRow}>
        <AppText variant="caption" color={colors.textFaint}>
          {dietLabel(meal.dietType)}
          {meal.goalTags.length > 0 ? ` · ${meal.goalTags.map(goalLabel).join(', ')}` : ''}
        </AppText>
        {soldOut ? (
          <AppText variant="caption" color={colors.textDim}>
            Not available for this slot
          </AppText>
        ) : (
          <View style={styles.qtyControls}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Remove one ${meal.name}`}
              disabled={qty === 0}
              onPress={() => setQty(meal, qty - 1)}
              style={styles.qtyBtn}
            >
              <Ionicons name="remove" size={18} color={qty === 0 ? colors.textFaint : colors.text} />
            </PressableScale>
            <AppText variant="bodyBold" tabular style={{ minWidth: 20, textAlign: 'center' }}>
              {qty}
            </AppText>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Add one ${meal.name}`}
              onPress={() => setQty(meal, Math.min(qty + 1, 20))}
              style={styles.qtyBtn}
            >
              <Ionicons name="add" size={18} color={colors.text} />
            </PressableScale>
          </View>
        )}
      </View>
    </Card>
  );
}

export default function PartnerMenuScreen() {
  const { partnerId } = useLocalSearchParams<{ partnerId: string }>();
  // OEM-safe bottom clearance: some 3-button Android builds report
  // insets.bottom = 0 under edge-to-edge, which sank the cart bar's Checkout
  // button beneath the 48dp system bar (lib/systemBars).
  const bottomClearance = useBottomClearance();
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const [diet, setDiet] = useState<MealDietType | null>(null);
  const [goal, setGoal] = useState<MealGoalTag | null>(null);
  const setPartner = useMealCart((s) => s.setPartner);
  const lines = useMealCart((s) => s.lines);

  // Filter the menu by the delivery window the member intends to order for —
  // otherwise a meal unavailable for that slot reaches the cart and only
  // fails, unitemized, at checkout submission. Defaults to the next orderable
  // slot's window, mirroring checkout's own default pick.
  const slots = useMemo(() => upcomingSlots(new Date(), 14), []);
  const [windowFilter, setWindowFilter] = useState<MealWindow>(
    () => slots.find((s) => s.orderable)?.window ?? 'lunch',
  );
  const filterDate = useMemo(() => slots.find((s) => s.window === windowFilter)?.date, [slots, windowFilter]);

  const { data: meals, loading, error, retry, reload } = useMealMenu(
    status === 'signedIn' ? token : null,
    partnerId ?? null,
    { diet: diet ?? undefined, goal: goal ?? undefined, date: filterDate, window: windowFilter },
  );

  useEffect(() => {
    if (partnerId) setPartner(partnerId);
  }, [partnerId, setPartner]);

  // B12/Pack F: the menu only ever loaded on-focus, so a partner edit made
  // while a member is browsing was invisible until they navigated away and
  // back. A quiet background poll catches it and surfaces a dismissible
  // "menu updated" toast the moment prices/availability actually change.
  const MENU_POLL_MS = 30_000;
  const prevSignatureRef = useRef<string | null>(null);
  const [menuUpdated, setMenuUpdated] = useState(false);
  // A filter change (window/diet/goal) refetches a DIFFERENT meal set, so the
  // signature legitimately differs — that is NOT a partner edit. Drop the
  // baseline (and any live toast) on every filter change so the next load
  // silently re-baselines and only a genuine mid-browse partner edit surfaces
  // the "Menu updated" toast.
  useEffect(() => {
    prevSignatureRef.current = null;
    setMenuUpdated(false);
  }, [diet, goal, windowFilter]);
  useEffect(() => {
    if (!meals) return;
    const signature = JSON.stringify(
      meals.map((m) => [m.id, m.priceMinor, m.soldOut]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    if (prevSignatureRef.current !== null && prevSignatureRef.current !== signature) {
      setMenuUpdated(true);
    }
    prevSignatureRef.current = signature;
  }, [meals]);
  useEffect(() => {
    if (status !== 'signedIn' || !partnerId) return;
    const id = setInterval(reload, MENU_POLL_MS);
    return () => clearInterval(id);
  }, [status, partnerId, reload]);

  const count = cartLineCount(lines);
  const subtotal = cartSubtotalMinor(lines);
  const currency = meals?.[0]?.currency ?? 'NPR';

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replacePath('/meals');
  }

  return (
    <Screen scroll bottomInset={FLOATING_TAB_SPACE}>
      <Animated.View entering={enterDown()} style={styles.backRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={goBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>

      <ScreenHeader eyebrow="Menu" title="Choose your meals" style={styles.header} />

      {status !== 'signedIn' ? (
        <Animated.View entering={enterUp(0)}>
          <EmptyState
            icon="restaurant"
            title="Sign in to order"
            body="Menus and ordering live on your account."
            actionLabel="Sign in"
            onAction={() => pushPath('/auth/sign-in')}
          />
        </Animated.View>
      ) : (
        <>
          <Animated.View entering={enterUp(0)}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Set up a weekly meal plan with this partner"
              onPress={() => pushPath(`/meals/subscribe?partnerId=${partnerId}`)}
              style={styles.subscribeRow}
            >
              <Ionicons name="repeat-outline" size={20} color={colors.accent} />
              <View style={styles.subscribeText}>
                <AppText variant="bodyBold">Set up a weekly plan</AppText>
                <AppText variant="caption" color={colors.textDim}>
                  Pick delivery days, prepay each week
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            </PressableScale>
          </Animated.View>

          <Animated.View entering={enterUp(1)} style={styles.filterGroup}>
            <AppText variant="label" style={styles.filterLabel}>
              Delivery window
            </AppText>
            <View style={styles.chipRow}>
              <Chip
                label={windowLabel('lunch')}
                selected={windowFilter === 'lunch'}
                onPress={() => setWindowFilter('lunch')}
              />
              <Chip
                label={windowLabel('dinner')}
                selected={windowFilter === 'dinner'}
                onPress={() => setWindowFilter('dinner')}
              />
            </View>
          </Animated.View>

          <Animated.View entering={enterUp(1)} style={styles.filterGroup}>
            <AppText variant="label" style={styles.filterLabel}>
              Diet
            </AppText>
            <View style={styles.chipRow}>
              <Chip label="All" selected={diet === null} onPress={() => setDiet(null)} />
              {DIET_FILTERS.map((d) => (
                <Chip key={d} label={dietLabel(d)} selected={diet === d} onPress={() => setDiet(d)} />
              ))}
            </View>
          </Animated.View>

          <Animated.View entering={enterUp(2)} style={styles.filterGroup}>
            <AppText variant="label" style={styles.filterLabel}>
              Goal
            </AppText>
            <View style={styles.chipRow}>
              <Chip label="All" selected={goal === null} onPress={() => setGoal(null)} />
              {GOAL_FILTERS.map((g) => (
                <Chip key={g} label={goalLabel(g)} selected={goal === g} onPress={() => setGoal(g)} />
              ))}
            </View>
          </Animated.View>

          {menuUpdated ? (
            <Animated.View entering={enterFade(0)}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Menu updated — tap to dismiss"
                onPress={() => setMenuUpdated(false)}
                style={styles.subscribeRow}
              >
                <Ionicons name="refresh-circle" size={16} color={colors.accent} />
                <AppText variant="caption" style={styles.subscribeText}>
                  Menu updated — prices or availability changed.
                </AppText>
              </PressableScale>
            </Animated.View>
          ) : null}

          {error ? (
            <Animated.View entering={enterFade(0)}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Couldn't load the menu. Tap to retry."
                onPress={retry}
                style={styles.subscribeRow}
              >
                <Ionicons name="cloud-offline" size={14} color={colors.textDim} />
                <AppText variant="caption" style={styles.subscribeText}>
                  Couldn&apos;t load the menu — tap to retry.
                </AppText>
                <Ionicons name="refresh" size={15} color={colors.textDim} />
              </PressableScale>
            </Animated.View>
          ) : null}

          {loading ? (
            <Animated.View entering={enterFade(0)} style={styles.skeletons} accessibilityLabel="Loading menu">
              {Array.from({ length: 4 }, (_, i) => (
                <SkeletonRow key={i} style={styles.skeletonRow} />
              ))}
            </Animated.View>
          ) : meals !== null && meals.length === 0 ? (
            <Animated.View entering={enterUp(3)}>
              <EmptyState icon="restaurant" title="No meals match" body="Try a different diet or goal filter." />
            </Animated.View>
          ) : meals !== null ? (
            <Animated.View entering={enterUp(3)} style={styles.list}>
              {meals.map((m) => (
                <MealItemCard key={m.id} meal={m} />
              ))}
            </Animated.View>
          ) : null}
        </>
      )}

      {count > 0 ? (
        <Animated.View
          entering={enterFade(0)}
          style={[styles.cartBar, { bottom: bottomClearance + spacing.lg }]}
        >
          <View style={styles.cartInfo}>
            <AppText variant="bodyBold" color={colors.onBlock}>
              {count} {count === 1 ? 'item' : 'items'} · {formatMoney(subtotal, currency)}
            </AppText>
          </View>
          <Button label="Checkout" variant="onBlock" onPress={() => pushPath('/meals/checkout')} />
        </Animated.View>
      ) : null}
    </Screen>
  );
}
