import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, PressableScale, TierAvatarFrame } from '../../../components/ui';
import { RankEmblem } from '../../gamification/components/RankEmblem';
import type { PublicLeaderboardResult, PublicLeaderboardRow } from '../../../lib/api/social';
import { avatarLetter } from '../logic';

/**
 * Public gym-wide consistency leaderboard — ranked by session-days THIS
 * calendar month ONLY (design law: never kg, never XP, tier is visual
 * identity and never affects order). Server does the ranking and the privacy
 * filtering; this component only renders what it's given.
 *
 * PRIVACY LAW: rows are plain Views, NOT links — a stranger's row exposes
 * only name/avatar/tier/rank/session-days and never taps through to their
 * workouts. The one exception: rows belonging to the caller's ACCEPTED
 * buddies reuse the existing buddy tap-through (BuddySummarySheet), which
 * shows only what the buddy feed already shows them.
 *
 * The caller's own row is highlighted; when they rank outside the visible
 * list, a pinned "You — Nth" footer row shows their absolute position.
 */

interface Props {
  rows: PublicLeaderboardRow[];
  me: PublicLeaderboardResult['me'];
  month: string;
  /** Account ids of the caller's accepted buddies — the only tappable rows. */
  buddyIds: ReadonlySet<string>;
  onSelectBuddy: (accountId: string, displayName: string) => void;
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
  if (!y || !m) return 'this month';
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long' });
}

export function PublicLeaderboard({ rows, me, month, buddyIds, onSelectBuddy }: Props) {
  if (rows.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="podium-outline" size={32} color={colors.textFaint} />
        <AppText variant="caption" center style={styles.emptyText}>
          No ranked sessions yet in {monthLabel(month)} — first session puts you on the board.
        </AppText>
      </View>
    );
  }

  const meVisible = rows.some((r) => r.isMe);

  return (
    <View style={styles.list}>
      <AppText variant="caption" style={styles.hint}>
        Session-days in {monthLabel(month)} — one per day, whole gym.
      </AppText>

      {rows.map((row) => {
        const content = (
          <View style={[styles.row, row.isMe && styles.rowMe]}>
            <View style={styles.rankWrap}>
              <AppText
                variant="bodyBold"
                tabular
                color={row.position <= 3 ? colors.accent : colors.textDim}
              >
                {ordinal(row.position)}
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
                {/* Earned rank medal — ring only (no level number in public). */}
                <RankEmblem rank={row.rank} size={20} />
              </View>
              <AppText variant="caption">
                {row.sessionDays} session{row.sessionDays === 1 ? '' : 's'}
              </AppText>
            </View>
            {!row.isMe && buddyIds.has(row.accountId) ? (
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            ) : null}
          </View>
        );

        // Only accepted buddies tap through (privacy law) — everyone else's
        // row is a plain, non-pressable View.
        if (!row.isMe && buddyIds.has(row.accountId)) {
          return (
            <PressableScale
              key={row.accountId}
              accessibilityRole="button"
              accessibilityLabel={`View ${row.displayName}'s recent workouts`}
              onPress={() => onSelectBuddy(row.accountId, row.displayName)}
            >
              {content}
            </PressableScale>
          );
        }

        return <View key={row.accountId}>{content}</View>;
      })}

      {/* Caller ranks below the visible list — pin their absolute position. */}
      {!meVisible && !me.hidden && me.position !== null ? (
        <View style={[styles.row, styles.rowMe]}>
          <View style={styles.rankWrap}>
            <AppText variant="bodyBold" tabular color={colors.textDim}>
              {ordinal(me.position)}
            </AppText>
          </View>
          <View style={styles.info}>
            <AppText variant="bodyBold">
              You — {ordinal(me.position)} · {me.sessionDays} session
              {me.sessionDays === 1 ? '' : 's'}
            </AppText>
          </View>
        </View>
      ) : null}
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
  rankWrap: { width: 42, alignItems: 'flex-start' },
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
