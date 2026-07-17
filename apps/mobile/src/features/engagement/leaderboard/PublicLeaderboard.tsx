import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ordinalLabel } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, RankEmblem, TierAvatarFrame } from '../../../components/ui';
import type { PublicLeaderboardResult, PublicLeaderboardRow } from '../../../lib/api/social';
import { avatarLetter } from '../invite/logic';
import { MovementMark, PositionMarker } from './LeaderboardBits';

/**
 * Public gym-wide consistency leaderboard — ranked by session-days in the
 * scoped calendar month ONLY (design law: never kg, never XP, tier is visual
 * identity and never affects order). Server does the ranking, tie-sharing,
 * privacy filtering, and 7-day movement; this component only renders what
 * it's given.
 *
 * PRIVACY LAW: rows are plain Views, NOT links — a row exposes only
 * name/avatar/tier/rank/position/session-days/movement and never taps
 * through to anyone's workouts.
 *
 * Visual language: top 3 get a flat metal medal disc (no glow, no gradient —
 * the ONE solid fill mirrors the earned-rank metal palette), everyone else a
 * tabular ordinal. Ties share a position (server competition ranking), so
 * two 2nds are both medalled. Movement is a quiet ▲/▼ caption vs. a week
 * ago; "new" marks members who weren't on the board then.
 *
 * The caller's own row is highlighted; when they rank outside the visible
 * list, a pinned "You — Nth" footer row shows their absolute position.
 */

interface Props {
  rows: PublicLeaderboardRow[];
  me: PublicLeaderboardResult['me'];
  month: string;
  /** True when showing LAST month's final standings (no movement column). */
  final?: boolean;
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return 'this month';
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long' });
}

export function PublicLeaderboard({ rows, me, month, final = false }: Props) {
  if (rows.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="podium-outline" size={32} color={colors.textFaint} />
        <AppText variant="caption" center style={styles.emptyText}>
          {final
            ? `No ranked sessions in ${monthLabel(month)} — the board was empty that month.`
            : `No ranked sessions yet in ${monthLabel(month)} — first session puts you on the board.`}
        </AppText>
      </View>
    );
  }

  const meVisible = rows.some((r) => r.isMe);
  // Movement renders only when the server actually computed it — otherwise
  // every row would read "new" during the first week of a month.
  const movementAvailable = !final && rows.some((r) => r.delta !== null);

  return (
    <View style={styles.list}>
      <AppText variant="caption" style={styles.hint}>
        {final
          ? `${monthLabel(month)} final standings — session-days, one per day.`
          : `Session-days in ${monthLabel(month)} — one per day, whole gym.`}
      </AppText>

      {rows.map((row) => (
        // Me-row rides the red block — BLACK ink on red (brand law), never
        // white-on-red. Movement keeps its dark-surface palette by sitting in
        // a near-black pill (filled chip-inside-block pattern, brief §6).
        <View key={row.accountId} style={[styles.row, row.isMe && styles.rowMe]}>
          <View style={styles.rankWrap}>
            <PositionMarker position={row.position} ink={row.isMe ? colors.onBlock : undefined} />
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
              {/* Earned rank medal — ring only (no level number in public). */}
              <RankEmblem rank={row.rank} size={20} />
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
          {row.isMe && movementAvailable ? (
            <View style={styles.movementPill}>
              <MovementMark delta={row.delta} available={movementAvailable} />
            </View>
          ) : (
            <MovementMark delta={row.delta} available={movementAvailable} />
          )}
        </View>
      ))}

      {/* Caller ranks below the visible list — pin their absolute position.
          Same red block treatment as the in-list me-row: black ink on red. */}
      {!meVisible && !me.hidden && me.position !== null ? (
        <View style={[styles.row, styles.rowMe]}>
          <View style={styles.rankWrap}>
            <PositionMarker position={me.position} ink={colors.onBlock} />
          </View>
          <View style={styles.info}>
            <AppText variant="bodyBold" color={colors.onBlock}>
              You — {ordinalLabel(me.position)} · {me.sessionDays} session
              {me.sessionDays === 1 ? '' : 's'}
            </AppText>
          </View>
          {movementAvailable ? (
            <View style={styles.movementPill}>
              <MovementMark delta={me.delta} available={movementAvailable} />
            </View>
          ) : null}
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
  // The caller's row is the list's red highlight block — fill contrast, not
  // a stroke (borders on cards = bug in the block language).
  rowMe: {
    backgroundColor: colors.blockRed,
  },
  // Secondary black ink on red: 0.8 keeps 13px captions ≥4.5:1.
  meDim: { opacity: 0.8 },
  // Near-black pill so MovementMark's dark-surface palette keeps its
  // contrast on the red block (mirrors the StandingCard pattern).
  movementPill: {
    backgroundColor: colors.onBlock,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
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
