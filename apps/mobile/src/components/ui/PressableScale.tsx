import type { ReactNode } from 'react';
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { tapHaptic } from '../../lib/haptics';
import { PRESS_SPRING } from './motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Base pressable: springy scale-down on press (transform-only, no glow),
 * light haptic, ≥48dp targets enforced by callers.
 *
 * Springs on the shared `PRESS_SPRING` token so every button, card, chip and
 * tile settles with one feel, and honors the system Reduce Motion setting the
 * same way the rest of the motion vocabulary does — with it on, the press
 * state still lands, it just lands instantly instead of springing.
 */
interface Props extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** Opt-in — vibration is reserved for meaningful moments (logging, PRs,
   * destructive confirms), not every tap. */
  haptic?: boolean;
  /** How far the element shrinks while pressed. */
  pressScale?: number;
  children: ReactNode;
}

export function PressableScale({
  style,
  haptic = false,
  pressScale = 0.96,
  onPress,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: Props) {
  const reduceMotion = useReducedMotion();
  const pressed = useSharedValue(false);
  const animatedStyle = useAnimatedStyle(() => {
    const target = pressed.value ? pressScale : 1;
    return {
      transform: [{ scale: reduceMotion ? target : withSpring(target, PRESS_SPRING) }],
    };
  });

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        pressed.value = true;
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = false;
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) tapHaptic();
        onPress?.(e);
      }}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
