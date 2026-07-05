import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';
import type { QuestPair } from '../../../lib/api/social';

/**
 * Co-op monthly quest card: "both log N session-days this month" per buddy
 * pair, with two progress bars ("You 8 · Alex 6 of 12"). Server-computed and
 * server-awarded (the `buddy_quest` badge lands via the award engine) — this
 * is display-only. Complete pairs get a quiet checkmark, no confetti here
 * (the badge celebration already covers that moment once).
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
        <Ionicons name="flag-outline" size={18} color={colors.accent} />
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerText: { flex: 1 },
  pairList: { gap: spacing.md },
  pairRow: { gap: 6 },
  pairTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pairName: { flex: 1 },
  barTrack: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  barFill: { height: 6, borderRadius: radius.full },
});
