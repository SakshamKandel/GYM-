import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import type { FoodLog } from '@gym/shared';
import { colors, spacing } from '@gym/ui-tokens';
import { AnimatedNumber, AppText, Button, Divider, MacroRing } from '../../components/ui';
import { mealLabel } from './logic';

/**
 * Rich breakdown for one logged food, shown inside a <Sheet> from the Food tab.
 * Tapping a log row reveals its meal + portion, a kcal count-up, the three
 * macros as rings, and a Remove action — matching the StreakDetailSheet bar of
 * detail. All motion is either user-driven (the sheet) or a quiet count-up that
 * lands instantly under reduced motion; passive content never slides.
 */

interface Props {
  log: FoodLog;
  onRemove: (log: FoodLog) => void;
}

const styles = StyleSheet.create({
  meta: { marginBottom: spacing.sm },
  kcalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 },
  macroRow: {
    marginTop: spacing.xl,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  dividerWrap: { marginTop: spacing.xl, marginBottom: spacing.lg },
});

export function FoodLogDetailSheet({ log, onRemove }: Props) {
  const reduceMotion = useReducedMotion();
  const kcal = Math.round(log.kcal);

  // Count up from zero on open; land immediately when motion is reduced.
  const [shown, setShown] = useState(reduceMotion ? kcal : 0);
  useEffect(() => {
    if (reduceMotion) return;
    const id = requestAnimationFrame(() => setShown(kcal));
    return () => cancelAnimationFrame(id);
  }, [kcal, reduceMotion]);

  const meal = mealLabel(log.meal);

  return (
    <View>
      <View style={styles.meta}>
        <AppText variant="label" tabular>
          {meal} · {Math.round(log.grams)} g
        </AppText>
        <View
          style={styles.kcalRow}
          accessible
          accessibilityLabel={`${kcal} calories`}
        >
          <AnimatedNumber value={shown} variant="stat" />
          <AppText variant="caption" color={colors.textDim}>
            kcal
          </AppText>
        </View>
      </View>

      <View style={styles.macroRow}>
        <MacroRing label="Protein" current={log.protein} color={colors.protein} delay={120} />
        <MacroRing label="Carbs" current={log.carbs} color={colors.carbs} delay={190} />
        <MacroRing label="Fat" current={log.fat} color={colors.fat} delay={260} />
      </View>

      <View style={styles.dividerWrap}>
        <Divider />
      </View>

      <Button
        label={`Remove from ${meal.toLowerCase()}`}
        variant="danger"
        onPress={() => onRemove(log)}
      />
    </View>
  );
}
