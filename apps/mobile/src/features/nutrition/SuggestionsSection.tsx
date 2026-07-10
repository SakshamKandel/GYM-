import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { hasEntitlement } from '@gym/shared';
import { colors, spacing, type } from '@gym/ui-tokens';
import {
  AppText,
  Card,
  enterUp,
  SectionLabel,
  UpgradePrompt,
} from '../../components/ui';
import { todayIso } from '../../lib/dates';
import { getRepo } from '../../lib/repo';
import { useEffectiveTier } from '../../lib/tier';
import { defaultMealForHour, type DayTotals } from './logic';
import { portionHref } from './nav';
import { suggestFoods, type FoodSuggestion } from './suggestions';

/**
 * "GM suggestions" — Gold-tier picks matched to the macros left today.
 * Renders on the Food tab for TODAY only; below Gold it sells the feature.
 * Tap a card → the food is saved locally and the portion screen opens,
 * so logging a pick is two taps.
 *
 * Block language: a horizontal rail of cream mini-blocks — black ink on
 * `blockCream`, secondary text `creamDim`, Oswald kcal (brief §2/§11).
 */

interface Props {
  /** Targets − eaten, floored at 0 (see remainingMacros in logic.ts). */
  remaining: DayTotals;
  /** The date the Food tab is showing (ISO). */
  date: string;
}

const styles = StyleSheet.create({
  row: { gap: spacing.md },
  card: {
    width: 200,
    gap: spacing.sm,
    justifyContent: 'space-between',
    flexGrow: 1,
  },
  kcalRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  kcal: { fontFamily: type.display, fontSize: 24, lineHeight: 28, color: colors.onBlock },
});

function portionText(s: FoodSuggestion): string {
  return `${s.food.servingLabel ?? '1 serving'} · ${s.grams}g`;
}

/** Save the pick locally, then open the portion screen (meal inferred by time). */
function logSuggestion(s: FoodSuggestion, date: string): void {
  void (async () => {
    const repo = await getRepo();
    await repo.saveFood(s.food);
    router.push(portionHref(s.food.id, defaultMealForHour(new Date().getHours()), date));
  })();
}

export function SuggestionsSection({ remaining, date }: Props) {
  const tier = useEffectiveTier();
  const isToday = date === todayIso();
  const unlocked = hasEntitlement({ tier }, 'food_suggestions');

  const { kcal, protein, carbs, fat } = remaining;
  const suggestions = useMemo(
    () => (isToday && unlocked ? suggestFoods({ kcal, protein, carbs, fat }) : []),
    [isToday, unlocked, kcal, protein, carbs, fat],
  );

  if (!isToday) return null;

  if (!unlocked) {
    return (
      <View>
        <SectionLabel>GM suggestions</SectionLabel>
        <UpgradePrompt
          title="GM food suggestions"
          description="Greece's picks matched to the macros you have left today."
          requiredTier="silver"
        />
      </View>
    );
  }

  if (suggestions.length === 0) return null;

  return (
    <View>
      <SectionLabel>GM suggestions</SectionLabel>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {suggestions.map((s, i) => (
          <Animated.View key={s.food.id} entering={enterUp(i)}>
            <Card
              variant="cream"
              onPress={() => logSuggestion(s, date)}
              accessibilityLabel={`${s.food.name}, ${portionText(s)}, ${s.kcal} calories. Tap to log.`}
              style={styles.card}
            >
              <AppText variant="bodyBold" color={colors.onBlock} numberOfLines={2}>
                {s.food.name}
              </AppText>
              <AppText variant="caption" color={colors.creamDim} numberOfLines={1}>
                {portionText(s)}
              </AppText>
              <View style={styles.kcalRow}>
                <AppText style={styles.kcal} tabular>
                  {s.kcal}
                </AppText>
                <AppText variant="caption" color={colors.creamDim}>
                  kcal
                </AppText>
              </View>
              <AppText variant="caption" color={colors.creamDim} numberOfLines={2}>
                {s.line}
              </AppText>
            </Card>
          </Animated.View>
        ))}
      </ScrollView>
    </View>
  );
}
