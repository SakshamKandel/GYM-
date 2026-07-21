import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Card, MacroBar, PressableScale, ProgressBar } from '../ui';
import { litres } from '../../features/nutrition/logic';
import { tapHaptic } from '../../lib/haptics';

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleArea: {
    gap: 2,
  },
  macroRow: {
    gap: spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderStrong,
    marginVertical: spacing.xs,
  },
  waterSection: {
    gap: spacing.sm,
  },
  waterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  waterControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  waterBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

interface NutritionHomeCardProps {
  eatenKcal: number;
  targetKcal: number;
  protein: number;
  targetProtein: number;
  carbs: number;
  targetCarbs: number;
  fat: number;
  targetFat: number;
  waterMl: number;
  targetWaterMl: number;
  onAddWater: (deltaMl: number) => void;
}

export const NutritionHomeCard = memo(function NutritionHomeCard({
  eatenKcal,
  targetKcal,
  protein,
  targetProtein,
  carbs,
  targetCarbs,
  fat,
  targetFat,
  waterMl,
  targetWaterMl,
  onAddWater,
}: NutritionHomeCardProps) {
  const remainingKcal = Math.max(0, targetKcal - eatenKcal);

  const handleOpenFood = () => {
    tapHaptic();
    router.push('/(tabs)/food');
  };

  return (
    <Card style={styles.container}>
      <PressableScale onPress={handleOpenFood} accessibilityLabel="Open food log">
        <View style={styles.headerRow}>
          <View style={styles.titleArea}>
            <AppText variant="label" color={colors.textDim}>
              Daily Nutrition
            </AppText>
            <AppText variant="title">
              {eatenKcal} <AppText variant="body" color={colors.textDim}>/ {targetKcal} kcal</AppText>
            </AppText>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <AppText variant="caption" color={colors.textDim}>
              {remainingKcal > 0 ? `${remainingKcal} left` : 'Goal met!'}
            </AppText>
            <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
          </View>
        </View>
      </PressableScale>

      {/* Macro Breakdown */}
      <View style={styles.macroRow}>
        <MacroBar
          label="Protein"
          current={protein}
          target={targetProtein}
          color={colors.protein}
        />
        <MacroBar
          label="Carbs"
          current={carbs}
          target={targetCarbs}
          color={colors.carbs}
        />
        <MacroBar
          label="Fat"
          current={fat}
          target={targetFat}
          color={colors.fat}
        />
      </View>

      <View style={styles.divider} />

      {/* Hydration Section */}
      <View style={styles.waterSection}>
        <View style={styles.waterHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Ionicons name="water" size={18} color={colors.accent} />
            <AppText variant="bodyBold">
              {litres(waterMl)}L <AppText variant="caption" color={colors.textDim}>/ {litres(targetWaterMl)}L water</AppText>
            </AppText>
          </View>

          <View style={styles.waterControls}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Remove 250 millilitres water"
              onPress={() => {
                tapHaptic();
                onAddWater(-250);
              }}
              disabled={waterMl <= 0}
              style={styles.waterBtn}
            >
              <AppText variant="bodyBold" color={colors.textDim}>-250</AppText>
            </PressableScale>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Add 250 millilitres water"
              onPress={() => {
                tapHaptic();
                onAddWater(250);
              }}
              style={styles.waterBtn}
            >
              <AppText variant="bodyBold" color={colors.accent}>+250ml</AppText>
            </PressableScale>
          </View>
        </View>
        <ProgressBar
          value={targetWaterMl > 0 ? waterMl / targetWaterMl : 0}
          height={8}
          fillColor={colors.accent}
        />
      </View>
    </Card>
  );
});
