import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AnimatedNumber, AppText, Button, Card, PressableScale, Skeleton } from '../ui';
import { EmptyArt, TrendMotif } from '../visual';

/**
 * Home weight card — the SMOOTHED trend (never this morning's scale number),
 * the EWMA direction + weekly rate, and the last-logged date. Purely
 * presentational: the screen derives everything from the offline weight store
 * (features/body) and passes it down.
 *
 * Two affordances, both secondary (the hero keeps the screen's primary CTA):
 * the card body opens the Progress tab, the pill logs a weigh-in. Direction
 * ink stays textDim — whether up is good depends on the goal, we don't judge.
 */
interface Props {
  /** True while the weight store hasn't loaded yet (renders a skeleton). */
  loading: boolean;
  /** Latest smoothed trend weight in display units, null with no logs yet. */
  trendValue: number | null;
  /** Display unit label ("kg" / "lb"). */
  unit: string;
  /** Trend direction icon name (adherence-neutral). */
  direction: 'trending-up' | 'trending-down' | 'remove';
  /** "+0.3 kg/week" — signed weekly rate in display units. */
  rateText: string;
  /** "Last logged 12 Jul", or null when no logs exist. */
  lastLoggedText: string | null;
  onOpen: () => void;
  onLog: () => void;
}

/** Skeleton mirrors the loaded card so nothing jumps when data lands. */
const SKELETON_H = 196;

const styles = StyleSheet.create({
  // overflow:hidden keeps the decorative trend motif clipped to the block's
  // rounded corners.
  card: { marginBottom: spacing.md, gap: spacing.lg, overflow: 'hidden' },
  skeleton: { marginBottom: spacing.md },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  main: { flex: 1, minWidth: 0, gap: spacing.xs },
  openAction: { minHeight: touch.min, justifyContent: 'center' },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  directionRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chevron: { marginTop: spacing.xs },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  emptyCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
});

export const WeightHomeCard = memo(function WeightHomeCard({
  loading,
  trendValue,
  unit,
  direction,
  rateText,
  lastLoggedText,
  onOpen,
  onLog,
}: Props) {
  if (loading) {
    return <Skeleton height={SKELETON_H} radius={radius.block} style={styles.skeleton} />;
  }

  if (trendValue === null) {
    return (
      <Card style={styles.card}>
        <View style={styles.emptyRow}>
          <View style={styles.emptyCopy}>
            <AppText variant="bodyBold" numberOfLines={1}>
              Track your trend, not the scale
            </AppText>
            <AppText variant="caption" numberOfLines={2}>
              Log a weigh-in and your smoothed trend shows up here.
            </AppText>
          </View>
          <EmptyArt variant="body" width={84} />
        </View>
        <Button label="Log weight" variant="secondary" onPress={onLog} />
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <TrendMotif />
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={
          `Trend weight ${trendValue.toFixed(1)} ${unit}, ${rateText}` +
          (lastLoggedText !== null ? `. ${lastLoggedText}` : '') +
          '. Open Progress'
        }
        onPress={onOpen}
        style={styles.openAction}
      >
        <View style={styles.headerRow}>
          <View style={styles.main}>
            <AppText variant="label" numberOfLines={1}>
              Trend weight
            </AppText>
            <View style={styles.valueRow}>
              <AnimatedNumber value={trendValue} decimals={1} variant="display" />
              <AppText variant="caption" color={colors.textDim}>
                {unit}
              </AppText>
            </View>
            <View style={styles.directionRow}>
              <Ionicons name={direction} size={18} color={colors.textDim} />
              <AppText variant="caption" numberOfLines={1}>
                {rateText}
              </AppText>
            </View>
            {lastLoggedText !== null ? (
              <AppText variant="caption" color={colors.textFaint} numberOfLines={1}>
                {lastLoggedText}
              </AppText>
            ) : null}
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textDim}
            style={styles.chevron}
          />
        </View>
      </PressableScale>
      <Button label="Log weight" variant="secondary" onPress={onLog} />
    </Card>
  );
});
