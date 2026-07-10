import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from './AppText';

/**
 * Adherence-neutral macro bar (MacroFactor lesson): the bar fills, it never
 * turns red or shames. Over target = solid full bar, stated plainly.
 * The fill slides to its width on mount/update.
 */
interface Props {
  label: string;
  current: number;
  target: number;
  unit?: string;
  color: string;
  /** Delay before the fill animates (stagger stacked bars). */
  delay?: number;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  label: { flexShrink: 1, minWidth: 0 },
  amount: { flexShrink: 0 },
  track: {
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.full },
});

export function MacroBar({ label, current, target, unit = 'g', color, delay = 0 }: Props) {
  const pct = target > 0 ? Math.min(current / target, 1) : 0;
  // Over target: keep the bar readable at 100% and state the overshoot plainly
  // in dim text — adherence-neutral, never a shame colour.
  const over = target > 0 ? Math.round(current - target) : 0;

  const width = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    // Same 500ms expo-out sweep as Ring, so the two data reveals feel like one
    // vocabulary. Reduced motion: snap the fill straight to its width.
    width.value = reduceMotion
      ? pct
      : withDelay(
          delay,
          withTiming(pct, { duration: 500, easing: Easing.bezier(0.16, 1, 0.3, 1) }),
        );
  }, [pct, delay, width, reduceMotion]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${width.value * 100}%`,
  }));

  return (
    <View accessibilityLabel={`${label}: ${Math.round(current)} of ${target} ${unit}`}>
      <View style={styles.row}>
        <AppText variant="label" numberOfLines={1} style={styles.label}>
          {label}
        </AppText>
        <AppText variant="caption" tabular numberOfLines={1} style={styles.amount}>
          <AppText variant="caption" color={colors.text} tabular>
            {Math.round(current)}
          </AppText>
          {` / ${target}${unit}`}
          {over > 0 ? (
            <AppText variant="caption" color={colors.textDim} tabular>
              {`  +${over}`}
            </AppText>
          ) : null}
        </AppText>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { backgroundColor: color }, fillStyle]} />
      </View>
    </View>
  );
}
