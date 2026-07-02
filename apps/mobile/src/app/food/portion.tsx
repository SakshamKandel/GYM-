import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import type { FoodItem, Meal } from '@gym/shared';
import {
  AnimatedNumber,
  AppText,
  Button,
  Chip,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  Stepper,
} from '../../components/ui';
import { logHaptic } from '../../lib/haptics';
import { uid } from '../../lib/id';
import { getRepo } from '../../lib/repo';
import {
  MEALS,
  buildFoodLog,
  mealLabel,
  parseDateParam,
  parseMealParam,
  parseStringParam,
  portionMacros,
} from '../../features/nutrition/logic';
import { FOOD_TAB_HREF } from '../../features/nutrition/nav';

const styles = StyleSheet.create({
  // Screen already adds insets.top + 16 of air — keep the extra nudge tiny.
  headerRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  iconBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xl },
  name: { marginTop: spacing.lg },
  stepperWrap: { marginTop: spacing.xl, alignItems: 'center' },
  chipsRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  panel: {
    marginTop: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.lg,
  },
  kcalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  macroRow: { flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch' },
  macroBlock: { alignItems: 'center', gap: 2 },
  macroValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  macroValue: { fontSize: 24, lineHeight: 28 },
  mealsRow: {
    marginTop: spacing.xl,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  // paddingBottom keeps the button off the screen edge when insets.bottom is 0 (web).
  pinned: { marginTop: 'auto', paddingTop: spacing.md, paddingBottom: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
});

export default function PortionScreen() {
  const params = useLocalSearchParams<{ foodId?: string; meal?: string; date?: string }>();
  const foodId = parseStringParam(params.foodId);
  const date = parseDateParam(params.date);

  const [meal, setMeal] = useState<Meal>(parseMealParam(params.meal));
  const [food, setFood] = useState<FoodItem | null | undefined>(undefined);
  const [grams, setGrams] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void getRepo()
      .then((repo) => repo.getFood(foodId))
      .then((item) => {
        if (!active) return;
        setFood(item);
        if (item) setGrams(Math.max(5, Math.round(item.servingGrams ?? 100)));
      });
    return () => {
      active = false;
    };
  }, [foodId]);

  async function logIt(): Promise<void> {
    if (!food || grams === null || saving) return;
    setSaving(true);
    try {
      const repo = await getRepo();
      await repo.logFood(buildFoodLog({ id: uid(), date, meal, food, grams }));
      logHaptic();
      router.dismissTo(FOOD_TAB_HREF);
    } catch {
      setSaving(false);
    }
  }

  const back = (
    <Animated.View entering={enterDown(0)} style={styles.headerRow}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => router.back()}
        style={styles.iconBtn}
      >
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </PressableScale>
    </Animated.View>
  );

  if (food === null) {
    return (
      <Screen>
        {back}
        <View style={styles.center}>
          <AppText variant="title" center>
            Food not found
          </AppText>
          <Button label="Go back" variant="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  if (!food || grams === null) {
    return <Screen>{back}</Screen>;
  }

  const serving = food.servingGrams ? Math.max(5, Math.round(food.servingGrams)) : null;
  const macros = portionMacros(food, grams);
  const macroBlocks = [
    { label: 'Protein', value: macros.protein, color: colors.protein },
    { label: 'Carbs', value: macros.carbs, color: colors.carbs },
    { label: 'Fat', value: macros.fat, color: colors.fat },
  ];

  return (
    <Screen>
      {back}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={enterUp(0)}>
          <AppText variant="heading" numberOfLines={2} style={styles.name}>
            {food.name}
          </AppText>
          {food.brand ? (
            <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
              {food.brand}
            </AppText>
          ) : null}
        </Animated.View>

        <Animated.View entering={enterUp(1)}>
          <View style={styles.stepperWrap}>
            <Stepper
              value={grams}
              onChange={setGrams}
              step={5}
              min={5}
              max={2000}
              label="Grams"
              big
            />
          </View>
          <View style={styles.chipsRow}>
            <Chip label="100g" selected={grams === 100} onPress={() => setGrams(100)} />
            {serving ? (
              <Chip
                label={`1 serving · ${serving}g`}
                selected={grams === serving}
                onPress={() => setGrams(serving)}
              />
            ) : null}
            <Chip label="200g" selected={grams === 200} onPress={() => setGrams(200)} />
          </View>
        </Animated.View>

        <Animated.View entering={enterUp(2)} style={styles.panel}>
          <View>
            <AppText variant="label" center>
              Calories
            </AppText>
            <View style={styles.kcalRow}>
              <AnimatedNumber value={macros.kcal} variant="stat" />
              <AppText variant="caption" color={colors.textDim}>
                kcal
              </AppText>
            </View>
          </View>
          <View style={styles.macroRow}>
            {macroBlocks.map((m) => (
              <View key={m.label} style={styles.macroBlock}>
                <View style={styles.macroValueRow}>
                  <View style={[styles.dot, { backgroundColor: m.color }]} />
                  <AppText variant="display" style={styles.macroValue}>
                    {m.value}g
                  </AppText>
                </View>
                <AppText variant="caption" color={colors.textDim}>
                  {m.label}
                </AppText>
              </View>
            ))}
          </View>
        </Animated.View>

        <Animated.View entering={enterUp(3)} style={styles.mealsRow}>
          {MEALS.map(({ key, label }) => (
            <Chip key={key} label={label} selected={meal === key} onPress={() => setMeal(key)} />
          ))}
        </Animated.View>
      </ScrollView>

      <Animated.View entering={enterUp(4)} style={styles.pinned}>
        <Button
          label={`Log to ${mealLabel(meal).toLowerCase()}`}
          onPress={() => void logIt()}
          loading={saving}
        />
      </Animated.View>
    </Screen>
  );
}
