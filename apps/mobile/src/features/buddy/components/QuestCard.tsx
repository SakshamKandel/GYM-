import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, IconChip } from '../../../components/ui';
import type { QuestPair } from '../../../lib/api/social';

/**
 * Co-op monthly quest card: "both log N session-days this month" per buddy
 * pair, with two progress bars ("You 8 · Alex 6 of 12"). Server-computed and
 * server-awarded (the `buddy_quest` badge lands via the award engine) — this
 * is display-only. Complete pairs get a quiet checkmark, no confetti here
 * (the badge celebration already covers that moment once).
 *
 * Block language: borderless charcoal block (`radius.block`), rounded-square
 * icon chip anchor, thick pill progress bars on the raised track.
 */

interface Props {
  pairs: QuestPair[];
  target: number;
}

function Bar({ value, target, color }: { value: number; target: number; color: string }) {
  const ratio = target > 0 ? Math.max(0, Math.min(1, value / target)) : 0;
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${ratio * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

export function QuestCard({ pairs, target }: Props) {
  if (pairs.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <IconChip icon="flag-outline" color={colors.accentFaint} iconColor={colors.accent} />
        <AppText variant="title" style={styles.headerText}>
          Buddy quest — {target} session-days each
        </AppText>
      </View>
      <View style={styles.pairList}>
        {pairs.map((pair) => (
          <View key={pair.buddyAccountId} style={styles.pairRow}>
            <View style={styles.pairTop}>
              <AppText variant="bodyBold" numberOfLines={1} style={styles.pairName}>
                You {pair.mine} · {pair.displayName || 'Buddy'} {pair.theirs} of {target}
              </AppText>
              {pair.complete ? (
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              ) : null}
            </View>
            <Bar value={pair.mine} target={target} color={colors.accent} />
            <Bar value={pair.theirs} target={target} color={colors.textDim} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Chunky charcoal block — NO border (fill contrast separates it, brief §1).
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.lg,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerText: { flex: 1 },
  pairList: { gap: spacing.lg },
  pairRow: { gap: spacing.sm },
  pairTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pairName: { flex: 1 },
  // Thick rounded bars (brief §7: 8–10 high, full-pill, raised track on dark).
  barTrack: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: radius.full },
});
