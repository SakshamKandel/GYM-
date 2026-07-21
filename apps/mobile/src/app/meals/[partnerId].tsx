import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
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
  SkeletonRow,
  Tag,
} from '../../components/ui';
import { formatMoney } from '@gym/shared';
import { useBottomClearance } from '../../lib/systemBars';
import { useAuth } from '../../state/auth';
import { useMealMenu, useMealPartners } from '../../features/meals/hooks';
import { cartLineCount, cartSubtotalMinor, useMealCart } from '../../features/meals/cartStore';
import { dietLabel, goalLabel, upcomingSlots, windowLabel } from '../../features/meals/logic';
import { MealThumb } from '../../features/meals/components/MealThumb';
import { windowName, windowTimeRange } from '../../features/meals/components/orderView';
import { pushPath, replacePath } from '../../features/meals/nav';
import type { MealDietType, MealGoalTag, MealPartner, MealWindow, MenuMeal } from '../../features/meals/api';

/**
 * /meals/[partnerId] — a partner's menu (plan §6: "menu browse: macro badges
 * kcal/P/C/F, diet/goal filters, partner grouping"). Quantity pickers build
 * an in-memory cart (features/meals/cartStore) shared with /meals/checkout;
 * a "Set up a weekly plan" link hands off to /meals/subscribe for the same
 * partner without needing a cart.
 *
 * Visual language (2026-07-21 professional pass): partner hero block up top,
 * the weekly-plan promo as the screen's single cream counterpoint block, meal
 * cards with macro-dot pills + Oswald pricing, and the red floating cart bar
 * as the one red action element.
 *
 * The cart bar is a sibling of `Screen`, not a child inside its ScrollView —
 * otherwise `position: absolute` resolves against the scrollable content
 * height instead of the viewport, so it only appears once scrolled to the
 * bottom of the menu instead of floating above it at all times.
 */

const DIET_FILTERS: MealDietType[] = ['veg', 'non_veg', 'egg'];
const GOAL_FILTERS: MealGoalTag[] = ['cutting', 'bulking', 'balanced'];

/**
 * The cart bar's own footprint (money + item-count lines, plus the Checkout
 * button — roomier than a single-row action bar) plus the gap it floats
 * above the tab bar. Reserved as scroll bottomInset only while the bar is
 * actually showing, so an empty cart doesn't carry the extra whitespace.
 */
const CART_BAR_SPACE = FLOATING_TAB_SPACE + 96;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  backRow: { marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { marginBottom: spacing.lg, gap: spacing.md },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  monogram: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.accentFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogramLetter: {
    fontFamily: type.display,
    fontSize: 26,
    color: colors.accent,
    textTransform: 'uppercase',
  },
  heroMain: { flex: 1, gap: 3 },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  heroBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  subscribeBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.gutter,
  },
  subscribeIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.onBlock,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subscribeText: { flex: 1, gap: 2 },
  filterGroup: { marginBottom: spacing.md },
  filterLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: touch.min,
    marginBottom: spacing.md,
  },
  noticeText: { flex: 1 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  list: { gap: spacing.md },
  card: { gap: spacing.md },
  cardSoldOut: { opacity: 0.55 },
  cardTop: { flexDirection: 'row', gap: spacing.md },
  thumbWrap: { borderRadius: radius.md, overflow: 'hidden' },
  soldOutOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    opacity: 0.92,
    paddingVertical: 2,
    alignItems: 'center',
  },
  cardMain: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nameText: { flex: 1 },
  price: {
    fontFamily: type.display,
    fontSize: 22,
    color: colors.text,
    letterSpacing: 0.5,
  },
  macroRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  macroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  macroDot: { width: 7, height: 7, borderRadius: 4 },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  qtyBtnAccent: { backgroundColor: colors.accent },
  qtyValue: {
    fontFamily: type.display,
    fontSize: 20,
    minWidth: 24,
    textAlign: 'center',
  },
  skeletons: { gap: spacing.md },
  skeletonRow: { backgroundColor: colors.surface, borderRadius: radius.block, padding: spacing.lg, height: 128 },
  cartBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.blockRed,
    borderRadius: radius.full,
    paddingLeft: spacing.gutter,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: touch.primary,
  },
  cartInfo: { flex: 1, gap: 1 },
  cartCount: {
    fontFamily: type.display,
    fontSize: 20,
    letterSpacing: 0.5,
  },
});

function MacroPill({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.macroPill}>
      <View style={[styles.macroDot, { backgroundColor: color }]} />
      <AppText variant="caption" color={colors.textDim} tabular>
        {label}
      </AppText>
    </View>
  );
}

function PartnerHero({ partner }: { partner: MealPartner | null }) {
  const initial = partner?.name.trim().charAt(0) || '?';
  const areas = partner?.serviceAreas.slice(0, 3).join(', ');
  return (
    <Card style={styles.hero}>
      <View style={styles.heroTop}>
        <View style={styles.monogram} accessible={false} importantForAccessibility="no-hide-descendants">
          <AppText style={styles.monogramLetter}>{initial}</AppText>
        </View>
        <View style={styles.heroMain}>
          <AppText variant="label" color={colors.textDim}>
            Partner kitchen
          </AppText>
          <AppText variant="title" numberOfLines={1}>
            {partner?.name ?? 'Menu'}
          </AppText>
          <View style={styles.areaRow}>
            <Ionicons name="location-outline" size={14} color={colors.textDim} />
            <AppText variant="caption" color={colors.textDim} numberOfLines={1} style={{ flex: 1 }}>
              {areas || 'Delivery areas listed at checkout'}
            </AppText>
          </View>
        </View>
      </View>
      <View style={styles.heroBadges}>
        {partner?.acceptsCod ? <Tag label="Cash on delivery" variant="dim" /> : null}
        <Tag label={`Lunch ${windowTimeRange('lunch')}`} variant="dim" />
        <Tag label={`Dinner ${windowTimeRange('dinner')}`} variant="dim" />
      </View>
    </Card>
  );
}

function MealItemCard({ meal, index }: { meal: MenuMeal; index: number }) {
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
    <Animated.View entering={enterUp(Math.min(index, 5))}>
      <Card style={[styles.card, soldOut && styles.cardSoldOut]}>
        <View style={styles.cardTop}>
          <View style={styles.thumbWrap}>
            <MealThumb imageUrl={meal.imageUrl} size={88} />
            {soldOut ? (
              <View style={styles.soldOutOverlay}>
                <AppText variant="label" color={colors.textDim} style={{ fontSize: 10 }}>
                  Sold out
                </AppText>
              </View>
            ) : null}
          </View>
          <View style={styles.cardMain}>
            <View style={styles.nameRow}>
              <AppText variant="bodyBold" numberOfLines={2} style={styles.nameText}>
                {meal.name}
              </AppText>
            </View>
            <AppText variant="caption" color={colors.textDim} numberOfLines={2}>
              {meal.description || dietLabel(meal.dietType)}
            </AppText>
            <AppText style={styles.price} tabular>
              {formatMoney(meal.priceMinor, meal.currency)}
            </AppText>
          </View>
        </View>

        <View style={styles.macroRow}>
          <MacroPill color={colors.kcal} label={`${meal.kcal} kcal`} />
          <MacroPill color={colors.protein} label={`P ${Math.round(meal.proteinG)}`} />
          <MacroPill color={colors.carbs} label={`C ${Math.round(meal.carbsG)}`} />
          <MacroPill color={colors.fat} label={`F ${Math.round(meal.fatG)}`} />
        </View>

        <View style={styles.qtyRow}>
          <AppText variant="caption" color={colors.textFaint} numberOfLines={1} style={{ flex: 1 }}>
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
                <Ionicons name="remove" size={20} color={qty === 0 ? colors.textFaint : colors.text} />
              </PressableScale>
              <AppText style={styles.qtyValue} color={qty > 0 ? colors.accent : colors.textFaint} tabular>
                {qty}
              </AppText>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Add one ${meal.name}`}
                onPress={() => setQty(meal, Math.min(qty + 1, 20))}
                style={[styles.qtyBtn, styles.qtyBtnAccent]}
              >
                <Ionicons name="add" size={20} color={colors.onBlock} />
              </PressableScale>
            </View>
          )}
        </View>
      </Card>
    </Animated.View>
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
  const authedToken = status === 'signedIn' ? token : null;
  const [diet, setDiet] = useState<MealDietType | null>(null);
  const [goal, setGoal] = useState<MealGoalTag | null>(null);
  const setPartner = useMealCart((s) => s.setPartner);
  const lines = useMealCart((s) => s.lines);

  const { data: partners } = useMealPartners(authedToken);
  const partner = partners?.find((p) => p.id === partnerId) ?? null;

  // Filter the menu by the delivery window the member intends to order for —
  // otherwise a meal unavailable for that slot reaches the cart and only
  // fails, unitemized, at checkout submission. Defaults to the next orderable
  // slot's window, mirroring checkout's own default pick.
  const slots = useMemo(() => upcomingSlots(new Date(), 14), []);
  const [windowFilter, setWindowFilter] = useState<MealWindow>(
    () => slots.find((s) => s.orderable)?.window ?? 'lunch',
  );
  const filterDate = useMemo(() => slots.find((s) => s.window === windowFilter)?.date, [slots, windowFilter]);

  const { data: meals, loading, error, retry, reload } = useMealMenu(authedToken, partnerId ?? null, {
    diet: diet ?? undefined,
    goal: goal ?? undefined,
    date: filterDate,
    window: windowFilter,
  });

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
  const currency = meals?.[0]?.currency ?? partner?.currency ?? 'NPR';

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replacePath('/meals');
  }

  return (
    <View style={styles.root}>
      <Screen scroll bottomInset={count > 0 ? CART_BAR_SPACE : FLOATING_TAB_SPACE}>
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
              <PartnerHero partner={partner} />
            </Animated.View>

            <Animated.View entering={enterUp(1)}>
              <Card
                variant="cream"
                onPress={() => pushPath(`/meals/subscribe?partnerId=${partnerId}`)}
                accessibilityLabel="Set up a weekly meal plan with this partner"
                padding={spacing.lg}
                style={styles.subscribeBlock}
              >
                <View style={styles.subscribeIcon} accessible={false} importantForAccessibility="no-hide-descendants">
                  <Ionicons name="repeat" size={20} color={colors.text} />
                </View>
                <View style={styles.subscribeText}>
                  <AppText variant="bodyBold" color={colors.onBlock}>
                    Set up a weekly plan
                  </AppText>
                  <AppText variant="caption" color={colors.creamDim}>
                    Pick delivery days, prepay each week
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.onBlock} />
              </Card>
            </Animated.View>

            <Animated.View entering={enterUp(2)} style={styles.filterGroup}>
              <View style={styles.filterLabelRow}>
                <Ionicons name="time-outline" size={14} color={colors.textDim} />
                <AppText variant="label">Delivery window</AppText>
              </View>
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

            <Animated.View entering={enterUp(2)} style={styles.filterGroup}>
              <View style={styles.filterLabelRow}>
                <Ionicons name="leaf-outline" size={14} color={colors.textDim} />
                <AppText variant="label">Diet</AppText>
              </View>
              <View style={styles.chipRow}>
                <Chip label="All" selected={diet === null} onPress={() => setDiet(null)} />
                {DIET_FILTERS.map((d) => (
                  <Chip key={d} label={dietLabel(d)} selected={diet === d} onPress={() => setDiet(d)} />
                ))}
              </View>
            </Animated.View>

            <Animated.View entering={enterUp(3)} style={styles.filterGroup}>
              <View style={styles.filterLabelRow}>
                <Ionicons name="flag-outline" size={14} color={colors.textDim} />
                <AppText variant="label">Goal</AppText>
              </View>
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
                  style={styles.noticeRow}
                >
                  <Ionicons name="refresh-circle" size={18} color={colors.accent} />
                  <AppText variant="caption" style={styles.noticeText}>
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
                  style={styles.noticeRow}
                >
                  <Ionicons name="cloud-offline" size={16} color={colors.textDim} />
                  <AppText variant="caption" style={styles.noticeText}>
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
              <>
                <View style={styles.resultRow}>
                  <AppText variant="label">On the menu</AppText>
                  <AppText variant="caption" color={colors.textFaint}>
                    {meals.length} {meals.length === 1 ? 'meal' : 'meals'} · {windowName(windowFilter)}
                  </AppText>
                </View>
                <View style={styles.list}>
                  {meals.map((m, i) => (
                    <MealItemCard key={m.id} meal={m} index={i} />
                  ))}
                </View>
              </>
            ) : null}
          </>
        )}
      </Screen>

      {count > 0 ? (
        <Animated.View
          entering={enterFade(0)}
          style={[styles.cartBar, { bottom: bottomClearance + FLOATING_TAB_SPACE }]}
        >
          <View style={styles.cartInfo}>
            <AppText style={styles.cartCount} color={colors.onBlock} tabular>
              {formatMoney(subtotal, currency)}
            </AppText>
            <AppText variant="caption" color={colors.onBlock}>
              {count} {count === 1 ? 'item' : 'items'} in cart
            </AppText>
          </View>
          <Button label="Checkout" variant="onBlock" onPress={() => pushPath('/meals/checkout')} />
        </Animated.View>
      ) : null}
    </View>
  );
}
