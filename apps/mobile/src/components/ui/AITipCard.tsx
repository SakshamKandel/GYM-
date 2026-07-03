import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, enterUp, PressableScale } from './index';

/**
 * Card that displays a short AI-generated tip. Shows a loading state while
 * fetching and an error fallback if the API is unavailable. Tap to refresh.
 */

interface Props {
  title: string;
  tip: string | null;
  loading: boolean;
  error: boolean;
  onRefresh: () => void;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.accentFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipText: {
    lineHeight: 22,
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  thinkingText: { marginLeft: 4 },
  refreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
  },
});

/** One pulsing dot of the "thinking" indicator — a gentle opacity wave. */
function ThinkingDot({ index }: { index: number }) {
  const pulse = useSharedValue(0.3);
  useEffect(() => {
    pulse.value = withDelay(
      index * 160,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 320, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.3, { duration: 320, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(pulse);
  }, [index, pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View style={[styles.dot, style]} />;
}

export function AITipCard({ title, tip, loading, error, onRefresh }: Props) {
  return (
    <Animated.View entering={enterUp(0)} style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name="sparkles" size={16} color={colors.accent} />
        </View>
        <AppText variant="label">{title}</AppText>
      </View>

      {loading ? (
        <View style={styles.thinkingRow}>
          <ThinkingDot index={0} />
          <ThinkingDot index={1} />
          <ThinkingDot index={2} />
          <AppText variant="caption" color={colors.textDim} style={styles.thinkingText}>
            Coach is thinking
          </AppText>
        </View>
      ) : error ? (
        <AppText variant="caption" color={colors.textDim}>
          Tip unavailable right now.
        </AppText>
      ) : (
        <AppText variant="body" style={styles.tipText}>
          {tip}
        </AppText>
      )}

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Refresh tip"
        onPress={onRefresh}
        style={styles.refreshRow}
      >
        <Ionicons name="refresh" size={13} color={colors.textFaint} />
        <AppText variant="caption" color={colors.textFaint}>
          New tip
        </AppText>
      </PressableScale>
    </Animated.View>
  );
}
