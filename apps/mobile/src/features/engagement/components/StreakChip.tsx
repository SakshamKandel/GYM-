import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { streakAlive, type Streak } from '@gym/shared';
import { colors, radius, type } from '@gym/ui-tokens';
import { AppText, enterFade, StreakFlame } from '../../../components/ui';
import { todayIso } from '../../../lib/dates';

/** Brand Lottie flame + current streak count in Oswald. Dim when the streak is dead. */

const styles = StyleSheet.create({
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
  const alive = streakAlive(streak, todayIso());
  const tint = alive ? colors.accent : colors.textDim;
  return (
    // Fades in because it mounts only after home data loads — no hard pop.
    <Animated.View
      entering={enterFade(0)}
      style={styles.chip}
      accessibilityLabel={`Workout streak: ${streak.current} ${streak.current === 1 ? 'day' : 'days'}`}
    >
      <StreakFlame active={alive} size={26} />
      <AppText style={styles.num} color={tint} tabular>
        {streak.current}
      </AppText>
    </Animated.View>
  );
}
