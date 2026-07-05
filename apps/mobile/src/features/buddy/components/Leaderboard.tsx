import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, PressableScale, TierAvatarFrame } from '../../../components/ui';
import type { LeaderboardRow } from '../../../lib/api/social';
import { avatarLetter } from '../logic';

/**
 * Buddy leaderboard — ranked by session-days THIS calendar month (design
 * law 2: consistency ranking, capped 1/day, buddy-circle only — never a
 * global kg leaderboard, never XP/rank). The caller's own row is included
 * and highlighted. Tapping a buddy's row surfaces their recent synced
 * workout summaries via the existing buddy feed (see BuddyContent's tap
 * handler) — this component only renders the ranking and reports the tap.
 */

interface Props {
  rows: LeaderboardRow[];
  month: string;
  onSelectBuddy: (accountId: string) => void;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return 'This month';
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long' });
}

export function Leaderboard({ rows, month, onSelectBuddy }: Props) {
  if (rows.length <= 1) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="podium-outline" size={32} color={colors.textFaint} />
        <AppText variant="caption" center style={styles.emptyText}>
          Add a buddy above to start a consistency leaderboard for {monthLabel(month)}.
        </AppText>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      <AppText variant="caption" style={styles.hint}>
        Session-days in {monthLabel(month)} — one per day, buddies only.
      </AppText>
      {rows.map((row, i) => {
        const rank = i + 1;
        const content = (
          <View style={[styles.row, row.isMe && styles.rowMe]}>
            <View style={styles.rankWrap}>
              <AppText variant="bodyBold" tabular color={rank <= 3 ? colors.accent : colors.textDim}>
                {ordinal(rank)}
              </AppText>
            </View>
            <TierAvatarFrame tier={row.tier} size={36}>
              <View style={styles.avatar}>
                <AppText variant="title" color={colors.accent}>
                  {avatarLetter(row.displayName)}
                </AppText>
              </View>
            </TierAvatarFrame>
            <View style={styles.info}>
              {/* Tier identity on avatar rows = the ring on the avatar ONLY
                  (design law) — never a shield beside the name. */}
              <View style={styles.nameRow}>
                <AppText variant="bodyBold" numberOfLines={1} style={styles.nameText}>
                  {row.isMe ? 'You' : row.displayName}
                </AppText>
              </View>
              <AppText variant="caption">
                {row.sessionDays} session{row.sessionDays === 1 ? '' : 's'}
              </AppText>
            </View>
            {!row.isMe ? <Ionicons name="chevron-forward" size={16} color={colors.textFaint} /> : null}
          </View>
        );

        if (row.isMe) {
          return <View key={row.accountId}>{content}</View>;
        }

        return (
          <PressableScale
            key={row.accountId}
            accessibilityRole="button"
            accessibilityLabel={`View ${row.displayName}'s recent workouts`}
            onPress={() => onSelectBuddy(row.accountId)}
          >
            {content}
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  hint: { marginBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: touch.min,
    paddingVertical: spacing.sm,
  },
  rowMe: {
    borderWidth: 1.5,
    borderColor: colors.accentFaint,
  },
  rankWrap: { width: 36, alignItems: 'flex-start' },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, gap: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  nameText: { flexShrink: 1 },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  emptyText: { paddingHorizontal: spacing.lg },
});
