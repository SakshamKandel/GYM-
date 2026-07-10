import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius } from '@gym/ui-tokens';

/**
 * Thick rounded progress bar (REVAMP-BRIEF §7): flat track + fill, full-pill
 * ends. Defaults are for dark surfaces — track `surfaceRaised`, fill
 * `accent`. On a red/cream block pass `trackColor="rgba(0,0,0,0.15)"`
 * (sanctioned rgba use) and `fillColor={colors.onBlock}`.
 *
 * The fill sweeps once to its width on mount/update — same 500ms expo-out
 * as MacroBar/Ring so all data reveals share one vocabulary. No loops.
 */
interface Props {
  /** Progress 0–1 (clamped). */
  value: number;
  /** Bar thickness — default 10 (brief: 8–10). */
  height?: number;
  trackColor?: string;
  fillColor?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

const styles = StyleSheet.create({
  track: { borderRadius: radius.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.full },
});

export function ProgressBar({
  value,
  height = 10,
  trackColor = colors.surfaceRaised,
  fillColor = colors.accent,
  accessibilityLabel,
  style,
}: Props) {
  const pct = Math.min(Math.max(value, 0), 1);

  const width = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    // Reduced motion: snap the fill straight to its width.
    width.value = reduceMotion
      ? pct
      : withTiming(pct, { duration: 500, easing: Easing.bezier(0.16, 1, 0.3, 1) });
  }, [pct, width, reduceMotion]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${width.value * 100}%`,
  }));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={[styles.track, { height, backgroundColor: trackColor }, style]}
    >
      <Animated.View style={[styles.fill, { backgroundColor: fillColor }, fillStyle]} />
    </View>
  );
}
