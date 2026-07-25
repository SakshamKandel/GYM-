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

/**
 * A pending request older than this expires server-side — the same 14-day rule
 * the oversight sweep and the coach-side inline check both enforce.
 */
const STALE_REQUEST_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The next step for a request that ended WITHOUT the member getting a coach —
 * or null when the row deserves no banner.
 *
 * 'canceled' is ambiguous on the wire: the member's own withdrawal, an admin
 * force-cancel and the 14-day auto-expiry all land as 'canceled', and the row
 * carries no cause field. Only an expiry is safely identifiable (it cannot
 * happen before the request is 14 days old), so only that gets a banner —
 * telling members a request went unanswered when they withdrew it themselves
 * would be wrong, and dismissal is component state, so a wrong banner would
 * come back on every single visit. An admin cancel still reaches the member as
 * a push + notification-inbox row.
 */
function closedRequestNotice(row: CoachRequestRow): string | null {
  if (row.status === 'declined') {
    return `${row.coachName} couldn't take you on. Browse other coaches below.`;
  }
  if (row.status !== 'canceled' || row.decidedAt === null) return null;
  const created = Date.parse(row.createdAt);
  const decided = Date.parse(row.decidedAt);
  if (Number.isNaN(created) || Number.isNaN(decided)) return null;
  if (decided - created < STALE_REQUEST_MS) return null;
  return `${row.coachName} didn't get back to you, so your request has closed. Nothing you did caused this. Pick another coach below and we'll pass your request straight on.`;
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
  const [lastClosed, setLastClosed] = useState<string | null>(null);

  // Pack L: "structured decline reason surfaced as a next step" — the coach
  // request history already carries every outcome; a member who was never
  // shown their most recent decline gets a quiet next-step banner here
  // (only when there's no pending request and no assigned coach — a
  // successful later outcome always takes priority over an old decline).
  // Widened beyond 'declined': a request the 14-day sweep auto-expired used to
  // disappear from this screen with no explanation at all.
  useFocusEffect(
    useCallback(() => {
      if (status !== 'signedIn' || token === null || coach !== null || request !== null) {
        setLastClosed(null);
        return;
      }
      let active = true;
      void listCoachRequests(token)
        .then((rows) => {
          if (!active) return;
          // Rows arrive newest-first (server orders by createdAt desc), so the
          // first row that yields a notice is the most recent outcome.
          let latest: string | null = null;
          for (const row of rows) {
            const notice = closedRequestNotice(row);
            if (notice !== null) {
              latest = notice;
              break;
            }
          }
          setLastClosed(latest);
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
          caption="Personal coaching, weekly check-ins, honest feedback."
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
          {request === null && lastClosed !== null ? (
            <Animated.View entering={enterUp(0)}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`${lastClosed} Tap to dismiss.`}
                onPress={() => setLastClosed(null)}
                style={styles.pendingRow}
              >
                <Ionicons name="information-circle-outline" size={14} color={colors.textDim} />
                <AppText variant="caption" style={styles.pendingText}>
                  {lastClosed}
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
                    ? "Couldn't load coaches. Tap to retry."
                    : 'Showing last known list. Tap to retry.'}
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
                body="Coach profiles are on the way. Check back soon."
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
                accessibilityLabel="Become a coach, apply to join the coach roster"
                onPress={() => pushPath('/coaches/apply')}
                style={styles.becomeCoachRow}
              >
                <Ionicons name="ribbon-outline" size={18} color={colors.textDim} />
                <AppText variant="caption" style={styles.becomeCoachText}>
                  Become a coach
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
