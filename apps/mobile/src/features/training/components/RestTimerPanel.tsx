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
 * Rest timer takeover — replaces the log editor after every set.
 * 64px Oswald countdown, thin 3px red line depleting left→right,
 * ±15s at the edges (48dp), Skip underneath. Ends with a warn haptic
 * (fired by the session store) and auto-returns to the editor.
 */

interface Props {
  rest: RestState;
  onAdjust: (deltaSec: number) => void;
  onSkip: () => void;
}

const styles = StyleSheet.create({
  root: { alignItems: 'center' },
  track: {
    alignSelf: 'stretch',
    height: 3,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  fill: { height: 3, backgroundColor: colors.accent, borderRadius: radius.full },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    alignSelf: 'stretch',
  },
  adjustBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adjustPressed: { backgroundColor: colors.surfacePressed, transform: [{ scale: 0.96 }] },
  adjustText: { fontFamily: type.display, fontSize: 14, color: colors.text, letterSpacing: 0.5 },
  countdown: {
    fontFamily: type.display,
    fontSize: 64,
    lineHeight: 72,
    color: colors.text,
    minWidth: 150,
    textAlign: 'center',
  },
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
      <AppText variant="label" color={colors.textDim}>
        rest
      </AppText>
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
        <AppText style={styles.countdown} tabular>
          {formatClock(rest.remainingSec)}
        </AppText>
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
      <View style={styles.track}>
        <Animated.View style={[styles.fill, fillStyle]} />
      </View>
      <Button label="Skip" variant="ghost" onPress={onSkip} accessibilityLabel="Skip rest" />
    </View>
  );
}
