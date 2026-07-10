import { useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import { AppText, enterFade, PressableScale, Sheet, StreakFlame } from '../../../components/ui';
import type { WeeklyStreakData } from '../../streak/hooks';
import { StreakDetailSheet } from './StreakDetailSheet';

/**
 * Brand Lottie flame + current WEEKLY streak count in Oswald. Dim when there's
 * no streak yet. Tapping opens the rich streak-detail sheet ("2 of 3 this
 * week", shield status, best, and a 7-day activity strip).
 */

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: touch.min,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  num: { fontFamily: type.display, fontSize: 20 },
});

export function StreakChip({ streak }: { streak: WeeklyStreakData }) {
  const [open, setOpen] = useState(false);
  // "Alive" reads as: on pace this week, or already banked at least one
  // counted week — a fresh, in-progress week with 0 days isn't a dead streak.
  const alive = streak.weeks > 0 || streak.thisWeekDays > 0;
  const tint = alive ? colors.accent : colors.textDim;
  const unit = streak.weeks === 1 ? 'week' : 'weeks';

  return (
    // Fades in because it mounts only after home data loads — no hard pop.
    <Animated.View entering={enterFade(0)} style={styles.wrap}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Workout streak: ${streak.weeks} ${unit}, ${streak.thisWeekDays} of ${streak.weeklyTarget} sessions this week. View details`}
        onPress={() => setOpen(true)}
        style={styles.chip}
      >
        <StreakFlame active={alive} size={26} />
        <AppText style={styles.num} color={tint} tabular>
          {streak.weeks}
        </AppText>
      </PressableScale>

      <Sheet visible={open} onClose={() => setOpen(false)} title="Your streak">
        <StreakDetailSheet streak={streak} />
      </Sheet>
    </Animated.View>
  );
}
