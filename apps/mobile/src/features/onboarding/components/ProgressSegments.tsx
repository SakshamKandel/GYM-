import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, spacing } from '@gym/ui-tokens';

/**
 * Onboarding progress bar: one segment per step. As the user advances, the
 * next segment's accent fill fades in (a direct response to their Continue tap,
 * so a quick settle is allowed). Reduced motion snaps to the final state.
 */
interface Props {
  step: number;
  total: number;
}

const EASE_OUT = Easing.bezier(0.25, 0.8, 0.4, 1);

export function ProgressSegments({ step, total }: Props) {
  return (
    <View style={styles.row} accessibilityLabel={`Step ${step} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <Segment key={i} filled={i < step} />
      ))}
    </View>
  );
}

/** Track segment with an accent fill that fades in/out as `filled` changes. */
function Segment({ filled }: { filled: boolean }) {
  const reduceMotion = useReducedMotion();
  const fill = useSharedValue(filled ? 1 : 0);

  useEffect(() => {
    const to = filled ? 1 : 0;
    fill.value = reduceMotion ? to : withTiming(to, { duration: 220, easing: EASE_OUT });
  }, [filled, reduceMotion, fill]);

  const fillStyle = useAnimatedStyle(() => ({ opacity: fill.value }));

  return (
    <View style={styles.segment}>
      <Animated.View style={[styles.fill, fillStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
});
