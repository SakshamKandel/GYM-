import type { ReactNode } from 'react';
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { tapHaptic } from '../../lib/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Base pressable: springy scale-down on press (transform-only, no glow),
 * light haptic, ≥48dp targets enforced by callers.
 */
interface Props extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  haptic?: boolean;
  /** How far the element shrinks while pressed. */
  pressScale?: number;
  children: ReactNode;
}

export function PressableScale({
  style,
  haptic = true,
  pressScale = 0.96,
  onPress,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: Props) {
  const pressed = useSharedValue(false);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: withSpring(pressed.value ? pressScale : 1, {
          damping: pressed.value ? 20 : 16,
          stiffness: pressed.value ? 400 : 300,
        }),
      },
    ],
  }));

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
