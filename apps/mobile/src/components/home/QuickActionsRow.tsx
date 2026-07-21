import { memo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, PressableScale } from '../ui';
import { tapHaptic } from '../../lib/haptics';
import { defaultMealForHour } from '../../features/nutrition/logic';
import { searchHref } from '../../features/nutrition/nav';
import { todayIso } from '../../lib/dates';
import { toHref } from '../../features/engagement/logic';

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  scrollContent: {
    paddingHorizontal: spacing.gutter,
    gap: spacing.sm,
    alignItems: 'center',
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    minHeight: touch.min,
  },
  actionPillHero: {
    backgroundColor: colors.blockRed,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapHero: {
    backgroundColor: colors.onBlock,
  },
});

interface QuickActionsRowProps {
  onAddWater: () => void;
  nextWorkoutId?: string | null;
}

export const QuickActionsRow = memo(function QuickActionsRow({
  onAddWater,
  nextWorkoutId,
}: QuickActionsRowProps) {
  const handleStartWorkout = () => {
    tapHaptic();
    if (nextWorkoutId) {
      router.push(toHref(`/workout/start?planWorkoutId=${nextWorkoutId}`));
    } else {
      router.push('/(tabs)/train');
    }
  };

  const handleLogFood = () => {
    tapHaptic();
    const currentMeal = defaultMealForHour(new Date().getHours());
    router.push(searchHref(currentMeal, todayIso()));
  };

  const handleLogWeight = () => {
    tapHaptic();
    router.push(toHref('/body/log-weight'));
  };

  const handleWaterTap = () => {
    tapHaptic();
    onAddWater();
  };

  const handleCoachChat = () => {
    tapHaptic();
    router.push(toHref('/coach-chat'));
  };

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Workout Quick Action */}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Start workout"
          onPress={handleStartWorkout}
          style={[styles.actionPill, styles.actionPillHero]}
        >
          <View style={[styles.iconWrap, styles.iconWrapHero]}>
            <Ionicons name="barbell" size={16} color={colors.text} />
          </View>
          <AppText variant="bodyBold" color={colors.onBlock}>
            Workout
          </AppText>
        </PressableScale>

        {/* Quick Log Food */}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Log Food"
          onPress={handleLogFood}
          style={styles.actionPill}
        >
          <View style={styles.iconWrap}>
            <Ionicons name="restaurant-outline" size={16} color={colors.text} />
          </View>
          <AppText variant="bodyBold" color={colors.text}>
            Log Food
          </AppText>
        </PressableScale>

        {/* Quick +250ml Water */}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Add 250 milliliters water"
          onPress={handleWaterTap}
          style={styles.actionPill}
        >
          <View style={styles.iconWrap}>
            <Ionicons name="water-outline" size={16} color={colors.accent} />
          </View>
          <AppText variant="bodyBold" color={colors.text}>
            +250ml Water
          </AppText>
        </PressableScale>

        {/* Quick Log Weight */}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Log Weight"
          onPress={handleLogWeight}
          style={styles.actionPill}
        >
          <View style={styles.iconWrap}>
            <Ionicons name="scale-outline" size={16} color={colors.text} />
          </View>
          <AppText variant="bodyBold" color={colors.text}>
            Log Weight
          </AppText>
        </PressableScale>

        {/* Coach Chat */}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Coach Chat"
          onPress={handleCoachChat}
          style={styles.actionPill}
        >
          <View style={styles.iconWrap}>
            <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.text} />
          </View>
          <AppText variant="bodyBold" color={colors.text}>
            Coach
          </AppText>
        </PressableScale>
      </ScrollView>
    </View>
  );
});
