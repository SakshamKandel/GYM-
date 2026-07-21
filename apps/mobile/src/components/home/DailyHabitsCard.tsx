import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Card, PressableScale } from '../ui';
import { tapHaptic } from '../../lib/haptics';
import { toHref } from '../../features/engagement/logic';

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  habitList: {
    gap: spacing.xs,
  },
  habitItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
    borderRadius: radius.md,
    minHeight: 52,
  },
  habitIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  habitIconDone: {
    backgroundColor: colors.blockRed,
  },
  habitText: {
    flex: 1,
    gap: 2,
  },
});

interface DailyHabitsCardProps {
  workoutDone: boolean;
  workoutName?: string | null;
  nextWorkoutId?: string | null;
  eatenKcal: number;
  targetKcal: number;
  waterMl: number;
  targetWaterMl: number;
  weighedInToday: boolean;
  lastWeightText?: string | null;
  onAddWater: () => void;
}

export const DailyHabitsCard = memo(function DailyHabitsCard({
  workoutDone,
  workoutName,
  nextWorkoutId,
  eatenKcal,
  targetKcal,
  waterMl,
  targetWaterMl,
  weighedInToday,
  lastWeightText,
  onAddWater,
}: DailyHabitsCardProps) {
  const waterMet = targetWaterMl > 0 && waterMl >= targetWaterMl;
  const kcalLogged = eatenKcal > 0;

  const totalDone = [workoutDone, kcalLogged, waterMet, weighedInToday].filter(Boolean).length;

  const handleWorkoutTap = () => {
    tapHaptic();
    if (nextWorkoutId) {
      router.push(toHref(`/workout/start?planWorkoutId=${nextWorkoutId}`));
    } else {
      router.push('/(tabs)/train');
    }
  };

  const handleFoodTap = () => {
    tapHaptic();
    router.push('/(tabs)/food');
  };

  const handleWaterTap = () => {
    tapHaptic();
    onAddWater();
  };

  const handleWeightTap = () => {
    tapHaptic();
    router.push(toHref('/body/log-weight'));
  };

  return (
    <Card style={styles.container}>
      <View style={styles.headerRow}>
        <AppText variant="label" color={colors.textDim}>
          Today&apos;s Readiness & Habits
        </AppText>
        <AppText variant="caption" color={colors.textDim} tabular>
          {totalDone} of 4 completed
        </AppText>
      </View>

      <View style={styles.habitList}>
        {/* Habit 1: Workout */}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Workout status: ${workoutDone ? 'Completed' : 'Pending'}`}
          onPress={handleWorkoutTap}
          style={styles.habitItem}
        >
          <View style={[styles.habitIcon, workoutDone && styles.habitIconDone]}>
            <Ionicons
              name={workoutDone ? 'checkmark' : 'barbell-outline'}
              size={18}
              color={workoutDone ? colors.onBlock : colors.text}
            />
          </View>
          <View style={styles.habitText}>
            <AppText variant="bodyBold">
              {workoutDone ? 'Workout Done' : 'Daily Workout'}
            </AppText>
            <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
              {workoutDone
                ? workoutName ?? 'Session logged'
                : workoutName
                ? `Up next: ${workoutName}`
                : 'Choose a workout'}
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
        </PressableScale>

        {/* Habit 2: Nutrition */}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Nutrition status"
          onPress={handleFoodTap}
          style={styles.habitItem}
        >
          <View style={[styles.habitIcon, kcalLogged && styles.habitIconDone]}>
            <Ionicons
              name={kcalLogged ? 'checkmark' : 'restaurant-outline'}
              size={18}
              color={kcalLogged ? colors.onBlock : colors.text}
            />
          </View>
          <View style={styles.habitText}>
            <AppText variant="bodyBold">Nutrition</AppText>
            <AppText variant="caption" color={colors.textDim}>
              {kcalLogged ? `${eatenKcal} / ${targetKcal} kcal logged` : 'Tap to log food'}
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
        </PressableScale>

        {/* Habit 3: Hydration */}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Hydration status"
          onPress={handleWaterTap}
          style={styles.habitItem}
        >
          <View style={[styles.habitIcon, waterMet && styles.habitIconDone]}>
            <Ionicons
              name={waterMet ? 'checkmark' : 'water-outline'}
              size={18}
              color={waterMet ? colors.onBlock : colors.accent}
            />
          </View>
          <View style={styles.habitText}>
            <AppText variant="bodyBold">Hydration</AppText>
            <AppText variant="caption" color={colors.textDim}>
              {waterMl > 0
                ? `${(waterMl / 1000).toFixed(2)}L logged (Tap to +250ml)`
                : 'Tap to log +250ml water'}
            </AppText>
          </View>
          <Ionicons name="add" size={18} color={colors.textDim} />
        </PressableScale>

        {/* Habit 4: Weight Check-in */}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Weight check-in status"
          onPress={handleWeightTap}
          style={styles.habitItem}
        >
          <View style={[styles.habitIcon, weighedInToday && styles.habitIconDone]}>
            <Ionicons
              name={weighedInToday ? 'checkmark' : 'scale-outline'}
              size={18}
              color={weighedInToday ? colors.onBlock : colors.text}
            />
          </View>
          <View style={styles.habitText}>
            <AppText variant="bodyBold">Body Weight</AppText>
            <AppText variant="caption" color={colors.textDim}>
              {weighedInToday
                ? lastWeightText ?? 'Logged today'
                : lastWeightText
                ? `Last: ${lastWeightText} · Tap to log today`
                : 'Tap to log weight'}
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
        </PressableScale>
      </View>
    </Card>
  );
});
