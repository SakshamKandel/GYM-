import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '@gym/ui-tokens';

/**
 * The "this is live right now" dot — a solid status-colored core with a soft
 * sonar ring expanding behind it (the same sanctioned ambient-motion pattern
 * as OrderStatusStepper's current node and the coach TypingDots). Holds
 * perfectly still under reduced motion.
 */

const CORE = 8;
const RING = 16;

interface Props {
  color?: string;
}

const styles = StyleSheet.create({
  wrap: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    width: RING,
    height: RING,
    borderRadius: RING / 2,
  },
  core: { width: CORE, height: CORE, borderRadius: CORE / 2 },
});

export function LiveDot({ color = colors.accent }: Props) {
  const reduceMotion = useReducedMotion();
  const p = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      p.value = 0;
      return;
    }
    p.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(p);
  }, [reduceMotion, p]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0 : (1 - p.value) * 0.45,
    transform: [{ scale: 0.5 + p.value * 0.7 }],
  }));

  return (
    <View style={styles.wrap} accessible={false} importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.ring, { backgroundColor: color }, ringStyle]} />
      <View style={[styles.core, { backgroundColor: color }]} />
    </View>
  );
}
