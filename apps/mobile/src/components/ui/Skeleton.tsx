import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { colors, radius as radiusTokens, spacing } from '@gym/ui-tokens';

/**
 * Loading placeholder block. STATIC by design law — no shimmer/pulse loop.
 * A rounded `surfaceRaised` rect with a single 180ms opacity fade-in on
 * mount, then it just sits there until real content replaces it.
 */
interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.surfaceRaised },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  lines: { flex: 1, gap: spacing.sm },
});

export function Skeleton({
  width = '100%',
  height = 16,
  // Default matches the nested-tile radius of the new block cards (brief §3).
  radius = radiusTokens.md,
  style,
}: SkeletonProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.block, { width, height, borderRadius: radius }, style]}
    />
  );
}

/**
 * Convenience placeholder for a standard list row: 44dp icon-chip square
 * plus two text lines — matches the IconChip row layout used app-wide.
 */
export function SkeletonRow({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.row, style]}>
      <Skeleton width={44} height={44} />
      <View style={styles.lines}>
        <Skeleton width="72%" height={14} />
        <Skeleton width="44%" height={12} />
      </View>
    </View>
  );
}
