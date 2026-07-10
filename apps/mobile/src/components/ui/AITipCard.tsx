import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from './AppText';
import { enterFade, enterUp } from './motion';
import { PressableScale } from './PressableScale';

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
    borderRadius: radius.block,
    padding: spacing.gutter,
    paddingLeft: spacing.gutter + 4,
    gap: spacing.sm,
    overflow: 'hidden',
  },
  /** Signal-red accent bar hugging the block's left edge, full height. */
  accentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: colors.accent,
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
    paddingVertical: 2,
  },
  refreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
  },
});

export function AITipCard({ title, tip, loading, error, onRefresh }: Props) {
  return (
    <Animated.View entering={enterUp(0)} style={styles.card}>
      <View style={styles.accentBar} />
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name="sparkles" size={16} color={colors.accent} />
        </View>
        <AppText variant="label">{title}</AppText>
      </View>

      {loading ? (
        // Static thinking state — a single quiet fade-in, no pulsing loop.
        <Animated.View entering={enterFade(0)} style={styles.thinkingRow}>
          <AppText variant="caption" color={colors.textDim}>
            Coach is thinking…
          </AppText>
        </Animated.View>
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
        hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
        style={styles.refreshRow}
      >
        <Ionicons name="refresh" size={13} color={colors.textDim} />
        <AppText variant="caption" color={colors.textDim}>
          New tip
        </AppText>
      </PressableScale>
    </Animated.View>
  );
}
