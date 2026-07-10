import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  EmptyState,
  enterDown,
  enterFade,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SkeletonRow,
} from '../../components/ui';
import { CoachCard } from '../../features/mentorship/components/CoachCard';
import { useCoachDirectory, useMyCoach } from '../../features/mentorship/hooks';
import { pushPath } from '../../features/mentorship/nav';
import { useAuth } from '../../state/auth';

/**
 * /coaches — the Coach Discovery Hub. Browse every coach on the platform,
 * see who's taking clients, and tap through to a full profile. If the
 * member already sent a request, a quiet banner links back to that coach.
 *
 * Same screen skeleton as /leaderboard: Screen scroll, back circle,
 * ScreenHeader, load-on-focus with skeleton rows and a quiet retry row —
 * never a blocking error screen.
 */

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
  // Quiet pending-request banner: charcoal row, tap-through to the coach.
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: touch.min,
    marginBottom: spacing.md,
  },
  pendingText: { flex: 1 },
  retryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: touch.min,
    marginBottom: spacing.md,
  },
  retryText: { flex: 1 },
  list: { gap: spacing.sm },
  skeletons: { gap: spacing.sm },
  skeletonRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
});

export default function CoachDirectoryScreen() {
  const status = useAuth((s) => s.status);
  const { coaches, loading, error, retry } = useCoachDirectory();
  const { request } = useMyCoach();

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <Screen scroll>
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

      <ScreenHeader eyebrow="Find your coach" title="Coaches" style={styles.header} />

      {status !== 'signedIn' ? (
        <Animated.View entering={enterUp(0)}>
          <EmptyState
            icon="people"
            title="Sign in to find a coach"
            body="Coach profiles, requests and 1-on-1 chat live on your account."
            actionLabel="Sign in"
            onAction={() => pushPath('/auth/sign-in')}
          />
        </Animated.View>
      ) : (
        <>
          {request !== null ? (
            <Animated.View entering={enterUp(0)}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Request sent to ${request.coachName}. Tap to view`}
                onPress={() => pushPath(`/coaches/${request.coachId}`)}
                style={styles.pendingRow}
              >
                <Ionicons name="paper-plane-outline" size={14} color={colors.textDim} />
                <AppText variant="caption" style={styles.pendingText}>
                  Request sent to {request.coachName} · tap to view
                </AppText>
                <Ionicons name="chevron-forward" size={15} color={colors.textDim} />
              </PressableScale>
            </Animated.View>
          ) : null}

          {error ? (
            <Animated.View entering={enterFade(0)}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Couldn't load coaches. Tap to retry."
                onPress={retry}
                style={styles.retryRow}
              >
                <Ionicons name="cloud-offline" size={14} color={colors.textDim} />
                <AppText variant="caption" style={styles.retryText}>
                  {coaches === null
                    ? "Couldn't load coaches — tap to retry."
                    : 'Showing last known list — tap to retry.'}
                </AppText>
                <Ionicons name="refresh" size={15} color={colors.textDim} />
              </PressableScale>
            </Animated.View>
          ) : null}

          {loading ? (
            <Animated.View entering={enterFade(0)} style={styles.skeletons} accessibilityLabel="Loading coaches">
              {Array.from({ length: 4 }, (_, i) => (
                <SkeletonRow key={i} style={styles.skeletonRow} />
              ))}
            </Animated.View>
          ) : coaches !== null && coaches.length === 0 ? (
            <Animated.View entering={enterUp(0)}>
              <EmptyState
                icon="people"
                title="No coaches yet"
                body="Coach profiles are on the way — check back soon."
              />
            </Animated.View>
          ) : coaches !== null ? (
            <Animated.View entering={enterUp(0)} style={styles.list}>
              {coaches.map((coach) => (
                <CoachCard key={coach.id} coach={coach} />
              ))}
            </Animated.View>
          ) : null}
        </>
      )}
    </Screen>
  );
}
