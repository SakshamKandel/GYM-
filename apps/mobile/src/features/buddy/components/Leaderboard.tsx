import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { catchUpHint, competitionPositions } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, PressableScale, TierAvatarFrame } from '../../../components/ui';
import type { LeaderboardRow } from '../../../lib/api/social';
import { avatarLetter } from '../logic';
import { PositionMarker } from './LeaderboardBits';

/**
 * Buddy leaderboard — ranked by session-days THIS calendar month (design
 * law 2: consistency ranking, capped 1/day, buddy-circle only — never a
 * global kg leaderboard, never XP/rank). The caller's own row is included
 * and highlighted. Tapping a buddy's row surfaces their recent synced
 * workout summaries via the existing buddy feed (see BuddyContent's tap
 * handler) — this component only renders the ranking and reports the tap.
 *
 * Positions come from the server when present (competition ranking — tied
 * buddies SHARE a position instead of one arbitrarily "winning" by list
 * order); older servers without the field get the same rule computed
 * locally from sessionDays. Top 3 share the public board's flat medal
 * discs so the two boards read as one system.
 *
 * When the caller is behind, a one-line nudge says exactly how many
 * session-days catch the buddy directly above them — the actionable version
 * of "you're 3rd".
 */

interface Props {
  rows: LeaderboardRow[];
  month: string;
  onSelectBuddy: (accountId: string) => void;
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

  // Server position when present; identical competition ranking computed
  // locally otherwise (rows arrive sorted by sessionDays desc either way).
  const localPositions = competitionPositions(rows.map((r) => r.sessionDays));
  const positionOf = (row: LeaderboardRow, i: number): number =>
    row.position ?? localPositions[i]!;

  // "1 session-day catches Alex" — actionable gap to the next rung above.
  const meRow = rows.find((r) => r.isMe);
  const hint = meRow ? catchUpHint(meRow.sessionDays, rows.map((r) => r.sessionDays)) : null;
  const aheadName = hint
    ? rows.find((r) => !r.isMe && r.sessionDays === hint.targetDays)?.displayName
    : undefined;

  return (
    <View style={styles.list}>
      <AppText variant="caption" style={styles.hint}>
        Session-days in {monthLabel(month)} — one per day, buddies only.
      </AppText>
      {rows.map((row, i) => {
        const position = positionOf(row, i);
        // Me-row rides the red block — BLACK ink on red (brand law), never
        // white-on-red. Everyone else stays charcoal with the usual text ramp.
        const content = (
          <View style={[styles.row, row.isMe && styles.rowMe]}>
            <View style={styles.rankWrap}>
              <PositionMarker position={position} ink={row.isMe ? colors.onBlock : undefined} />
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
                <AppText
                  variant="bodyBold"
                  numberOfLines={1}
                  style={styles.nameText}
                  color={row.isMe ? colors.onBlock : undefined}
                >
                  {row.isMe ? 'You' : row.displayName}
                </AppText>
              </View>
              {/* 13px black at 0.8 over red stays ≥4.5:1 (screen precedent). */}
              <AppText
                variant="caption"
                color={row.isMe ? colors.onBlock : undefined}
                style={row.isMe ? styles.meDim : undefined}
              >
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

      {hint !== null ? (
        <View style={styles.catchUpRow}>
          <Ionicons name="trending-up" size={13} color={colors.textDim} />
          <AppText variant="caption">
            {hint.sessionsNeeded} more session{hint.sessionsNeeded === 1 ? '' : 's'} catch
            {aheadName ? ` ${aheadName}` : ' the buddy ahead'}.
          </AppText>
        </View>
      ) : (
        <View style={styles.catchUpRow}>
          <Ionicons name="ribbon-outline" size={13} color={colors.textDim} />
          <AppText variant="caption">You&apos;re setting the pace this month.</AppText>
        </View>
      )}
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
  // The caller's row is the list's red highlight block — fill contrast, not
  // a stroke (borders on cards = bug in the block language).
  rowMe: {
    backgroundColor: colors.blockRed,
  },
  // Secondary black ink on red: 0.8 keeps 13px captions ≥4.5:1.
  meDim: { opacity: 0.8 },
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
  catchUpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.xs,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  emptyText: { paddingHorizontal: spacing.lg },
});
