import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '@gym/ui-tokens';

/**
 * The "Greece is typing" indicator: three dots that pulse in a gentle wave
 * while the coach reply generates. A typing indicator is the one place ambient
 * motion is sanctioned — it's a genuine live-status cue — and it holds perfectly
 * still under reduced motion (three steady, clearly-visible dots).
 */

const DOT = 7;
const GAP = 5;
const HALF = 520; // ms for one fade direction; full cycle ~1s
const STAGGER = 170; // wave offset between dots
const EASE = Easing.inOut(Easing.quad);
const REST = 0.4; // dim trough of the pulse
const PEAK = 1;

function Dot({ index, reduceMotion }: { index: number; reduceMotion: boolean }) {
  const p = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      p.value = 0.55; // steady, no motion — still reads as "thinking"
      return;
    }
    p.value = withDelay(
      index * STAGGER,
      withRepeat(
        withSequence(
          withTiming(1, { duration: HALF, easing: EASE }),
          withTiming(0, { duration: HALF, easing: EASE }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(p);
  }, [index, reduceMotion, p]);

  const style = useAnimatedStyle(() => ({
    opacity: REST + p.value * (PEAK - REST),
  }));

  return <Animated.View style={[styles.dot, style]} />;
}

export function TypingDots() {
  const reduceMotion = useReducedMotion();
  return (
    <View style={styles.row}>
      {[0, 1, 2].map((i) => (
        <Dot key={i} index={i} reduceMotion={reduceMotion} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GAP,
    paddingVertical: 3,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.textDim,
  },
});
