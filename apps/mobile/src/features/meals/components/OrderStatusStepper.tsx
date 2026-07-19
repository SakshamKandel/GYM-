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
import { colors, type } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';
import { buildStepper } from './orderView';
import type { MealOrderStatus } from '../api';

/**
 * The five-step order status stepper — the centerpiece of a live order card.
 * A filled red progress line runs up to the current step; the current node
 * carries a gently pulsing ring (a genuine live-status cue, the one place
 * ambient motion is sanctioned — like the coach TypingDots) and holds
 * perfectly still under reduced motion.
 */

const DOT = 12;
const CURRENT_DOT = 14;
const RING = 26;
const BAR = 3;
const TRACK_H = RING;

interface Props {
  status: MealOrderStatus;
}

function CurrentDot({ reduceMotion }: { reduceMotion: boolean }) {
  const p = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      p.value = 0;
      return;
    }
    p.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(p);
  }, [reduceMotion, p]);

  // Ring expands outward and fades — a soft "sonar ping" behind the solid dot.
  const ringStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0 : (1 - p.value) * 0.5,
    transform: [{ scale: 0.5 + p.value * 0.7 }],
  }));

  return (
    <View style={styles.currentWrap}>
      <Animated.View style={[styles.ring, ringStyle]} />
      <View style={styles.currentCore} />
    </View>
  );
}

export function OrderStatusStepper({ status }: Props) {
  const reduceMotion = useReducedMotion();
  const { steps } = buildStepper(status);
  const lastIndex = steps.length - 1;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`Order progress: ${
        steps.find((s) => s.current)?.label ?? (steps[lastIndex]?.done ? 'Delivered' : 'Placed')
      }`}
    >
      <View style={styles.trackRow}>
        {steps.map((step, i) => {
          const leftFilled = step.done || step.current;
          const rightFilled = step.done;
          return (
            <View key={step.key} style={styles.node}>
              <View
                style={[
                  styles.halfBar,
                  styles.halfBarLeft,
                  { backgroundColor: leftFilled ? colors.accent : colors.borderStrong },
                  i === 0 && styles.hiddenBar,
                ]}
              />
              <View
                style={[
                  styles.halfBar,
                  styles.halfBarRight,
                  { backgroundColor: rightFilled ? colors.accent : colors.borderStrong },
                  i === lastIndex && styles.hiddenBar,
                ]}
              />
              {step.current ? (
                <CurrentDot reduceMotion={reduceMotion} />
              ) : step.done ? (
                <View style={styles.doneDot} />
              ) : (
                <View style={styles.futureDot} />
              )}
            </View>
          );
        })}
      </View>

      <View style={styles.labelRow}>
        {steps.map((step) => (
          <View key={step.key} style={styles.labelCell}>
            <AppText
              style={[
                styles.label,
                { color: step.current ? colors.accent : step.done ? colors.text : colors.textFaint },
              ]}
              tabular={false}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {step.label}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  trackRow: { flexDirection: 'row', height: TRACK_H, alignItems: 'center' },
  node: { flex: 1, height: TRACK_H, alignItems: 'center', justifyContent: 'center' },
  halfBar: {
    position: 'absolute',
    top: (TRACK_H - BAR) / 2,
    height: BAR,
    borderRadius: BAR / 2,
  },
  halfBarLeft: { left: 0, right: '50%' },
  halfBarRight: { left: '50%', right: 0 },
  hiddenBar: { backgroundColor: 'transparent' },
  doneDot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.accent,
  },
  futureDot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  currentWrap: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    backgroundColor: colors.accent,
  },
  currentCore: {
    width: CURRENT_DOT,
    height: CURRENT_DOT,
    borderRadius: CURRENT_DOT / 2,
    backgroundColor: colors.accent,
    borderWidth: 2.5,
    borderColor: colors.surface,
  },
  labelRow: { flexDirection: 'row', marginTop: 6 },
  labelCell: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  label: {
    fontFamily: type.display,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
});
