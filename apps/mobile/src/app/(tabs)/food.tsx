import { useState, type ComponentProps } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import type { FoodLog, Meal } from '@gym/shared';
import {
  AnimatedNumber,
  AppText,
  Button,
  CategoryTile,
  DayStrip,
  Divider,
  enterDown,
  enterUp,
  FLOATING_TAB_SPACE,
  HeroCard,
  IconChip,
  layoutSpring,
  MacroBar,
  PressableScale,
  Ring,
  Screen,
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
  defaultMealForHour,
  groupByMeal,
  kcalRingState,
  litres,
  remainingMacros,
  sumDayTotals,
  sumKcal,
} from '../../features/nutrition/logic';
import { searchHref } from '../../features/nutrition/nav';
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
  heroLeft: { flexShrink: 1 },
  ringCenter: { alignItems: 'center' },
  ringValue: { fontSize: 24, lineHeight: 28 },
  heroMacros: { marginTop: spacing.sm, gap: spacing.lg },
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
  mealHeader: {
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  mealName: { flex: 1 },
  mealKcal: { fontFamily: type.display, fontSize: 18, color: colors.text },
  mealKcalUnit: { fontFamily: type.display, fontSize: 12, letterSpacing: 1 },
  mealKcalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  logInfo: { flex: 1 },
  logKcalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  logKcal: { fontFamily: type.display, fontSize: 18, color: colors.text },
  addRow: { minHeight: 48, justifyContent: 'center' },
  empty: {
    marginTop: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyButton: { alignSelf: 'stretch', marginTop: spacing.md },
  waterPressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  waterTileInner: { pointerEvents: 'none' },
});

function confirmDelete(name: string, onConfirm: () => void): void {
  if (Platform.OS === 'web') {
    // Alert.alert is a no-op on react-native-web.
    if (window.confirm(`Remove ${name} from this day?`)) onConfirm();
    return;
  }
  Alert.alert('Remove food', `Remove ${name} from this day?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: onConfirm },
  ]);
}

export default function FoodScreen() {
  const [selected, setSelected] = useState(todayIso());
  const [copying, setCopying] = useState(false);
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

  function onDeleteLog(log: FoodLog): void {
    confirmDelete(log.foodName, () => {
      logHaptic();
      void deleteLog(log.id);
    });
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

      {/* Hero: eaten kcal counts up, adherence-neutral ring, macro bars below */}
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
          <View style={styles.heroMacros}>
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
              delay={220}
            />
            <MacroBar
              label="Fat"
              current={totals.fat}
              target={targets.fat}
              color={colors.fat}
              delay={320}
            />
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
          onPress={() => {
            tapHaptic();
            void addWater(250);
          }}
          onLongPress={() => {
            if (waterMl <= 0) return;
            tapHaptic();
            void addWater(-250);
          }}
          style={({ pressed }) => (pressed ? styles.waterPressed : null)}
        >
          <View
            style={styles.waterTileInner}
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
          </View>
        </Pressable>
        <AppText variant="caption" color={colors.textDim} style={styles.waterCaption} tabular>
          target {litres(targets.waterMl)}L · tap +250ml · hold −250ml
        </AppText>
      </Animated.View>

      {/* Meals */}
      {!loaded ? null : logs.length === 0 ? (
        <Animated.View entering={enterUp(4)} style={styles.empty}>
          <AppText variant="title" center>
            Nothing logged yet
          </AppText>
          <AppText variant="caption" color={colors.textDim} center>
            Log your first food of the day
          </AppText>
          <Button
            label="Add food"
            onPress={() =>
              router.push(searchHref(defaultMealForHour(new Date().getHours()), selected))
            }
            style={styles.emptyButton}
          />
        </Animated.View>
      ) : (
        MEALS.map(({ key, label }, mealIndex) => {
          const items = grouped[key];
          return (
            <Animated.View key={key} entering={enterUp(4 + mealIndex)} layout={layoutSpring}>
              <View style={styles.mealHeader}>
                <IconChip icon={MEAL_ICONS[key]} />
                <AppText variant="bodyBold" style={styles.mealName}>
                  {label}
                </AppText>
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
              {items.map((log) => (
                <Animated.View key={log.id} entering={enterUp(0)} layout={layoutSpring}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${log.foodName}, ${Math.round(log.grams)} grams, ${Math.round(log.kcal)} calories. Long press to remove.`}
                    onLongPress={() => onDeleteLog(log)}
                    style={styles.logRow}
                  >
                    <View style={styles.logInfo}>
                      <AppText variant="body" numberOfLines={1}>
                        {log.foodName}
                      </AppText>
                      <AppText variant="caption" color={colors.textDim} tabular>
                        {Math.round(log.grams)} g
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
                  </Pressable>
                  <Divider />
                </Animated.View>
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Add food to ${label}`}
                onPress={() => {
                  tapHaptic();
                  router.push(searchHref(key, selected));
                }}
                style={styles.addRow}
              >
                <AppText variant="bodyBold" color={colors.textDim}>
                  + Add
                </AppText>
              </Pressable>
            </Animated.View>
          );
        })
      )}
    </Screen>
  );
}
