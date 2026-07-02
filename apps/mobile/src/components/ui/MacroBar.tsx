import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius } from '@gym/ui-tokens';
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
    marginBottom: 6,
  },
  track: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.full },
});

export function MacroBar({ label, current, target, unit = 'g', color, delay = 0 }: Props) {
  const pct = target > 0 ? Math.min(current / target, 1) : 0;

  const width = useSharedValue(0);
  useEffect(() => {
    width.value = withDelay(
      delay,
      withTiming(pct, { duration: 550, easing: Easing.bezier(0.16, 1, 0.3, 1) }),
    );
  }, [pct, delay, width]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${width.value * 100}%`,
  }));

  return (
    <View accessibilityLabel={`${label}: ${Math.round(current)} of ${target} ${unit}`}>
      <View style={styles.row}>
        <AppText variant="label">{label}</AppText>
        <AppText variant="caption" tabular>
          <AppText variant="caption" color={colors.text} tabular>
            {Math.round(current)}
          </AppText>
          {` / ${target}${unit}`}
        </AppText>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { backgroundColor: color }, fillStyle]} />
      </View>
    </View>
  );
}
