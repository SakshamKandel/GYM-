import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import { AppText, Button } from '../../../components/ui';
import { formatClock } from '../logic';
import type { RestState } from '../session';

/**
 * Rest timer takeover — replaces the log editor after every set. Lives inside
 * the workout screen's CREAM counterpoint block (REVAMP-BRIEF §2), so all ink
 * is `onBlock`/`creamDim`: huge Oswald countdown on its own line, a thick
 * near-black bar depleting left→right over the sanctioned rgba track, and a
 * ±15s / Skip / +15s pill row underneath (56dp targets for sweaty thumbs).
 * Ends with a warn haptic (fired by the session store) and auto-returns to
 * the editor.
 */

interface Props {
  rest: RestState;
  onAdjust: (deltaSec: number) => void;
  onSkip: () => void;
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: spacing.md },
  countdown: {
    fontFamily: type.display,
    fontSize: type.size.statHuge,
    lineHeight: 84,
    color: colors.onBlock,
    textAlign: 'center',
  },
  track: {
    alignSelf: 'stretch',
    height: 8,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.15)', // sanctioned: bar track on a colored block
    overflow: 'hidden',
  },
  fill: { height: 8, backgroundColor: colors.onBlock, borderRadius: radius.full },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    alignSelf: 'stretch',
  },
  adjustBtn: {
    width: touch.primary,
    height: touch.primary,
    borderRadius: radius.full,
    backgroundColor: colors.onBlock,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adjustPressed: { backgroundColor: colors.surfacePressed, transform: [{ scale: 0.96 }] },
  adjustText: { fontFamily: type.display, fontSize: 14, color: colors.text, letterSpacing: 0.5 },
});

export function RestTimerPanel({ rest, onAdjust, onSkip }: Props) {
  const progress = useSharedValue(1);

  useEffect(() => {
    const remainingMs = Math.max(0, rest.endsAt - Date.now());
    const startFraction = rest.totalSec > 0 ? remainingMs / 1000 / rest.totalSec : 0;
    progress.value = Math.min(1, startFraction);
    progress.value = withTiming(0, { duration: remainingMs, easing: Easing.linear });
    // Restart the depletion line whenever ±15s moves the end time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rest.endsAt, rest.totalSec]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <View style={styles.root}>
      <AppText variant="label" color={colors.creamDim}>
        rest
      </AppText>
      <AppText style={styles.countdown} tabular>
        {formatClock(rest.remainingSec)}
      </AppText>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, fillStyle]} />
      </View>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Shorten rest by 15 seconds"
          onPress={() => onAdjust(-15)}
          style={({ pressed }) => [styles.adjustBtn, pressed && styles.adjustPressed]}
        >
          <AppText style={styles.adjustText} tabular={false}>
            −15s
          </AppText>
        </Pressable>
        <Button label="Skip" variant="onBlock" onPress={onSkip} accessibilityLabel="Skip rest" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Extend rest by 15 seconds"
          onPress={() => onAdjust(15)}
          style={({ pressed }) => [styles.adjustBtn, pressed && styles.adjustPressed]}
        >
          <AppText style={styles.adjustText} tabular={false}>
            +15s
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}
