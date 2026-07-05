import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, touch, radius } from '@gym/ui-tokens';
import {
  AppText,
  enterDown,
  enterFade,
  enterUp,
  PressableScale,
  Screen,
} from '../components/ui';
import { BuddySummarySheet } from '../features/buddy/components/BuddySummarySheet';
import { PublicLeaderboard } from '../features/buddy/components/PublicLeaderboard';
import { useBuddyData } from '../features/buddy/hooks';
import {
  getPublicLeaderboard,
  toGamificationError,
  type PublicLeaderboardResult,
} from '../lib/api/social';
import { todayIso } from '../lib/dates';
import { useAuth } from '../state/auth';
import { useGamificationDisplay } from '../state/gamification';

/**
 * /leaderboard — the public gym-wide consistency board, pushed from the
 * Buddy tab's "Gym leaderboard" entry card. Same screen skeleton as
 * /badges: Screen scroll, back header, load-on-focus, quiet stale/retry
 * row instead of a blocking error state.
 *
 * Ranking, privacy filtering, and the caller's absolute position all come
 * from GET /api/leaderboard/public (server-authoritative). Buddy rows reuse
 * the existing tap-through sheet; strangers' rows are not tappable.
 */

export default function PublicLeaderboardScreen() {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  // Accepted buddies gate the tap-through; their feed events power the sheet.
  const { list, events } = useBuddyData();
  const [result, setResult] = useState<PublicLeaderboardResult | null>(null);
  const [stale, setStale] = useState(false);
  const [summaryBuddy, setSummaryBuddy] = useState<{ id: string; name: string } | null>(null);

  const buddyIds = useMemo(
    () => new Set((list?.accepted ?? []).map((link) => link.buddy.id)),
    [list],
  );

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null) return;
    void (async () => {
      try {
        const next = await getPublicLeaderboard(token);
        // The session changed while the fetch was in flight — a late response
        // must not render the previous account's board.
        const current = useAuth.getState();
        if (current.status !== 'signedIn' || current.token !== token || current.user === null) {
          return;
        }
        setResult(next);
        setStale(false);
        // Server is the source of truth for the opt-out flag — reconcile the
        // account-scoped local mirror the settings toggle reads.
        useGamificationDisplay.getState().setPublicBoardHidden(current.user.id, next.me.hidden);
      } catch (err) {
        if (toGamificationError(err).code === 'unauthorized') {
          void useAuth.getState().refresh();
        }
        setStale(true);
      }
    })();
  }, [status, token]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <Screen scroll>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={goBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
        <AppText variant="heading">Gym leaderboard</AppText>
      </Animated.View>

      {status !== 'signedIn' ? (
        <Animated.View entering={enterUp(0)} style={styles.notice}>
          <AppText variant="body" color={colors.textDim}>
            Sign in to see this month&apos;s gym-wide consistency ranking.
          </AppText>
        </Animated.View>
      ) : (
        <>
          {stale ? (
            <Animated.View entering={enterFade(0)}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Showing last known state. Tap to retry."
                onPress={reload}
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
              <View style={styles.loading}>
                <ActivityIndicator size="small" color={colors.textDim} />
              </View>
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
              <PublicLeaderboard
                rows={result.rows}
                me={result.me}
                month={result.month}
                buddyIds={buddyIds}
                onSelectBuddy={(id, name) => setSummaryBuddy({ id, name })}
              />
            </Animated.View>
          )}
        </>
      )}

      {/* Buddy tap-through — identical to the Buddy tab's leaderboard sheet. */}
      <BuddySummarySheet
        visible={summaryBuddy !== null}
        onClose={() => setSummaryBuddy(null)}
        displayName={summaryBuddy?.name ?? ''}
        events={events}
        buddyId={summaryBuddy?.id ?? ''}
        todayIso={todayIso()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: { paddingVertical: spacing.xxl },
  loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
  staleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
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
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  hiddenNoteText: { flex: 1 },
});
