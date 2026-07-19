import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  EmptyState,
  enterDown,
  enterFade,
  enterUp,
  PhotoHero,
  PressableScale,
  Screen,
  ScreenHeader,
  SkeletonRow,
  stockImages,
} from '../../components/ui';
import { EmptyArt } from '../../components/visual';
import { CoachCard } from '../../features/mentorship/components/CoachCard';
import { listCoachRequests, type CoachRequestRow } from '../../features/mentorship/api';
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
  header: { marginBottom: spacing.md },
  banner: { marginBottom: spacing.gutter },
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
  becomeCoachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: touch.min,
    marginTop: spacing.md,
  },
  becomeCoachText: { flex: 1 },
  skeletons: { gap: spacing.sm },
  skeletonRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
});

export default function CoachDirectoryScreen() {
  const status = useAuth((s) => s.status);
  const staffRole = useAuth((s) => s.staffRole);
  const token = useAuth((s) => s.token);
  const { coaches, loading, error, retry } = useCoachDirectory();
  const { coach, request } = useMyCoach();
  const [lastDeclined, setLastDeclined] = useState<CoachRequestRow | null>(null);

  // Pack L: "structured decline reason surfaced as a next step" — the coach
  // request history already carries every outcome; a member who was never
  // shown their most recent decline gets a quiet next-step banner here
  // (only when there's no pending request and no assigned coach — a
  // successful later outcome always takes priority over an old decline).
  useFocusEffect(
    useCallback(() => {
      if (status !== 'signedIn' || token === null || coach !== null || request !== null) {
        setLastDeclined(null);
        return;
      }
      let active = true;
      void listCoachRequests(token)
        .then((rows) => {
          if (!active) return;
          // Rows arrive newest-first (server orders by createdAt desc).
          const latest = rows.find((r) => r.status === 'declined') ?? null;
          setLastDeclined(latest);
        })
        .catch(() => {
          // Best-effort — the banner just doesn't show this visit.
        });
      return () => {
        active = false;
      };
    }, [status, token, coach, request]),
  );

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

      {/* Mood banner — decorative dark stock photo under the shared photo-hero
          treatment (scrim + red chip + white ink). The header and cards carry
          the real information. */}
      <Animated.View entering={enterUp(0)}>
        <PhotoHero
          source={stockImages.overheadPressWoman}
          size="banner"
          recyclingKey="coaches-banner"
          accessibilityLabel="A coach pressing a barbell overhead"
          chip={{ label: 'Mentorship' }}
          title="Train with a real coach"
          caption="Personal plans, weekly check-ins, honest feedback."
          style={styles.banner}
        />
      </Animated.View>

      {status !== 'signedIn' ? (
        <Animated.View entering={enterUp(0)}>
          <EmptyState
            icon="people"
            title="Sign in to find a coach"
            body="Coach profiles, requests and 1-on-1 chat live on your account."
            art={<EmptyArt variant="coach" />}
            actionLabel="Sign in"
            onAction={() => pushPath('/auth/sign-in')}
          />
        </Animated.View>
      ) : (
        <>
          {request === null && lastDeclined !== null ? (
            <Animated.View entering={enterUp(0)}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Your request to ${lastDeclined.coachName} wasn't accepted. Tap to browse other coaches`}
                onPress={() => setLastDeclined(null)}
                style={styles.pendingRow}
              >
                <Ionicons name="information-circle-outline" size={14} color={colors.textDim} />
                <AppText variant="caption" style={styles.pendingText}>
                  {`${lastDeclined.coachName} couldn't take you on — browse other coaches below.`}
                </AppText>
                <Ionicons name="close" size={15} color={colors.textDim} />
              </PressableScale>
            </Animated.View>
          ) : null}

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
                art={<EmptyArt variant="coach" />}
              />
            </Animated.View>
          ) : coaches !== null ? (
            <Animated.View entering={enterUp(0)} style={styles.list}>
              {coaches.map((coach) => (
                <CoachCard key={coach.id} coach={coach} />
              ))}
            </Animated.View>
          ) : null}

          {/* Hidden for accounts that already hold the staff coach role — the
              API would 409 already_coach anyway, but there's nothing to apply
              for. Any other staff role (or a plain member) still sees it. */}
          {staffRole !== 'coach' ? (
            <Animated.View entering={enterUp(1)}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Become a coach — apply to join the coach roster"
                onPress={() => pushPath('/coaches/apply')}
                style={styles.becomeCoachRow}
              >
                <Ionicons name="ribbon-outline" size={18} color={colors.textDim} />
                <AppText variant="caption" style={styles.becomeCoachText}>
                  Become a coach — apply to join the roster
                </AppText>
                <Ionicons name="chevron-forward" size={15} color={colors.textDim} />
              </PressableScale>
            </Animated.View>
          ) : null}
        </>
      )}
    </Screen>
  );
}
