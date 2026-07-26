import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
} from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import type { FoodLog, Meal } from '@gym/shared';
import {
  AnimatedNumber,
  AppText,
  Button,
  Card,
  ConfirmDialog,
  DayStrip,
  EmptyState,
  enterDown,
  enterUp,
  FLOATING_TAB_SPACE,
  IconChip,
  layoutSpring,
  MacroBar,
  PRESS_SPRING,
  PressableScale,
  ProgressBar,
  Ring,
  Screen,
  ScreenHeader,
  Sheet,
  Skeleton,
} from '../../components/ui';
import { EmptyArt } from '../../components/visual';
import { WeeklyCheckIn } from '../../features/engagement/components/WeeklyCheckIn';
import { logHaptic, tapHaptic } from '../../lib/haptics';
import { posterDate, todayIso } from '../../lib/dates';
import { uid } from '../../lib/id';
import { tierName } from '../../lib/tier';
import { useProfile } from '../../state/profile';
import {
  MEALS,
  STRIP_DAYS_BACK,
  STRIP_DAYS_FORWARD,
  cloneLogsToDate,
  defaultMealForHour,
  groupByMeal,
  kcalRingState,
  litres,
  remainingMacros,
  sumDayTotals,
  sumKcal,
} from '../../features/nutrition/logic';
import { editLogHref, searchHref } from '../../features/nutrition/nav';
import { useCoachDiet, type CoachDietSection } from '../../features/nutrition/coachDiet';
import { FoodLogDetailSheet } from '../../features/nutrition/FoodLogDetailSheet';
import { pushPath } from '../../features/meals/nav';
import { SuggestionsSection } from '../../features/nutrition/SuggestionsSection';
import { useNutritionDay } from '../../features/nutrition/useNutritionDay';

/** Every meal header gets a rounded-square icon anchor. */
const MEAL_ICONS: Record<Meal, ComponentProps<typeof Ionicons>['name']> = {
  breakfast: 'sunny-outline',
  lunch: 'restaurant-outline',
  dinner: 'moon-outline',
  snacks: 'cafe-outline',
};

const styles = StyleSheet.create({
  // Outlined meta pill under the header title (brief §6 — chips may carry
  // borders; the no-border law is for cards only).
  metaChip: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.lg,
  },
  // 48dp round search action beside the huge title (same nav as before).
  headerAction: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strip: { marginTop: spacing.md },
  // Extra air around the hero block (brief §3: up to 28 around the hero).
  hero: { marginTop: spacing.xl + spacing.xs },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  heroLeft: { flexShrink: 1, minWidth: 0 },
  ringCenter: { alignItems: 'center' },
  ringValue: { fontSize: 24, lineHeight: 28 },
  // Thick macro bars on their own charcoal block, sibling of the hero.
  macroCard: { marginTop: spacing.md, gap: spacing.lg },
  copyRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },
  copyInfo: { flex: 1 },
  // Meal sections: one charcoal block per meal, rows separated by gaps —
  // no hairline dividers anywhere (brief §11c).
  mealBlock: { marginTop: spacing.md },
  mealBlockFirst: { marginTop: spacing.xl },
  mealCard: { gap: spacing.md },
  mealHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  mealHeaderText: { flex: 1, minWidth: 0 },
  mealMacroLine: { marginTop: 1 },
  mealKcal: { fontFamily: type.display, fontSize: 20, color: colors.text },
  mealKcalUnit: { fontFamily: type.display, fontSize: 12, letterSpacing: 1 },
  mealKcalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, flexShrink: 0 },
  logList: { gap: spacing.sm },
  // Logged items are raised nested tiles inside the meal block (radius.md —
  // the sanctioned nested-tile radius), fill contrast instead of dividers.
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  logInfo: { flex: 1, minWidth: 0 },
  logMacro: { marginTop: 1 },
  logKcalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, flexShrink: 0 },
  logKcal: { fontFamily: type.display, fontSize: 18, color: colors.text },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.lg,
    alignSelf: 'flex-start',
  },
  addRowPressed: { borderColor: colors.text },
  // The screen's one primary action, directly under the day's numbers instead
  // of a scroll away past the teaser cards.
  primaryAdd: { marginTop: spacing.md },
  // Undo strip: sits in the meal block the entry was removed from, so it is
  // right where the member was looking when they removed it.
  undoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 56,
  },
  undoInfo: { flex: 1, minWidth: 0 },
  undoBtn: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
  },
  // Ghost meal rows for the empty state (EmptyState above brings its own air).
  ghostWrap: { gap: spacing.md },
  ghostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 72,
  },
  ghostText: { flex: 1 },
  // Water: compact charcoal block — icon anchor + litres, red fill bar below.
  waterWrap: { marginTop: spacing.xl },
  waterCard: { gap: spacing.md },
  waterTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  waterInfo: { flex: 1, minWidth: 0 },
  waterValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  waterValue: { fontFamily: type.display, fontSize: 24, lineHeight: 28, color: colors.text },
  waterCaption: { marginTop: spacing.sm },
  waterPressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  waterTileInner: { pointerEvents: 'none' },
  // The GM weekly check-in brings its own bottom rhythm; it only needs air
  // above it to clear the water block.
  checkInWrap: { marginTop: spacing.xl },
  // Loading stand-ins, sized to the blocks they replace so nothing jumps when
  // the day lands.
  heroSkeleton: { marginTop: spacing.xl + spacing.xs },
  macroSkeleton: { marginTop: spacing.md },
  waterSkeleton: { marginTop: spacing.xl },
});

/** Cream calorie hero: ring + big number inside the gutter padding. */
const HERO_SKELETON_H = 152;
/** "Consumed" label + three macro bars on their charcoal block. */
const MACRO_SKELETON_H = 180;
/** Water block: icon anchor + litres + fill bar. */
const WATER_SKELETON_H = 112;

// Ease for the water tile's add-confirmation pop (a user-driven settle).
const EASE_OUT = Easing.bezier(0.25, 0.8, 0.4, 1);

/** How long a removed entry stays one tap away from coming back. */
const UNDO_MS = 10_000;

/** Outlined meta pill (brief §6): Oswald caps or mixed-case caption label. */
function MetaChip({ label, caps = false }: { label: string; caps?: boolean }) {
  return (
    <View style={styles.metaChip}>
      <AppText
        variant={caps ? 'label' : 'caption'}
        color={colors.text}
        tabular={false}
        numberOfLines={1}
      >
        {label}
      </AppText>
    </View>
  );
}

/** Compact "P XX · C XX · F XX" macro line shared by meal headers and rows. */
function macroLine(protein: number, carbs: number, fat: number): string {
  return `P ${Math.round(protein)} · C ${Math.round(carbs)} · F ${Math.round(fat)}`;
}

/** The card's caption previews what /coach-diet will show — the screen itself owns the full gate. */
function coachDietCaption(section: CoachDietSection): string {
  switch (section.kind) {
    case 'locked':
      // Named from the gate's OWN required tier, not a hardcoded one, and
      // spelled by the shared helper so it can never read as a raw slug.
      return `Unlock with the ${tierName(section.requiredTier)} membership`;
    case 'no-coach':
      return 'Get a coach for a custom diet plan';
    case 'ready':
      return section.plans.length > 0
        ? `${section.plans.length} active diet plan${section.plans.length === 1 ? '' : 's'} from ${section.coach.displayName}`
        : `${section.coach.displayName} hasn't assigned one yet`;
    case 'error':
      return "Couldn't load. Tap to retry";
    case 'hidden':
      return '';
  }
}

export default function FoodScreen() {
  const [selected, setSelected] = useState(todayIso());
  const [copying, setCopying] = useState(false);
  const reduceMotion = useReducedMotion();
  // Long-press delete goes through the branded ConfirmDialog; a tap opens the
  // detail sheet, where correcting the entry comes first and removing it is
  // undoable in place.
  const [pendingDelete, setPendingDelete] = useState<FoodLog | null>(null);
  const [detailLog, setDetailLog] = useState<FoodLog | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  /** The entry just removed, still recoverable from its own meal block. */
  const [undoLog, setUndoLog] = useState<FoodLog | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Entry the member chose to correct. Held until the sheet has finished
   * closing, then navigated to — same rule the workout preview follows, so a
   * modal is never left sitting over a screen it just pushed.
   */
  const pendingEdit = useRef<FoodLog | null>(null);
  const waterPop = useSharedValue(1);
  const waterPopStyle = useAnimatedStyle(() => ({ transform: [{ scale: waterPop.value }] }));
  const targets = useProfile((s) => s.targets);
  const {
    loaded,
    logs,
    waterMl,
    marked,
    yesterdayLogs,
    addWater,
    deleteLog,
    restoreLog,
    copyLogs,
  } = useNutritionDay(selected);
  const coachDietSection = useCoachDiet();

  const totals = sumDayTotals(logs);
  const remaining = remainingMacros(targets, totals);
  const eaten = Math.round(totals.kcal);
  const ring = kcalRingState(eaten, targets.kcal);
  const grouped = groupByMeal(logs);

  // One-tap "copy yesterday": today, still empty, and yesterday has something.
  const showCopyYesterday =
    loaded && selected === todayIso() && logs.length === 0 && yesterdayLogs.length > 0;
  const yesterdayKcal = sumKcal(yesterdayLogs);

  const clearUndoTimer = useCallback((): void => {
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
  }, []);

  // The pending undo belongs to this screen; the strip itself checks it also
  // belongs to the day on show.
  useEffect(() => clearUndoTimer, [clearUndoTimer]);

  function openDetail(log: FoodLog): void {
    tapHaptic();
    setDetailLog(log);
    setDetailOpen(true);
  }

  function requestDelete(log: FoodLog): void {
    tapHaptic();
    setPendingDelete(log);
  }

  function editLog(log: FoodLog): void {
    router.push(
      editLogHref({
        logId: log.id,
        foodId: log.foodId,
        meal: log.meal,
        // The entry's own day, not whatever the strip happens to show.
        date: log.date,
        grams: log.grams,
      }),
    );
  }

  function removeLog(log: FoodLog): void {
    logHaptic();
    void deleteLog(log.id);
    // Removing is never final for the next few seconds: the entry's own meal
    // block offers it straight back, right where the row was.
    clearUndoTimer();
    setUndoLog(log);
    undoTimer.current = setTimeout(() => {
      undoTimer.current = null;
      setUndoLog(null);
    }, UNDO_MS);
  }

  function undoRemove(): void {
    const target = undoLog;
    if (!target || target.date !== selected) return;
    tapHaptic();
    clearUndoTimer();
    setUndoLog(null);
    // The hook already reports a failed restore; swallow it here so a rejected
    // write can never surface as an unhandled rejection.
    void restoreLog(target).catch(() => undefined);
  }

  function addWaterTap(): void {
    tapHaptic();
    if (!reduceMotion) {
      waterPop.value = withSequence(
        withTiming(1.035, { duration: 120, easing: EASE_OUT }),
        withSpring(1, PRESS_SPRING),
      );
    }
    void addWater(250);
  }

  function addTo(meal: Meal): void {
    tapHaptic();
    router.push(searchHref(meal, selected));
  }

  /**
   * The safety net for a removal, rendered inside the meal block the entry
   * came out of — the member is still looking at exactly that spot.
   */
  function undoStrip(): ReactElement | null {
    // Only offered on the day the entry came from — flicking the day strip
    // parks the undo rather than aiming it at somebody else's day.
    if (!undoLog || undoLog.date !== selected) return null;
    return (
      <Animated.View entering={enterUp(0)} layout={layoutSpring} style={styles.undoRow}>
        <View style={styles.undoInfo}>
          <AppText variant="body" numberOfLines={1}>
            Removed {undoLog.foodName}
          </AppText>
          <AppText variant="caption" color={colors.textDim}>
            Changed your mind?
          </AppText>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Undo removing ${undoLog.foodName}`}
          onPress={undoRemove}
          style={styles.undoBtn}
        >
          <AppText variant="bodyBold" color={colors.accent}>
            Undo
          </AppText>
        </PressableScale>
      </Animated.View>
    );
  }

  async function copyYesterday(): Promise<void> {
    if (copying) return;
    setCopying(true);
    try {
      await copyLogs(cloneLogsToDate(yesterdayLogs, selected, uid));
      logHaptic();
    } finally {
      setCopying(false);
    }
  }

  return (
    <Screen scroll bottomInset={FLOATING_TAB_SPACE}>
      {/* Standard revamp header: eyebrow → huge Oswald title → meta chips.
          The round search action keeps the header's old "Search food" nav. */}
      <ScreenHeader
        title="Food"
        eyebrow="Nutrition"
        meta={
          <>
            <MetaChip label={posterDate(selected)} />
            <MetaChip caps label={selected === todayIso() ? 'Today' : 'Log'} />
          </>
        }
        action={
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Search food"
            onPress={() => addTo(defaultMealForHour(new Date().getHours()))}
            style={styles.headerAction}
          >
            <Ionicons name="search" size={22} color={colors.text} />
          </PressableScale>
        }
      />

      <Animated.View entering={enterDown(1)} style={styles.strip}>
        <DayStrip
          selected={selected}
          onSelect={setSelected}
          markedDates={marked}
          daysBack={STRIP_DAYS_BACK}
          daysForward={STRIP_DAYS_FORWARD}
        />
      </Animated.View>

      {/* Cream hero block — today's calories in black ink: big Oswald eaten
          number beside the adherence-neutral kcal ring (onBlock arc over the
          sanctioned rgba track on colored blocks).

          Until the day has actually loaded there is no number to show: an
          eaten total of 0 reads as a real, wrong figure. Hold the same
          skeleton every other tab uses instead. */}
      {!loaded ? (
        <>
          <Skeleton height={HERO_SKELETON_H} radius={radius.block} style={styles.heroSkeleton} />
          <Skeleton height={MACRO_SKELETON_H} radius={radius.block} style={styles.macroSkeleton} />
        </>
      ) : (
        <>
          <Animated.View entering={enterUp(0)} style={styles.hero}>
            <Card variant="cream">
              <View style={styles.heroRow}>
                <View style={styles.heroLeft}>
                  <AppText variant="label" color={colors.creamDim}>
                    Calories
                  </AppText>
                  <AnimatedNumber value={eaten} variant="stat" color={colors.onBlock} />
                  <AppText variant="caption" color={colors.creamDim} tabular>
                    of {targets.kcal} kcal
                  </AppText>
                </View>
                <Ring
                  size={96}
                  strokeWidth={10}
                  progress={targets.kcal > 0 ? eaten / targets.kcal : 0}
                  color={colors.onBlock}
                  trackColor="rgba(0,0,0,0.15)"
                >
                  <View style={styles.ringCenter}>
                    <AppText
                      variant="display"
                      style={styles.ringValue}
                      color={ring.over ? colors.creamDim : colors.onBlock}
                    >
                      {ring.value}
                    </AppText>
                    <AppText variant="caption" color={colors.creamDim}>
                      {ring.caption}
                    </AppText>
                  </View>
                </Ring>
              </View>
            </Card>
          </Animated.View>

          {/* Consumed macros: thick rounded bars on a charcoal block (fixed
              app-wide macro colors over the raised track). */}
          <Animated.View entering={enterUp(1)}>
            <Card style={styles.macroCard}>
              <AppText variant="label">Consumed</AppText>
              <MacroBar
                label="Protein"
                current={totals.protein}
                target={targets.protein}
                color={colors.protein}
                delay={120}
              />
              <MacroBar
                label="Carbs"
                current={totals.carbs}
                target={targets.carbs}
                color={colors.carbs}
                delay={200}
              />
              <MacroBar
                label="Fat"
                current={totals.fat}
                target={targets.fat}
                color={colors.fat}
                delay={280}
              />
            </Card>
          </Animated.View>
        </>
      )}

      {/* The one thing this screen exists for. It used to be a full screen
          down, below three cards selling other things — now it sits directly
          under the day's numbers, in reach without scrolling. */}
      <Animated.View entering={enterUp(2)} style={styles.primaryAdd}>
        <Button
          label="Add food"
          onPress={() => addTo(defaultMealForHour(new Date().getHours()))}
        />
      </Animated.View>

      {/* Copy yesterday — a full day of logging in one tap */}
      {showCopyYesterday ? (
        <Animated.View entering={enterUp(3)} layout={layoutSpring}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Copy yesterday's meals: ${yesterdayLogs.length} items, ${yesterdayKcal} calories`}
            onPress={() => void copyYesterday()}
            disabled={copying}
            style={styles.copyRow}
          >
            <IconChip icon="copy-outline" />
            <View style={styles.copyInfo}>
              <AppText variant="bodyBold">Copy yesterday&apos;s meals</AppText>
              <AppText variant="caption" color={colors.textDim} tabular>
                {yesterdayLogs.length} {yesterdayLogs.length === 1 ? 'item' : 'items'} ·{' '}
                {yesterdayKcal} kcal
              </AppText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
          </PressableScale>
        </Animated.View>
      ) : null}

      {/* Meals — one charcoal block per meal, log rows as raised tiles */}
      {!loaded ? null : logs.length === 0 ? (
        <Animated.View entering={enterUp(4)}>
          <EmptyState
            icon="restaurant-outline"
            title="Nothing logged yet"
            body="Search a food or tap a meal below to start the day."
            art={<EmptyArt variant="food" />}
            actionLabel="Log your first meal"
            onAction={() => addTo(defaultMealForHour(new Date().getHours()))}
          />
          {/* The day emptied out because of that removal — keep the way back. */}
          {undoStrip()}
          <View style={styles.ghostWrap}>
            {MEALS.map(({ key, label }) => (
              <PressableScale
                key={key}
                accessibilityRole="button"
                accessibilityLabel={`Add food to ${label}`}
                onPress={() => addTo(key)}
                style={styles.ghostRow}
              >
                <IconChip icon={MEAL_ICONS[key]} />
                <View style={styles.ghostText}>
                  <AppText variant="bodyBold">{label}</AppText>
                  <AppText variant="caption" color={colors.textDim}>
                    Nothing yet
                  </AppText>
                </View>
                <Ionicons name="add" size={22} color={colors.textDim} />
              </PressableScale>
            ))}
          </View>
        </Animated.View>
      ) : (
        MEALS.map(({ key, label }, mealIndex) => {
          const items = grouped[key];
          const mealTotals = sumDayTotals(items);
          return (
            <Animated.View
              key={key}
              entering={enterUp(4 + mealIndex)}
              layout={layoutSpring}
              style={[styles.mealBlock, mealIndex === 0 && styles.mealBlockFirst]}
            >
              <Card style={styles.mealCard}>
                <View style={styles.mealHeader}>
                  <IconChip icon={MEAL_ICONS[key]} />
                  <View style={styles.mealHeaderText}>
                    <AppText variant="bodyBold" numberOfLines={1}>
                      {label}
                    </AppText>
                    {items.length > 0 ? (
                      <AppText
                        variant="caption"
                        color={colors.textDim}
                        style={styles.mealMacroLine}
                        tabular
                        numberOfLines={1}
                      >
                        {macroLine(mealTotals.protein, mealTotals.carbs, mealTotals.fat)}
                      </AppText>
                    ) : (
                      <AppText variant="caption" color={colors.textDim}>
                        Nothing yet
                      </AppText>
                    )}
                  </View>
                  {items.length > 0 ? (
                    <View style={styles.mealKcalRow}>
                      <AppText style={styles.mealKcal} tabular>
                        {sumKcal(items)}
                      </AppText>
                      <AppText style={styles.mealKcalUnit} color={colors.textDim} tabular={false}>
                        KCAL
                      </AppText>
                    </View>
                  ) : null}
                </View>

                {items.length > 0 ? (
                  <View style={styles.logList}>
                    {items.map((log) => (
                      <Animated.View key={log.id} entering={enterUp(0)} layout={layoutSpring}>
                        <PressableScale
                          accessibilityRole="button"
                          accessibilityLabel={`${log.foodName}, ${Math.round(log.grams)} grams, ${Math.round(log.kcal)} calories. Tap to change or remove it, long press to remove.`}
                          onPress={() => openDetail(log)}
                          onLongPress={() => requestDelete(log)}
                          style={styles.logRow}
                        >
                          <View style={styles.logInfo}>
                            <AppText variant="body" numberOfLines={1}>
                              {log.foodName}
                            </AppText>
                            <AppText
                              variant="caption"
                              color={colors.textDim}
                              style={styles.logMacro}
                              tabular
                              numberOfLines={1}
                            >
                              {Math.round(log.grams)} g ·{' '}
                              {macroLine(log.protein, log.carbs, log.fat)}
                            </AppText>
                          </View>
                          <View style={styles.logKcalRow}>
                            <AppText style={styles.logKcal} tabular>
                              {Math.round(log.kcal)}
                            </AppText>
                            <AppText variant="caption" color={colors.textDim}>
                              kcal
                            </AppText>
                          </View>
                        </PressableScale>
                      </Animated.View>
                    ))}
                  </View>
                ) : null}

                {undoLog?.meal === key ? undoStrip() : null}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Add food to ${label}`}
                  onPress={() => addTo(key)}
                  style={({ pressed }) => [styles.addRow, pressed && styles.addRowPressed]}
                >
                  <Ionicons name="add" size={18} color={colors.textDim} />
                  <AppText variant="bodyBold" color={colors.textDim}>
                    Add food
                  </AppText>
                </Pressable>
              </Card>
            </Animated.View>
          );
        })
      )}

      {/* Water — compact charcoal block: litres up top, red fill bar below.
          Same one-tap +250 / long-press −250 target as before. Skeleton until
          the day lands, for the same reason the calorie hero holds one. */}
      {!loaded ? (
        <Skeleton height={WATER_SKELETON_H} radius={radius.block} style={styles.waterSkeleton} />
      ) : (
        <Animated.View entering={enterUp(8)} style={styles.waterWrap}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Water: ${litres(waterMl)} litres. Tap to add 250 millilitres, long press to remove 250.`}
            onPress={addWaterTap}
            onLongPress={() => {
              if (waterMl <= 0) return;
              tapHaptic();
              void addWater(-250);
            }}
            style={({ pressed }) => (pressed ? styles.waterPressed : null)}
          >
            <Animated.View
              style={[styles.waterTileInner, waterPopStyle]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Card style={styles.waterCard}>
                <View style={styles.waterTop}>
                  <IconChip icon="water" />
                  <View style={styles.waterInfo}>
                    <AppText variant="label">Water</AppText>
                    <View style={styles.waterValueRow}>
                      <AppText style={styles.waterValue} tabular>
                        {litres(waterMl)}
                      </AppText>
                      <AppText variant="caption" color={colors.textDim}>
                        L
                      </AppText>
                    </View>
                  </View>
                </View>
                <ProgressBar
                  value={targets.waterMl > 0 ? waterMl / targets.waterMl : 0}
                  height={10}
                />
              </Card>
            </Animated.View>
          </Pressable>
          <AppText variant="caption" color={colors.textDim} style={styles.waterCaption} tabular>
            target {litres(targets.waterMl)}L · tap +250ml · hold −250ml
          </AppText>
        </Animated.View>
      )}

      {/* The GM weekly check-in — three taps that move the calorie and macro
          targets at the top of this screen, so it lives here now rather than
          beside the coach check-in on Home. Only on today. */}
      {loaded && selected === todayIso() ? (
        <View style={styles.checkInWrap}>
          <WeeklyCheckIn stagger={9} />
        </View>
      ) : null}

      {/* Everything below is somewhere else to go, so it sits below everything
          the member came here to do. */}

      {/* GM suggestions (Gold+, today only) */}
      {loaded ? (
        <Animated.View entering={enterUp(9)}>
          <SuggestionsSection remaining={remaining} date={selected} />
        </Animated.View>
      ) : null}

      {/* Coach diet plan entry (SCALE-UP-PLAN §4.3) — the card is a light
          teaser; /coach-diet owns the full locked/no-coach/plans gate. */}
      {coachDietSection.kind !== 'hidden' ? (
        <Animated.View entering={enterUp(10)}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Coach diet plan"
            onPress={() => router.push('/coach-diet' as Href)}
            style={styles.copyRow}
          >
            <IconChip icon="nutrition-outline" />
            <View style={styles.copyInfo}>
              <AppText variant="bodyBold">Coach diet plan</AppText>
              <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
                {coachDietCaption(coachDietSection)}
              </AppText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
          </PressableScale>
        </Animated.View>
      ) : null}

      {/* Meal delivery teaser (plan §6 P12) — single entry point into the
          partner meal-delivery flow; /meals owns the full discovery/order/
          subscription surface. Same copyRow visual language as the coach diet
          card above it. */}
      <Animated.View entering={enterUp(11)}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Order meals for delivery"
          onPress={() => pushPath('/meals')}
          style={styles.copyRow}
        >
          <IconChip icon="bicycle-outline" />
          <View style={styles.copyInfo}>
            <AppText variant="bodyBold">Order meals</AppText>
            <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
              Delivery from local partners, one-time or weekly
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
        </PressableScale>
      </Animated.View>

      {/* Branded confirm for the long-press remove shortcut */}
      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Remove food"
        message={pendingDelete ? `Remove ${pendingDelete.foodName} from this day?` : undefined}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        danger
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) removeLog(target);
        }}
        onCancel={() => setPendingDelete(null)}
      />

      {/* Tap a logged row → full breakdown + Remove */}
      <Sheet
        visible={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setDetailLog(null);
          // Sheet gone, then the correction screen — never one over the other.
          const target = pendingEdit.current;
          pendingEdit.current = null;
          if (target) editLog(target);
        }}
        title={detailLog?.foodName}
      >
        {detailLog ? (
          <FoodLogDetailSheet
            log={detailLog}
            onEdit={(target) => {
              tapHaptic();
              pendingEdit.current = target;
              setDetailOpen(false);
            }}
            onRemove={(target) => {
              removeLog(target);
              setDetailOpen(false);
            }}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}
