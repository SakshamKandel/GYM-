import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import LottieView from 'lottie-react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@gym/ui-tokens';

/**
 * The streak flame — plays the brand Lottie animation (Logos/Lottie
 * Animations/Streak.json). `active` = streak alive: the flame burns in color
 * and loops; inactive = a single dim static frame (no dead-streak celebration).
 * Falls back to the flame icon if Lottie can't render (older web runtimes).
 */
interface Props {
  active: boolean;
  size?: number;
}

export function StreakFlame({ active, size = 28 }: Props) {
  const ref = useRef<LottieView>(null);
  const reduceMotion = useReducedMotion();
  // Reduced motion: keep the flame lit but hold it on a single frame.
  const animate = active && !reduceMotion;

  useEffect(() => {
    if (!animate) ref.current?.pause();
  }, [animate]);

  // lottie-react-native web support needs the DOM renderer; guard defensively.
  if (Platform.OS === 'web' && typeof document === 'undefined') {
    return (
      <Ionicons
        name="flame"
        size={size}
        color={active ? colors.accent : colors.textDim}
      />
    );
  }

  return (
    <View style={{ width: size, height: size, opacity: active ? 1 : 0.35 }}>
      <LottieView
        ref={ref}
        source={require('../../../assets/animations/streak.json')}
        autoPlay={animate}
        loop={animate}
        progress={animate ? undefined : 0.5}
        style={{ width: size, height: size }}
      />
    </View>
  );
}
