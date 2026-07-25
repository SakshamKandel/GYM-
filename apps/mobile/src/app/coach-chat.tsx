import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { hasEntitlement } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  Card,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  UpgradePrompt,
} from '../components/ui';
import { CoachThread } from '../features/coach/components/CoachThread';
import { useMyCoach } from '../features/mentorship/hooks';
import { pushPath } from '../features/mentorship/nav';
import { BASE_URL, fetchWithTimeout } from '../lib/api/client';
import { useEffectiveTier } from '../lib/tier';
import { useAuth } from '../state/auth';

/**
 * /coach-chat — 1-on-1 coach chat. Unlocked for Elite (the classic Greece
 * thread) AND for any member with an ASSIGNED coach (the server allows
 * assigned members regardless of tier). Everyone else sees the upgrade sell
 * plus a route into the coach directory.
 *
 * THE ENTITLEMENT IS NOT THE WHOLE STORY. Coach chat needs a real person on the
 * other end: the server refuses to store a message with no active assignment
 * behind it (no fabricated coach, no AI standing in). An Elite member with
 * nobody assigned used to get the full live screen anyway — a header promising
 * replies from a coach who did not exist, and a composer where every send
 * bounced back looking like a connection problem. So the tier still gates the
 * FEATURE, and the assignment gates the THREAD: no coach means the waiting
 * state below, with a way into the directory, instead of a composer.
 *
 * Header is the compact chat pattern (not the huge poster header): back
 * circle → coach avatar → title + caption, so the thread owns the screen.
 */

const NEWIE = require('../../assets/images/newie.png');

const AVATAR = 40;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachAvatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  headerText: { flex: 1 },
  headerAction: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gateWrap: { gap: spacing.lg, paddingTop: spacing.xl },
  unassignCard: { gap: spacing.sm },
  unassignActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  unassignBtn: { flex: 1 },
  waitCard: { gap: spacing.sm },
  waitBtn: { marginTop: spacing.xs },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

function Header({
  title,
  caption,
  coachName = 'Greece',
  avatarUrl = null,
  action,
}: {
  title: string;
  caption?: string;
  coachName?: string;
  avatarUrl?: string | null;
  /** Optional trailing control (the end-coaching action on a live thread). */
  action?: ReactNode;
}) {
  return (
    <Animated.View entering={enterDown()} style={styles.header}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={4}
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace('/');
        }}
        style={styles.backBtn}
      >
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </PressableScale>
      <Image
        source={avatarUrl !== null ? { uri: avatarUrl } : NEWIE}
        style={styles.coachAvatar}
        contentFit="cover"
        contentPosition="top"
        accessibilityLabel={coachName}
      />
      <View style={styles.headerText}>
        <AppText variant="title">{title}</AppText>
        {caption ? <AppText variant="caption">{caption}</AppText> : null}
      </View>
      {action ?? null}
    </Animated.View>
  );
}

/**
 * DELETE /api/me/coach — end MY OWN coaching.
 *
 * Scoped to the caller by the server (it only ever ends the assignment the
 * bearer token owns), so there is nothing to address here beyond the session.
 * Nothing in the reply is consumed, only whether it worked, hence no payload
 * parsing: 'noCoach' is the harmless race where it already ended somewhere else.
 */
async function endMyCoaching(token: string): Promise<'ok' | 'noCoach' | 'failed'> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE_URL}/api/me/coach`, {
      method: 'DELETE',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
  } catch {
    return 'failed';
  }
  if (res.ok) return 'ok';
  return res.status === 404 ? 'noCoach' : 'failed';
}

/** Last-known assigned coach, persisted so an unassign (coach → null) can
 * still name who it was and offer a rating — B21/Pack L, member side. */
interface LastCoach {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

function lastCoachKey(accountId: string): string {
  return `last-assigned-coach:${accountId}`;
}

function unassignDismissedKey(accountId: string, coachId: string): string {
  return `coach-unassign-dismissed:${accountId}:${coachId}`;
}

export default function CoachChatScreen() {
  const tier = useEffectiveTier();
  const { coach, request, loaded, reload } = useMyCoach();
  const accountId = useAuth((s) => s.user?.id ?? null);
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const token = useAuth((s) => s.token);
  const [unassigned, setUnassigned] = useState<LastCoach | null>(null);
  const [ending, setEnding] = useState(false);

  // An ASSIGNED coach unlocks the thread for ANY tier — the server now
  // accepts assigned members; the Elite entitlement stays the other door in.
  const unlocked = coach !== null || hasEntitlement({ tier }, 'coach_chat');
  const coachName = coach?.displayName ?? 'Greece';

  // Every branch below turns on "do I have a coach", and until the first lookup
  // of this session lands the honest answer is "we don't know" — guessing
  // flashes the wrong screen at everyone who does have one. Signed out there is
  // nothing to wait for.
  //
  // The wait is BOUNDED. useMyCoach stays quiet through failures (it keeps the
  // last-known state rather than showing an error), so offline it never
  // resolves, and an unbounded wait would be a spinner that never ends. After
  // the grace window we stop claiming to know: an entitled member gets the
  // thread as before, and if a send does turn out to have no coach behind it
  // the composer now says exactly that.
  const [waitedOut, setWaitedOut] = useState(false);
  useEffect(() => {
    if (!signedIn || loaded) {
      setWaitedOut(false);
      return;
    }
    const timer = setTimeout(() => setWaitedOut(true), 4000);
    return () => clearTimeout(timer);
  }, [signedIn, loaded]);

  const resolving = signedIn && !loaded && !waitedOut;
  /** True when we still have no answer and have stopped waiting for one. */
  const coachUnknown = signedIn && !loaded && waitedOut;

  /** Two-step end of the coaching relationship, member side. */
  function confirmEndCoaching(): void {
    if (ending || token === null || coach === null) return;
    const name = coach.displayName;
    Alert.alert(
      'End coaching?',
      `${name} comes off your coach list and this chat closes. You keep everything you have logged, and you can ask for a new coach whenever you want.`,
      [
        { text: 'Keep coaching', style: 'cancel' },
        {
          text: 'End coaching',
          style: 'destructive',
          onPress: () => {
            setEnding(true);
            void (async () => {
              const outcome = await endMyCoaching(token);
              setEnding(false);
              if (outcome === 'failed') {
                Alert.alert(
                  "Couldn't end coaching",
                  'Check your connection and try again in a moment.',
                );
                return;
              }
              // 'ok' and 'noCoach' land in the same place: no coach. Re-read so
              // the screen swaps to the waiting state (and the banner naming
              // who it was) instead of holding a thread nobody can answer.
              reload();
            })();
          },
        },
      ],
    );
  }

  // Track the last assigned coach locally so a silent unassign (B21: the
  // server ends the assignment with no member-visible trace beyond the push)
  // still gets a banner here naming who it was and a way to rate them.
  useEffect(() => {
    if (!loaded || accountId === null) return;
    if (coach !== null) {
      void AsyncStorage.setItem(
        lastCoachKey(accountId),
        JSON.stringify({ id: coach.id, displayName: coach.displayName, avatarUrl: coach.avatarUrl }),
      );
      setUnassigned(null);
      return;
    }
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(lastCoachKey(accountId));
        if (!raw) return;
        const last = JSON.parse(raw) as LastCoach;
        const dismissed = await AsyncStorage.getItem(unassignDismissedKey(accountId, last.id));
        if (!dismissed) setUnassigned(last);
      } catch {
        // Best-effort — worst case the banner just doesn't appear.
      }
    })();
  }, [loaded, coach, accountId]);

  function dismissUnassigned(): void {
    if (accountId !== null && unassigned) {
      void AsyncStorage.setItem(unassignDismissedKey(accountId, unassigned.id), '1');
      void AsyncStorage.removeItem(lastCoachKey(accountId));
    }
    setUnassigned(null);
  }

  const unassignBanner =
    unassigned !== null ? (
      <Animated.View entering={enterUp(0)}>
        <Card style={styles.unassignCard}>
          <AppText variant="bodyBold">Your coaching with {unassigned.displayName} has ended</AppText>
          <AppText variant="caption" color={colors.textDim}>
            You can find a new coach, or leave {unassigned.displayName} a rating first.
          </AppText>
          <View style={styles.unassignActions}>
            <Button
              label="Rate coach"
              variant="secondary"
              onPress={() =>
                pushPath(
                  `/coach-review?coachId=${encodeURIComponent(unassigned.id)}&coachName=${encodeURIComponent(unassigned.displayName)}`,
                )
              }
              style={styles.unassignBtn}
            />
            <Button
              label="Browse coaches"
              variant="secondary"
              onPress={() => pushPath('/coaches')}
              style={styles.unassignBtn}
            />
          </View>
          <Button label="Dismiss" variant="ghost" onPress={dismissUnassigned} />
        </Card>
      </Animated.View>
    ) : null;

  if (resolving) {
    return (
      <Screen>
        <Header title="Coach chat" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </Screen>
    );
  }

  if (!unlocked) {
    return (
      <Screen scroll>
        <Header title="Coach chat" />
        <View style={styles.gateWrap}>
          {unassignBanner}
          <UpgradePrompt
            requiredTier="elite"
            title="1-on-1 coach chat"
            description="Message Greece directly and get personal guidance."
          />
          <Button
            label="Browse coaches"
            variant="secondary"
            onPress={() => router.push('/coaches' as Href)}
          />
        </View>
      </Screen>
    );
  }

  // Entitled, and we KNOW nobody is on the other end. A composer here would
  // take a message the server refuses to store, so show what is actually
  // happening and the one thing that changes it.
  if (coach === null && !coachUnknown) {
    return (
      <Screen scroll>
        <Header title="Coach chat" />
        <View style={styles.gateWrap}>
          {unassignBanner}
          <Card style={styles.waitCard}>
            <AppText variant="title">
              {request !== null ? 'Waiting on your coach' : 'No coach yet'}
            </AppText>
            <AppText variant="body" color={colors.textDim}>
              {request !== null
                ? `You asked ${request.coachName} to take you on. This chat opens as soon as they say yes.`
                : 'Your chat opens as soon as a coach takes you on. Have a look at who is available and send one a request.'}
            </AppText>
            <Button
              label="Browse coaches"
              variant={request !== null ? 'secondary' : 'primary'}
              onPress={() => pushPath('/coaches')}
              style={styles.waitBtn}
            />
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={{ bottom: true }}>
      <Header
        title="Coach chat"
        caption={`Message ${coachName} directly`}
        coachName={coachName}
        avatarUrl={coach?.avatarUrl ?? null}
        action={
          // Only offered when we actually know who the coach is; there is
          // nothing to confirm ending otherwise.
          coach !== null ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="End coaching"
              accessibilityHint={`Takes ${coachName} off your coach list`}
              hitSlop={4}
              disabled={ending}
              onPress={confirmEndCoaching}
              style={styles.headerAction}
            >
              {ending ? (
                <ActivityIndicator color={colors.textDim} />
              ) : (
                <Ionicons name="person-remove-outline" size={20} color={colors.textDim} />
              )}
            </PressableScale>
          ) : null
        }
      />
      <CoachThread
        kind="coach_chat"
        coachName={coachName}
        emptyTitle={`Say hello to ${coachName}`}
        emptyBody={`Ask about your training, form, or nutrition. ${coachName} reviews these personally and replies within 24h.`}
        placeholder={`Message ${coachName}…`}
        starters={[
          "How's my training looking?",
          'Any tips for my squat form?',
          'What should I eat post-workout?',
        ]}
      />
    </Screen>
  );
}
