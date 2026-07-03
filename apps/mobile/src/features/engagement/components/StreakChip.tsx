import { useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { streakAlive, type Streak } from '@gym/shared';
import { colors, radius, type } from '@gym/ui-tokens';
import { AppText, enterFade, PressableScale, Sheet, StreakFlame } from '../../../components/ui';
import { todayIso } from '../../../lib/dates';
import { StreakDetailSheet } from './StreakDetailSheet';

/**
 * Brand Lottie flame + current streak count in Oswald. Dim when the streak is
 * dead. Tapping opens the rich streak-detail sheet (best, last session, and a
 * 7-day activity strip).
 */

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  num: { fontFamily: type.display, fontSize: 20 },
});

export function StreakChip({ streak }: { streak: Streak }) {
  const [open, setOpen] = useState(false);
  const alive = streakAlive(streak, todayIso());
  const tint = alive ? colors.accent : colors.textDim;
  const unit = streak.current === 1 ? 'day' : 'days';

  return (
    // Fades in because it mounts only after home data loads — no hard pop.
    <Animated.View entering={enterFade(0)} style={styles.wrap}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Workout streak: ${streak.current} ${unit}. View details`}
        onPress={() => setOpen(true)}
        style={styles.chip}
      >
        <StreakFlame active={alive} size={26} />
        <AppText style={styles.num} color={tint} tabular>
          {streak.current}
        </AppText>
      </PressableScale>

      <Sheet visible={open} onClose={() => setOpen(false)} title="Your streak">
        <StreakDetailSheet streak={streak} />
      </Sheet>
    </Animated.View>
  );
}
