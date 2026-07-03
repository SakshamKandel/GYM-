import { useState, type ComponentProps } from 'react';
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
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import type { FoodLog, Meal } from '@gym/shared';
import {
  AnimatedNumber,
  AppText,
  CategoryTile,
  ConfirmDialog,
  DayStrip,
  enterDown,
  enterUp,
  FLOATING_TAB_SPACE,
  HeroCard,
  IconChip,
  layoutSpring,
  MacroRing,
  PRESS_SPRING,
  PressableScale,
  Ring,
  Screen,
  Sheet,
} from '../../components/ui';
import { logHaptic, tapHaptic } from '../../lib/haptics';
import { posterDate, todayIso } from '../../lib/dates';
import { uid } from '../../lib/id';
import { useProfile } from '../../state/profile';
import {
  MEALS,
  STRIP_DAYS_BACK,
  STRIP_DAYS_FORWARD,
  cloneLogsToDate,
  groupByMeal,
  kcalRingState,
  litres,
  remainingMacros,
  sumDayTotals,
  sumKcal,
} from '../../features/nutrition/logic';
import { searchHref } from '../../features/nutrition/nav';
import { FoodLogDetailSheet } from '../../features/nutrition/FoodLogDetailSheet';
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
  // Screen already adds insets.top + 16 of air — keep the extra nudge tiny.
  headerLabel: { marginTop: spacing.xs },
  strip: { marginTop: spacing.md },
  hero: { marginTop: spacing.lg },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  heroLeft: { flexShrink: 1, minWidth: 0 },
  ringCenter: { alignItems: 'center' },
  ringValue: { fontSize: 24, lineHeight: 28 },
  // Consumed label + macro-ring trio.
  heroMacrosWrap: { marginTop: spacing.xl },
  heroMacrosLabel: { marginBottom: spacing.md },
  heroMacros: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  copyRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  copyInfo: { flex: 1 },
  waterWrap: { marginTop: spacing.xl },
  waterCaption: { marginTop: spacing.sm },
  mealBlock: { marginTop: spacing.xl },
  mealHeader: {
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  mealHeaderText: { flex: 1, minWidth: 0 },
  mealMacroLine: { marginTop: 1 },
  mealKcal: { fontFamily: type.display, fontSize: 20, color: colors.text },
  mealKcalUnit: { fontFamily: type.display, fontSize: 12, letterSpacing: 1 },
  mealKcalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, flexShrink: 0 },
  // Logged items sit on their own surface card, one rounded block per meal.
  logCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    overflow: 'hidden',
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  logDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  logInfo: { flex: 1, minWidth: 0 },
  logMacro: { marginTop: 1 },
  logKcalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, flexShrink: 0 },
  logKcal: { fontFamily: type.display, fontSize: 18, color: colors.text },
  addRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    alignSelf: 'flex-start',
  },
  addRowPressed: { borderColor: colors.text },
  // Ghost meal cards for the empty state.
  ghostWrap: { marginTop: spacing.xl, gap: spacing.md },
  ghostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    minHeight: 72,
  },
  ghostText: { flex: 1 },
  emptyIntro: { marginTop: spacing.xl, alignItems: 'center', gap: spacing.xs },
  waterPressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  waterTileInner: { pointerEvents: 'none' },
});

// Ease for the water tile's add-confirmation pop (a user-driven settle).
const EASE_OUT = Easing.bezier(0.25, 0.8, 0.4, 1);

/** Compact "P XX · C XX · F XX" macro line shared by meal headers and rows. */
function macroLine(protein: number, carbs: number, fat: number): string {
  return `P ${Math.round(protein)} · C ${Math.round(carbs)} · F ${Math.round(fat)}`;
}

export default function FoodScreen() {
  const [selected, setSelected] = useState(todayIso());
  const [copying, setCopying] = useState(false);
  const reduceMotion = useReducedMotion();
  // Long-press delete goes through the branded ConfirmDialog; a tap opens the
  // detail sheet whose Remove button deletes directly (the sheet is the review).
  const [pendingDelete, setPendingDelete] = useState<FoodLog | null>(null);
  const [detailLog, setDetailLog] = useState<FoodLog | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const waterPop = useSharedValue(1);
  const waterPopStyle = useAnimatedStyle(() => ({ transform: [{ scale: waterPop.value }] }));
  const targets = useProfile((s) => s.targets);
  const { loaded, logs, waterMl, marked, yesterdayLogs, addWater, deleteLog, copyLogs } =
    useNutritionDay(selected);

  const totals = sumDayTotals(logs);
  const remaining = remainingMacros(targets, totals);
  const eaten = Math.round(totals.kcal);
  const ring = kcalRingState(eaten, targets.kcal);
  const grouped = groupByMeal(logs);

  // One-tap "copy yesterday": today, still empty, and yesterday has something.
  const showCopyYesterday =
    loaded && selected === todayIso() && logs.length === 0 && yesterdayLogs.length > 0;
  const yesterdayKcal = sumKcal(yesterdayLogs);

  function openDetail(log: FoodLog): void {
    tapHaptic();
    setDetailLog(log);
    setDetailOpen(true);
  }

  function requestDelete(log: FoodLog): void {
    tapHaptic();
    setPendingDelete(log);
  }

  function removeLog(log: FoodLog): void {
    logHaptic();
    void deleteLog(log.id);
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
      <Animated.View entering={enterDown(0)}>
        <AppText variant="label" style={styles.headerLabel}>
          {posterDate(selected)}
        </AppText>
        <AppText variant="heading">Food</AppText>
      </Animated.View>

      <Animated.View entering={enterDown(1)} style={styles.strip}>
        <DayStrip
          selected={selected}
          onSelect={setSelected}
          markedDates={marked}
          daysBack={STRIP_DAYS_BACK}
          daysForward={STRIP_DAYS_FORWARD}
        />
      </Animated.View>

      {/* Hero: eaten kcal counts up next to an adherence-neutral ring; below,
          the three macros as parallel rings so "consumed" reads at a glance. */}
      <Animated.View entering={enterUp(0)}>
        <HeroCard style={styles.hero}>
          <View style={styles.heroRow}>
            <View style={styles.heroLeft}>
              <AppText variant="label">Calories</AppText>
              <AnimatedNumber value={eaten} variant="stat" />
              <AppText variant="caption" color={colors.textDim}>
                of {targets.kcal} kcal
              </AppText>
            </View>
            <Ring
              size={88}
              strokeWidth={8}
              progress={targets.kcal > 0 ? eaten / targets.kcal : 0}
              color={colors.kcal}
            >
              <View style={styles.ringCenter}>
                <AppText
                  variant="display"
                  style={styles.ringValue}
                  color={ring.over ? colors.textDim : colors.text}
                >
                  {ring.value}
                </AppText>
                <AppText variant="caption" color={colors.textDim}>
                  {ring.caption}
                </AppText>
              </View>
            </Ring>
          </View>

          <View style={styles.heroMacrosWrap}>
            <AppText variant="label" style={styles.heroMacrosLabel}>
              Consumed
            </AppText>
            <View style={styles.heroMacros}>
              <MacroRing
                label="Protein"
                current={totals.protein}
                target={targets.protein}
                color={colors.protein}
                delay={120}
              />
              <MacroRing
                label="Carbs"
                current={totals.carbs}
                target={targets.carbs}
                color={colors.carbs}
                delay={200}
              />
              <MacroRing
                label="Fat"
                current={totals.fat}
                target={targets.fat}
                color={colors.fat}
                delay={280}
              />
            </View>
          </View>
        </HeroCard>
      </Animated.View>

      {/* Copy yesterday — a full day of logging in one tap */}
      {showCopyYesterday ? (
        <Animated.View entering={enterUp(1)} layout={layoutSpring}>
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

      {/* GM suggestions (Gold+, today only) */}
      {loaded ? (
        <Animated.View entering={enterUp(2)}>
          <SuggestionsSection remaining={remaining} date={selected} />
        </Animated.View>
      ) : null}

      {/* Water */}
      <Animated.View entering={enterUp(3)} style={styles.waterWrap}>
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
            <CategoryTile
              title="Water"
              value={litres(waterMl)}
              unit="L"
              icon="water"
              color={colors.blue}
              deepColor={colors.blueDeep}
            />
          </Animated.View>
        </Pressable>
        <AppText variant="caption" color={colors.textDim} style={styles.waterCaption} tabular>
          target {litres(targets.waterMl)}L · tap +250ml · hold −250ml
        </AppText>
      </Animated.View>

      {/* Meals */}
      {!loaded ? null : logs.length === 0 ? (
        <Animated.View entering={enterUp(4)}>
          <View style={styles.emptyIntro}>
            <AppText variant="title" center>
              Nothing logged yet
            </AppText>
            <AppText variant="caption" color={colors.textDim} center>
              Tap a meal to add your first food of the day
            </AppText>
          </View>
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
              style={styles.mealBlock}
            >
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
                    <AppText variant="caption" color={colors.textFaint}>
                      Nothing yet
                    </AppText>
                  )}
                </View>
                {items.length > 0 ? (
                  <View style={styles.mealKcalRow}>
                    <AppText style={styles.mealKcal} tabular>
                      {sumKcal(items)}
                    </AppText>
                    <AppText style={styles.mealKcalUnit} color={colors.textFaint} tabular={false}>
                      KCAL
                    </AppText>
                  </View>
                ) : null}
              </View>

              {items.length > 0 ? (
                <View style={styles.logCard}>
                  {items.map((log, i) => (
                    <Animated.View key={log.id} entering={enterUp(0)} layout={layoutSpring}>
                      {i > 0 ? <View style={styles.logDivider} /> : null}
                      <PressableScale
                        accessibilityRole="button"
                        accessibilityLabel={`${log.foodName}, ${Math.round(log.grams)} grams, ${Math.round(log.kcal)} calories. Tap for details, long press to remove.`}
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
                            color={colors.textFaint}
                            style={styles.logMacro}
                            tabular
                            numberOfLines={1}
                          >
                            {Math.round(log.grams)} g · {macroLine(log.protein, log.carbs, log.fat)}
                          </AppText>
                        </View>
                        <View style={styles.logKcalRow}>
                          <AppText style={styles.logKcal} tabular>
                            {Math.round(log.kcal)}
                          </AppText>
                          <AppText variant="caption" color={colors.textFaint}>
                            kcal
                          </AppText>
                        </View>
                      </PressableScale>
                    </Animated.View>
                  ))}
                </View>
              ) : null}

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
            </Animated.View>
          );
        })
      )}

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
        }}
        title={detailLog?.foodName}
      >
        {detailLog ? (
          <FoodLogDetailSheet
            log={detailLog}
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
