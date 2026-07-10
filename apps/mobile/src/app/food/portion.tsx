import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import type { FoodItem, Meal, NutriScore } from '@gym/shared';
import {
  AnimatedNumber,
  AppText,
  Button,
  Card,
  Chip,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  Stepper,
} from '../../components/ui';
import { logHaptic, tapHaptic } from '../../lib/haptics';
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
  // Header pattern (brief §5): eyebrow → big Oswald name. Food names can run
  // long, so this uses the 40px display size, not heroTitle.
  nameWrap: { marginTop: spacing.lg, gap: spacing.xs },
  name: { textTransform: 'uppercase' },
  stepperWrap: { marginTop: spacing.xl, alignItems: 'center' },
  chipsRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  // Cream counterpoint block — macro preview, black ink only (brief §2).
  panelWrap: { marginTop: spacing.xl },
  panel: { alignItems: 'center', gap: spacing.lg },
  kcalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  macroRow: { flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch' },
  macroCol: { alignItems: 'center', gap: spacing.xs },
  macroValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  macroValue: { fontSize: 28, lineHeight: 32 },
  macroLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: radius.full },
  mealsRow: {
    marginTop: spacing.xl,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  // paddingBottom keeps the button off the screen edge when insets.bottom is 0 (web).
  pinned: { marginTop: 'auto', paddingTop: spacing.md, paddingBottom: spacing.md },
  error: { marginBottom: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  /** Food-quality chips (Nutri-Score / NOVA) under the name. */
  qualityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  qualityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  qualityDot: { width: 8, height: 8, borderRadius: radius.full },
  /** Fiber/sugar/sodium line inside the cream macro panel. */
  microRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignSelf: 'stretch',
  },
  microCol: { alignItems: 'center', gap: 2 },
});

const NUTRI_COLORS: Record<NutriScore, string> = {
  a: colors.success,
  b: colors.success,
  c: colors.warning,
  d: colors.error,
  e: colors.error,
};

const NOVA_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: 'Whole food',
  2: 'Culinary ingredient',
  3: 'Processed',
  4: 'Ultra-processed',
};

function novaColor(group: 1 | 2 | 3 | 4): string {
  return group === 4 ? colors.error : group === 3 ? colors.warning : colors.success;
}

/** Nutri-Score + NOVA chips — rendered only when the source knows them. */
function QualityChips({ food }: { food: FoodItem }) {
  const score = food.nutriScore ?? null;
  const nova = food.novaGroup ?? null;
  if (!score && !nova) return null;
  return (
    <View style={styles.qualityRow}>
      {score ? (
        <View
          style={styles.qualityChip}
          accessibilityLabel={`Nutri-Score ${score.toUpperCase()}`}
        >
          <View style={[styles.qualityDot, { backgroundColor: NUTRI_COLORS[score] }]} />
          <AppText variant="label" color={colors.text}>
            {`Nutri-Score ${score.toUpperCase()}`}
          </AppText>
        </View>
      ) : null}
      {nova ? (
        <View
          style={styles.qualityChip}
          accessibilityLabel={`Processing level: ${NOVA_LABELS[nova]}`}
        >
          <View style={[styles.qualityDot, { backgroundColor: novaColor(nova) }]} />
          <AppText variant="label" color={colors.text}>
            {NOVA_LABELS[nova]}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

export default function PortionScreen() {
  const params = useLocalSearchParams<{ foodId?: string; meal?: string; date?: string }>();
  const foodId = parseStringParam(params.foodId);
  const date = parseDateParam(params.date);

  const [meal, setMeal] = useState<Meal>(parseMealParam(params.meal));
  const [food, setFood] = useState<FoodItem | null | undefined>(undefined);
  const [grams, setGrams] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void getRepo()
      .then((repo) => repo.getFood(foodId))
      .then((item) => {
        if (!active) return;
        setFood(item);
        if (item) setGrams(Math.max(5, Math.round(item.servingGrams ?? 100)));
      })
      .catch(() => {
        // A rejected lookup renders the explicit "Food not found" branch
        // instead of stranding the screen blank with an unhandled rejection.
        if (active) setFood(null);
      });
    return () => {
      active = false;
    };
  }, [foodId]);

  async function logIt(): Promise<void> {
    if (!food || grams === null || saving) return;
    setSaving(true);
    setError(false);
    try {
      const repo = await getRepo();
      await repo.logFood(buildFoodLog({ id: uid(), date, meal, food, grams }));
      logHaptic();
      router.dismissTo(FOOD_TAB_HREF);
    } catch {
      setError(true);
      setSaving(false);
    }
  }

  function pickGrams(next: number): void {
    tapHaptic();
    setGrams(next);
  }

  function pickMeal(next: Meal): void {
    tapHaptic();
    setMeal(next);
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
  ] as const;
  // Scaled micro-nutrients — only the ones this food's source actually knows.
  const scale = grams / 100;
  const microBlocks = [
    food.fiberPer100 != null
      ? { label: 'Fiber', text: `${Math.round(food.fiberPer100 * scale * 10) / 10} g` }
      : null,
    food.sugarPer100 != null
      ? { label: 'Sugar', text: `${Math.round(food.sugarPer100 * scale * 10) / 10} g` }
      : null,
    food.sodiumPer100 != null
      ? { label: 'Sodium', text: `${Math.round(food.sodiumPer100 * scale)} mg` }
      : null,
  ].filter((m): m is { label: string; text: string } => m !== null);

  return (
    <Screen>
      {back}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={enterUp(0)} style={styles.nameWrap}>
          <AppText variant="label" numberOfLines={1}>
            {food.brand ? food.brand : 'Log food'}
          </AppText>
          <AppText variant="display" numberOfLines={2} style={styles.name}>
            {food.name}
          </AppText>
          <QualityChips food={food} />
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
            <Chip label="100g" selected={grams === 100} onPress={() => pickGrams(100)} />
            {serving ? (
              <Chip
                label={`1 serving · ${serving}g`}
                selected={grams === serving}
                onPress={() => pickGrams(serving)}
              />
            ) : null}
            <Chip label="200g" selected={grams === 200} onPress={() => pickGrams(200)} />
          </View>
        </Animated.View>

        <Animated.View entering={enterUp(2)} style={styles.panelWrap}>
          <Card variant="cream" style={styles.panel}>
            <View>
              <AppText variant="label" color={colors.creamDim} center>
                Calories
              </AppText>
              <View style={styles.kcalRow}>
                <AnimatedNumber value={macros.kcal} variant="stat" color={colors.onBlock} />
                <AppText variant="caption" color={colors.creamDim}>
                  kcal
                </AppText>
              </View>
            </View>
            <View style={styles.macroRow}>
              {macroBlocks.map((m) => (
                <View
                  key={m.label}
                  style={styles.macroCol}
                  accessibilityLabel={`${m.label}: ${Math.round(m.value)} g`}
                >
                  <View style={styles.macroValueRow}>
                    <AppText variant="display" style={styles.macroValue} color={colors.onBlock}>
                      {Math.round(m.value)}
                    </AppText>
                    <AppText variant="caption" color={colors.creamDim} tabular={false}>
                      g
                    </AppText>
                  </View>
                  <View style={styles.macroLabelRow}>
                    <View style={[styles.dot, { backgroundColor: m.color }]} />
                    <AppText variant="label" color={colors.creamDim}>
                      {m.label}
                    </AppText>
                  </View>
                </View>
              ))}
            </View>
            {microBlocks.length > 0 ? (
              <View style={styles.microRow}>
                {microBlocks.map((m) => (
                  <View
                    key={m.label}
                    style={styles.microCol}
                    accessibilityLabel={`${m.label}: ${m.text}`}
                  >
                    <AppText variant="bodyBold" color={colors.onBlock} tabular>
                      {m.text}
                    </AppText>
                    <AppText variant="label" color={colors.creamDim}>
                      {m.label}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : null}
          </Card>
        </Animated.View>

        <Animated.View entering={enterUp(3)} style={styles.mealsRow}>
          {MEALS.map(({ key, label }) => (
            <Chip key={key} label={label} selected={meal === key} onPress={() => pickMeal(key)} />
          ))}
        </Animated.View>
      </ScrollView>

      <Animated.View entering={enterUp(4)} style={styles.pinned}>
        {error ? (
          <AppText variant="caption" color={colors.error} center style={styles.error}>
            {"Couldn't save — try again."}
          </AppText>
        ) : null}
        <Button
          label={`Log to ${mealLabel(meal).toLowerCase()}`}
          onPress={() => void logIt()}
          loading={saving}
        />
      </Animated.View>
    </Screen>
  );
}
