import { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { catchUpHint, daysLeftInMonth, ordinalLabel } from '@gym/shared';
import { colors, spacing, touch, radius } from '@gym/ui-tokens';
import {
  AppText,
  Chip,
  enterDown,
  enterFade,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
} from '../components/ui';
import { MovementMark } from '../features/engagement/leaderboard/LeaderboardBits';
import { PublicLeaderboard } from '../features/engagement/leaderboard/PublicLeaderboard';
import { ChallengeCard } from '../features/gamification/components/ChallengeCard';
import { useChallenge } from '../features/gamification/useChallenge';
import {
  getPublicLeaderboard,
  toGamificationError,
  type LeaderboardScope,
  type PublicLeaderboardResult,
} from '../lib/api/social';
import { todayIso } from '../lib/dates';
import { useAuth } from '../state/auth';
import { useGamificationDisplay } from '../state/gamification';

/**
 * /leaderboard — the public gym-wide consistency board, pushed from the
 * Settings "Community" section. Same screen skeleton as /badges: Screen
 * scroll, back header, load-on-focus, quiet stale/retry row instead of a
 * blocking error state — plus pull-to-refresh.
 *
 * Structure, top to bottom:
 *  1. Scope chips — the live month vs. last month's FINAL standings (the
 *     only two windows the server serves; no attendance-history trawling).
 *  2. "Your standing" card (live month only): absolute position, session
 *     count, 7-day movement, days left in the month, and an actionable
 *     catch-up line ("2 more sessions catch 4th").
 *  3. The board itself (top 50 + pinned own row when ranked below).
 *  4. The caller's active coach challenge, when one exists (relocated here
 *     from the retired Buddy tab — same monthly-consistency theme).
 *
 * Ranking, tie-sharing, privacy filtering, movement deltas, and the
 * caller's absolute position all come from GET /api/leaderboard/public
 * (server-authoritative). Rows are display-only — no tap-through.
 */

export default function PublicLeaderboardScreen() {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const challengeData = useChallenge();
  const [scope, setScope] = useState<LeaderboardScope>('current');
  const [results, setResults] = useState<Partial<Record<LeaderboardScope, PublicLeaderboardResult>>>(
    {},
  );
  const [stale, setStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(
    (which: LeaderboardScope) => {
      if (status !== 'signedIn' || token === null) return;
      void (async () => {
        try {
          const next = await getPublicLeaderboard(token, which);
          // The session changed while the fetch was in flight — a late response
          // must not render the previous account's board.
          const current = useAuth.getState();
          if (current.status !== 'signedIn' || current.token !== token || current.user === null) {
            return;
          }
          setResults((prev) => ({ ...prev, [which]: next }));
          setStale(false);
          // Server is the source of truth for the opt-out flag — reconcile the
          // account-scoped local mirror the settings toggle reads.
          useGamificationDisplay.getState().setPublicBoardHidden(current.user.id, next.me.hidden);
        } catch (err) {
          if (toGamificationError(err).code === 'unauthorized') {
            void useAuth.getState().refresh();
          }
          setStale(true);
        } finally {
          setRefreshing(false);
        }
      })();
    },
    [status, token],
  );

  useFocusEffect(
    useCallback(() => {
      reload(scope);
    }, [reload, scope]),
  );

  function switchScope(next: LeaderboardScope): void {
    if (next === scope) return;
    // No manual reload: setScope changes the focus effect's dep, which
    // re-runs it while focused — fetching here too would double-fetch.
    setScope(next);
  }

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  const result = results[scope] ?? null;
  const isFinal = scope === 'previous';

  return (
    <Screen
      scroll
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            reload(scope);
          }}
          tintColor={colors.textDim}
        />
      }
    >
      <Animated.View entering={enterDown()} style={styles.backRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={goBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>

      <ScreenHeader
        eyebrow="Consistency · whole gym"
        title="Gym leaderboard"
        style={styles.header}
      />

      {status !== 'signedIn' ? (
        <Animated.View entering={enterUp(0)} style={styles.notice}>
          <AppText variant="body" color={colors.textDim}>
            Sign in to see this month&apos;s gym-wide consistency ranking.
          </AppText>
        </Animated.View>
      ) : (
        <>
          {/* ── Scope: live month vs. last month's final standings ── */}
          <Animated.View entering={enterUp(0)} style={styles.scopeRow}>
            <Chip
              label="This month"
              selected={scope === 'current'}
              onPress={() => switchScope('current')}
            />
            <Chip
              label="Last month"
              selected={scope === 'previous'}
              onPress={() => switchScope('previous')}
            />
          </Animated.View>

          {stale ? (
            <Animated.View entering={enterFade(0)}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Showing last known state. Tap to retry."
                onPress={() => reload(scope)}
                style={styles.staleRow}
              >
                <Ionicons name="cloud-offline" size={14} color={colors.textDim} />
                <AppText variant="caption" style={styles.staleText}>
                  Showing last known state — tap to retry.
                </AppText>
                <Ionicons name="refresh" size={15} color={colors.textDim} />
              </PressableScale>
            </Animated.View>
          ) : null}

          {result === null ? (
            stale ? null : (
              <BoardSkeleton />
            )
          ) : (
            <Animated.View entering={enterUp(0)}>
              {result.me.hidden ? (
                <View style={styles.hiddenNote}>
                  <Ionicons name="eye-off-outline" size={16} color={colors.textDim} />
                  <AppText variant="caption" style={styles.hiddenNoteText}>
                    You&apos;re hidden from this board. Turn on &quot;Show me on the
                    public leaderboard&quot; in Settings to appear.
                  </AppText>
                </View>
              ) : null}

              {!isFinal && !result.me.hidden ? <StandingCard result={result} /> : null}

              <PublicLeaderboard
                rows={result.rows}
                me={result.me}
                month={result.month}
                final={isFinal}
              />

              {result.totalRanked !== null && result.totalRanked > 0 ? (
                <AppText variant="caption" color={colors.textFaint} style={styles.totalLine}>
                  {result.totalRanked} lifter{result.totalRanked === 1 ? '' : 's'} ranked
                  {isFinal ? ' that month' : ' so far this month'}.
                </AppText>
              ) : null}
            </Animated.View>
          )}

          {/* ── Coach challenge — monthly consistency, same theme ── */}
          {challengeData.challenge !== null ? (
            <Animated.View entering={enterUp(1)} style={styles.challengeWrap}>
              <SectionLabel>Coach challenge</SectionLabel>
              <ChallengeCard
                challenge={challengeData.challenge}
                onJoin={challengeData.joinCurrentChallenge}
                onJoined={challengeData.reload}
              />
            </Animated.View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

// ════════════════════════════════════════════════════════════════
// "Your standing" — the screen's ONE red hero block (REVAMP-BRIEF §2).
// Live month only. Position is the hero numeral (Oswald, black-on-red);
// movement sits in a near-black pill so MovementMark's dark-surface
// colors keep their contrast; the catch-up line rides a near-black
// inset tile with the accent icon. Black ink only — never white-on-red.
// ════════════════════════════════════════════════════════════════

function StandingCard({ result }: { result: PublicLeaderboardResult }) {
  const { me, rows } = result;
  const daysLeft = daysLeftInMonth(todayIso());
  const meVisible = rows.some((r) => r.isMe);

  // Actionable line under the numbers. Catch-up math is exact when the
  // caller is on the visible board (everyone above them is visible too);
  // below the top 50 we talk about reaching the board instead.
  let actionLine: string | null = null;
  if (me.position === null) {
    actionLine = 'One ranked session puts you on the board.';
  } else if (me.position === 1) {
    actionLine = 'You lead the gym this month. Keep showing up.';
  } else if (meVisible) {
    const hint = catchUpHint(me.sessionDays, rows.map((r) => r.sessionDays));
    if (hint !== null) {
      actionLine = `${hint.sessionsNeeded} more session${hint.sessionsNeeded === 1 ? '' : 's'} catch ${ordinalLabel(hint.targetPosition)} place.`;
    }
  } else if (rows.length > 0) {
    const lastVisible = rows[rows.length - 1]!;
    const gap = lastVisible.sessionDays - me.sessionDays;
    actionLine =
      gap <= 0
        ? 'One more session breaks into the top 50.'
        : `${gap + 1} more session${gap + 1 === 1 ? '' : 's'} break into the top 50.`;
  }

  return (
    <View
      style={styles.standingCard}
      accessible
      accessibilityLabel={
        me.position === null
          ? `Not ranked yet — ${me.sessionDays} sessions this month`
          : `Your standing: ${ordinalLabel(me.position)} with ${me.sessionDays} sessions this month`
      }
    >
      <AppText variant="label" color={colors.onBlock}>
        Your standing
      </AppText>
      <View style={styles.standingTop}>
        <View style={styles.standingPosition}>
          <AppText
            variant="stat"
            color={colors.onBlock}
            style={me.position === null ? styles.standingUnranked : null}
          >
            {me.position === null ? '—' : ordinalLabel(me.position)}
          </AppText>
          {me.delta !== null ? (
            <View style={styles.movementPill}>
              <MovementMark delta={me.delta} available={me.delta !== null} />
            </View>
          ) : null}
        </View>
        <View style={styles.standingStats}>
          <AppText variant="caption" color={colors.onBlock} style={styles.standingDim}>
            {me.sessionDays} session-day{me.sessionDays === 1 ? '' : 's'} this month
          </AppText>
          <AppText variant="caption" color={colors.onBlock} style={styles.standingDim}>
            {daysLeft === 0 ? 'Last day of the month' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
          </AppText>
        </View>
      </View>
      {actionLine !== null ? (
        <View style={styles.standingAction}>
          <Ionicons name="trending-up" size={16} color={colors.accent} />
          <AppText variant="body" color={colors.text} style={styles.standingActionText}>
            {actionLine}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Loading skeleton — six quiet placeholder rows instead of a spinner,
// matching the row geometry so the board doesn't jump when data lands.
// ════════════════════════════════════════════════════════════════

function BoardSkeleton() {
  return (
    <Animated.View entering={enterFade(0)} style={styles.skeletonList} accessibilityLabel="Loading leaderboard">
      {Array.from({ length: 6 }, (_, i) => (
        <View key={i} style={styles.skeletonRow}>
          <View style={styles.skeletonRank} />
          <View style={styles.skeletonAvatar} />
          <View style={styles.skeletonLines}>
            <View style={styles.skeletonLineWide} />
            <View style={styles.skeletonLineNarrow} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backRow: { marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.gutter },
  notice: { paddingVertical: spacing.xxl },
  scopeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  staleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: touch.min,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  staleText: { flex: 1 },
  hiddenNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  hiddenNoteText: { flex: 1 },

  // Your standing — the ONE red hero block. No border (block language:
  // separation by fill contrast), chunky radius, black ink throughout.
  standingCard: {
    backgroundColor: colors.blockRed,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  standingTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  standingPosition: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  // Large 56px numeral: black at 0.6 over red stays ≥3:1 (large-text bar).
  standingUnranked: { opacity: 0.6 },
  // Secondary 13px captions: black at 0.8 over red stays ≥4.5:1.
  standingDim: { opacity: 0.8 },
  // Near-black pill so MovementMark's dark-surface palette keeps contrast
  // on the red block (filled chip-inside-block pattern, brief §6).
  movementPill: {
    backgroundColor: colors.onBlock,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  standingStats: { flex: 1, gap: 2, alignItems: 'flex-end' },
  // Catch-up line: near-black inset tile (radius.md inside radius.block),
  // light text on the near-black fill — never white directly on red.
  standingAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.onBlock,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  standingActionText: { flex: 1 },

  totalLine: { marginTop: spacing.md },

  challengeWrap: { marginTop: spacing.lg },

  // Skeleton
  skeletonList: { gap: spacing.sm },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: touch.min,
    paddingVertical: spacing.sm,
  },
  skeletonRank: {
    width: 28,
    height: 14,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
  },
  skeletonAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceRaised,
  },
  skeletonLines: { flex: 1, gap: 6 },
  skeletonLineWide: {
    width: '55%',
    height: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
  },
  skeletonLineNarrow: {
    width: '30%',
    height: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
  },
});
