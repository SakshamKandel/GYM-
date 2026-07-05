import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Divider,
  enterFade,
  enterUp,
  FLOATING_TAB_SPACE,
  HeroCard,
  layoutSpring,
  PressableScale,
  Screen,
  SectionLabel,
  Tag,
} from '../../components/ui';
import { pushPath } from '../../features/auth/nav';
import { todayIso } from '../../lib/dates';
import { useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';
import { useBuddyData, useSocialData } from '../../features/buddy/hooks';
import {
  endLiveSession,
  joinLiveSession,
  removeLink,
  respondInvite,
  sendInvite,
  sendNudge,
  sendReferral,
  startLiveSession,
} from '../../features/buddy/actions';
import { BuddySummarySheet } from '../../features/buddy/components/BuddySummarySheet';
import { Leaderboard } from '../../features/buddy/components/Leaderboard';
import { QuestCard } from '../../features/buddy/components/QuestCard';
import {
  avatarLetter,
  BUDDY_LIMIT,
  inviteErrorLine,
  joinSessionErrorLine,
  lastTrainedLabel,
  referralErrorLine,
  referralStatusLabel,
  weekDots,
} from '../../features/buddy/logic';
import { nudgedToday, useBuddyStore } from '../../features/buddy/store';
import { ChallengeCard } from '../../features/gamification/components/ChallengeCard';
import type {
  BuddyErrorCode,
  BuddyEvent,
  BuddyLink,
  BuddySession,
  Referral,
} from '../../lib/api/client';

/** Buddy — pair up, train live, and refer friends for rewards. */

export default function BuddyScreen() {
  const status = useAuth((s) => s.status);
  const { list, events, sessions, referrals, stale, reload } =
    useBuddyData();
  const social = useSocialData();

  if (status !== 'signedIn') {
    return <SignedOutView />;
  }

  return (
    <BuddyContent
      list={list}
      events={events}
      sessions={sessions}
      referrals={referrals}
      stale={stale}
      reload={reload}
      social={social}
    />
  );
}

// ════════════════════════════════════════════════════════════════
// Signed-out view — nudge to sign in
// ════════════════════════════════════════════════════════════════

function SignedOutView() {
  return (
    <Screen scroll bottomInset={FLOATING_TAB_SPACE}>
      <Animated.View entering={enterUp(0)}>
        <HeroCard mascot tone="surface">
          <AppText variant="label" color={colors.accent}>
            GYM BUDDY
          </AppText>
          <AppText variant="heading" style={styles.heroTitle}>
            Train together, stay accountable
          </AppText>
          <AppText variant="caption">
            Sign in to add friends, start live sessions, and unlock referral rewards.
          </AppText>
        </HeroCard>
      </Animated.View>
      <View style={styles.signedOutBtns}>
        <Button label="Sign in" variant="primary" onPress={() => router.push('/auth/sign-in')} />
        <Button
          label="Create account"
          variant="secondary"
          onPress={() => router.push('/auth/sign-up')}
        />
      </View>
    </Screen>
  );
}

// ════════════════════════════════════════════════════════════════
// Main content
// ════════════════════════════════════════════════════════════════

interface ContentProps {
  list: ReturnType<typeof useBuddyData>['list'];
  events: ReturnType<typeof useBuddyData>['events'];
  sessions: BuddySession[];
  referrals: Referral[];
  stale: boolean;
  reload: () => void;
  social: ReturnType<typeof useSocialData>;
}

function BuddyContent({
  list,
  events,
  sessions,
  referrals,
  stale,
  reload,
  social,
}: ContentProps) {
  const tier = useProfile((s) => s.tier);
  const myId = useAuth((s) => s.user?.id ?? null);
  const [summaryBuddy, setSummaryBuddy] = useState<{ id: string; name: string } | null>(null);
  // Join gating must mirror the SERVER's check, which compares the host's
  // account tier against the caller's account tier (both from the DB). The
  // local profile tier can be stale — it only ever upgrades, never downgrades
  // (see auth.ts adoptServerUser) — so gating on it wrongly blocks or enables
  // joins after a tier change. Use the server-authoritative auth tier, falling
  // back to the local profile tier only when signed out / not yet hydrated.
  const authTier = useAuth((s) => s.user?.tier ?? null);
  const joinTier = authTier ?? tier;
  const accepted = list?.accepted ?? [];
  const pendingIn = list?.pendingIn ?? [];
  const pendingOut = list?.pendingOut ?? [];
  // The server list includes my own active session — split it out so the
  // join list only ever shows buddies' sessions.
  const mySession = sessions.find((s) => s.host.id === myId) ?? null;
  const buddySessions = sessions.filter((s) => s.host.id !== myId);

  return (
    <Screen scroll keyboardAware bottomInset={FLOATING_TAB_SPACE}>
      <Animated.View entering={enterUp(0)}>
        <AppText variant="heading">Buddy</AppText>
        <AppText variant="caption" style={styles.subtitle}>
          Pair up, train live, and grow together.
        </AppText>
      </Animated.View>

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

      {/* ── Pending incoming invites ──────────────────────────── */}
      {pendingIn.length > 0 ? (
        <View>
          <SectionLabel>Pending invites</SectionLabel>
          {pendingIn.map((link) => (
            <PendingInviteRow
              key={link.linkId}
              link={link}
              onRespond={async (accept) => {
                await respondInvite(link.linkId, accept);
                reload();
              }}
            />
          ))}
        </View>
      ) : null}

      {/* ── Add a friend ──────────────────────────────────────── */}
      <View>
        <SectionLabel>Add a friend</SectionLabel>
        <InviteForm
          buddyCount={accepted.length}
          onSent={() => reload()}
        />
      </View>

      {/* ── Accepted buddies ──────────────────────────────────── */}
      {accepted.length > 0 ? (
        <View>
          <SectionLabel>
            {`Your buddies · ${accepted.length}/${BUDDY_LIMIT}`}
          </SectionLabel>
          {accepted.map((link) => (
            <BuddyRow
              key={link.linkId}
              link={link}
              events={events}
              subtitle={lastTrainedLabel(events, link.buddy.id, todayIso())}
              tier={tier}
              onNudge={async () => {
                await sendNudge(link.linkId);
                reload();
              }}
              onRemove={async () => {
                await removeLink(link.linkId);
                reload();
              }}
            />
          ))}
        </View>
      ) : (
        <Animated.View entering={enterFade(0)} style={styles.emptyState}>
          <Ionicons name="people-outline" size={40} color={colors.textFaint} />
          <AppText variant="caption" center style={styles.emptyText}>
            No buddies yet — invite a friend above to get started.
          </AppText>
        </Animated.View>
      )}

      {/* ── Pending outgoing ──────────────────────────────────── */}
      {pendingOut.length > 0 ? (
        <View>
          <SectionLabel>Sent requests</SectionLabel>
          {pendingOut.map((link) => (
            <PendingOutRow
              key={link.linkId}
              link={link}
              onCancel={async () => {
                await removeLink(link.linkId);
                reload();
              }}
            />
          ))}
        </View>
      ) : null}

      {accepted.length > 0 ? (
        <>
          <Divider />

          {/* ── Coach challenge ────────────────────────────────── */}
          {social.challenge !== null ? (
            <View>
              <SectionLabel>Coach challenge</SectionLabel>
              <ChallengeCard
                challenge={social.challenge}
                onJoin={social.joinCurrentChallenge}
                onJoined={social.reload}
              />
            </View>
          ) : null}

          {/* ── Buddy quest ────────────────────────────────────── */}
          <View>
            <SectionLabel>Buddy quest</SectionLabel>
            <QuestCard pairs={social.questPairs} target={social.questTarget} />
          </View>

          {/* ── Leaderboard ────────────────────────────────────── */}
          <View>
            <SectionLabel>This month&apos;s leaderboard</SectionLabel>
            <Leaderboard
              rows={social.leaderboard}
              month={social.leaderboardMonth}
              onSelectBuddy={(id) => {
                const row = social.leaderboard.find((r) => r.accountId === id);
                setSummaryBuddy({ id, name: row?.displayName || 'Buddy' });
              }}
            />
          </View>
        </>
      ) : null}

      {/* ── Public gym leaderboard ────────────────────────────── */}
      {/* Always visible (works with zero buddies) — the whole-gym board
          lives on its own pushed screen, ranked by session-days only. */}
      <View>
        <SectionLabel>Gym leaderboard</SectionLabel>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Open the gym leaderboard — this month's consistency ranking, whole gym"
          onPress={() => pushPath('/leaderboard')}
          style={styles.publicBoardCard}
        >
          <View style={styles.publicBoardIcon}>
            <Ionicons name="podium" size={20} color={colors.accent} />
          </View>
          <View style={styles.buddyInfo}>
            <AppText variant="bodyBold">This month&apos;s consistency ranking</AppText>
            <AppText variant="caption">Whole gym — session-days, one per day.</AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
        </PressableScale>
      </View>

      <Divider />

      {/* ── Live sessions ─────────────────────────────────────── */}
      <View>
        <SectionLabel>Live sessions</SectionLabel>
        <LiveSessionSection
          sessions={buddySessions}
          tier={joinTier}
          onJoin={async (sessionId) => {
            return joinLiveSession(sessionId);
          }}
          onReload={reload}
        />
        <StartSessionForm
          onStart={async (workoutName) => {
            const session = await startLiveSession(workoutName);
            if (session) reload();
            return session !== null;
          }}
          onEnd={async (sessionId) => {
            await endLiveSession(sessionId);
            reload();
          }}
          mySession={mySession}
        />
      </View>

      <Divider />

      {/* ── Referral program ──────────────────────────────────── */}
      <View>
        <SectionLabel>Refer & earn</SectionLabel>
        <ReferralSection
          referrals={referrals}
          onRefer={async (email) => {
            return sendReferral(email);
          }}
          onReload={reload}
        />
      </View>

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

// ════════════════════════════════════════════════════════════════
// Invite form
// ════════════════════════════════════════════════════════════════

function InviteForm({ buddyCount, onSent }: { buddyCount: number; onSent: () => void }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const atLimit = buddyCount >= BUDDY_LIMIT;

  async function handleSend() {
    if (!email.trim() || sending || atLimit) return;
    setSending(true);
    setError(null);
    setSuccess(false);
    const code = await sendInvite(email);
    setSending(false);
    if (code === null) {
      setEmail('');
      setSuccess(true);
      onSent();
    } else {
      setError(inviteErrorLine(code));
    }
  }

  return (
    <View style={styles.formCard}>
      {atLimit ? (
        <AppText variant="caption" color={colors.warning}>
          You&apos;ve hit the {BUDDY_LIMIT}-buddy limit. Remove a buddy to add someone new.
        </AppText>
      ) : (
        <>
          <AppTextInput
            value={email}
            onChangeText={setEmail}
            placeholder="friend@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            onSubmitEditing={handleSend}
            style={styles.textInput}
          />
          <Button
            label={sending ? 'Sending…' : 'Send invite'}
            onPress={handleSend}
            disabled={!email.trim() || sending}
            loading={sending}
            style={styles.formBtn}
          />
          {success ? (
            <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
              <AppText variant="caption" color={colors.success} style={styles.formMsg}>
                Invite sent! They&apos;ll appear here once they accept.
              </AppText>
            </Animated.View>
          ) : null}
          {error ? (
            <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
              <AppText variant="caption" color={colors.error} style={styles.formMsg}>
                {error}
              </AppText>
            </Animated.View>
          ) : null}
        </>
      )}
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Buddy row (accepted)
// ════════════════════════════════════════════════════════════════

function BuddyRow({
  link,
  events,
  subtitle,
  tier,
  onNudge,
  onRemove,
}: {
  link: BuddyLink;
  events: BuddyEvent[];
  subtitle: string;
  tier: string;
  onNudge: () => void;
  onRemove: () => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const today = todayIso();
  const nudged = nudgedToday(
    useBuddyStore.getState().nudgedByLink,
    link.linkId,
    today,
  );
  const dots = useMemo(
    () => weekDots(events, link.buddy.id, today),
    [events, link.buddy.id, today],
  );
  const trainedDays = dots.filter(Boolean).length;

  return (
    <Animated.View style={styles.buddyCard} layout={layoutSpring}>
      <View style={styles.buddyTop}>
        <View style={styles.avatar}>
          <AppText variant="title" color={colors.accent}>
            {avatarLetter(link.buddy.displayName)}
          </AppText>
        </View>
        <View style={styles.buddyInfo}>
          <AppText variant="title" style={styles.buddyName}>
            {link.buddy.displayName || link.buddy.email}
          </AppText>
          <AppText variant="caption">{subtitle}</AppText>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={showActions ? 'Hide details' : 'Show details'}
          accessibilityState={{ expanded: showActions }}
          onPress={() => setShowActions((v) => !v)}
          style={styles.iconBtn}
        >
          <Ionicons
            name={showActions ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={colors.textDim}
          />
        </PressableScale>
      </View>

      {showActions ? (
        <Animated.View
          entering={enterFade(0)}
          exiting={FadeOut.duration(120)}
          style={styles.buddyExpand}
        >
          <View>
            <AppText variant="label" color={colors.textDim} style={styles.weekLabel}>
              This week
            </AppText>
            <View
              style={styles.weekStrip}
              accessible
              accessibilityLabel={`Trained ${trainedDays} of 7 days this week`}
            >
              {dots.map((on, i) => (
                <View key={i} style={[styles.weekDot, on && styles.weekDotOn]} />
              ))}
            </View>
          </View>
          <View style={styles.buddyActions}>
            <Button
              label={nudged ? 'Nudged today' : 'Nudge'}
              variant="secondary"
              disabled={nudged}
              onPress={onNudge}
              style={styles.actionBtn}
            />
            <Button
              label="Remove"
              variant="danger"
              onPress={() => {
                onRemove();
                setShowActions(false);
              }}
              style={styles.actionBtn}
            />
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

// ════════════════════════════════════════════════════════════════
// Pending invite row (incoming)
// ════════════════════════════════════════════════════════════════

function PendingInviteRow({
  link,
  onRespond,
}: {
  link: BuddyLink;
  onRespond: (accept: boolean) => void;
}) {
  return (
    <View style={styles.buddyCard}>
      <View style={styles.buddyTop}>
        <View style={styles.avatar}>
          <AppText variant="title" color={colors.accent}>
            {avatarLetter(link.buddy.displayName)}
          </AppText>
        </View>
        <View style={styles.buddyInfo}>
          <AppText variant="title" style={styles.buddyName}>
            {link.buddy.displayName || link.buddy.email}
          </AppText>
          <AppText variant="caption">wants to be your buddy</AppText>
        </View>
      </View>
      <View style={styles.buddyActions}>
        <Button label="Accept" variant="primary" onPress={() => onRespond(true)} style={styles.actionBtn} />
        <Button label="Decline" variant="secondary" onPress={() => onRespond(false)} style={styles.actionBtn} />
      </View>
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Pending outgoing row
// ════════════════════════════════════════════════════════════════

function PendingOutRow({ link, onCancel }: { link: BuddyLink; onCancel: () => void }) {
  return (
    <View style={styles.buddyCard}>
      <View style={styles.buddyTop}>
        <View style={styles.avatar}>
          <AppText variant="title" color={colors.textDim}>
            {avatarLetter(link.buddy.displayName)}
          </AppText>
        </View>
        <View style={styles.buddyInfo}>
          <AppText variant="title" style={styles.buddyName}>
            {link.buddy.displayName || link.buddy.email}
          </AppText>
          <AppText variant="caption">waiting for response…</AppText>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Cancel invite"
          onPress={onCancel}
          style={styles.iconBtn}
        >
          <Ionicons name="close" size={20} color={colors.textDim} />
        </PressableScale>
      </View>
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Live status dot — a solid accent dot with a slow radiating halo: a
// genuine "broadcasting" indicator for an active session. The halo is
// ambient motion, so it's disabled under reduced motion (the solid dot
// remains as the static status marker).
// ════════════════════════════════════════════════════════════════

function LiveDot() {
  const reduceMotion = useReducedMotion();
  const ping = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      ping.value = 0;
      return;
    }
    ping.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
    return () => cancelAnimation(ping);
  }, [reduceMotion, ping]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: (1 - ping.value) * 0.4,
    transform: [{ scale: 1 + ping.value * 2.4 }],
  }));

  return (
    <View style={styles.liveDotWrap}>
      {reduceMotion ? null : (
        <Animated.View pointerEvents="none" style={[styles.liveHalo, haloStyle]} />
      )}
      <View style={styles.liveDot} />
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Live session section
// ════════════════════════════════════════════════════════════════

function LiveSessionSection({
  sessions,
  tier,
  onJoin,
  onReload,
}: {
  sessions: BuddySession[];
  tier: string;
  onJoin: (sessionId: string) => Promise<BuddyErrorCode | null>;
  onReload: () => void;
}) {
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin(sessionId: string) {
    setJoining(sessionId);
    setError(null);
    const code = await onJoin(sessionId);
    setJoining(null);
    if (code === null) {
      onReload();
    } else {
      setError(joinSessionErrorLine(code));
    }
  }

  if (sessions.length === 0) {
    return (
      <Animated.View entering={enterFade(0)} style={styles.emptyState}>
        <Ionicons name="barbell-outline" size={36} color={colors.textFaint} />
        <AppText variant="caption" center style={styles.emptyText}>
          No active live sessions. Start one below or wait for a buddy to go live.
        </AppText>
      </Animated.View>
    );
  }

  return (
    <View style={styles.sessionList}>
      {error ? (
        <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
          <AppText variant="caption" color={colors.error} style={styles.formMsg}>
            {error}
          </AppText>
        </Animated.View>
      ) : null}
      {sessions.map((session) => (
        <View key={session.id} style={styles.sessionCard}>
          <View style={styles.sessionTop}>
            <LiveDot />
            <AppText variant="label" color={colors.accent}>
              LIVE
            </AppText>
          </View>
          <View style={styles.sessionBody}>
            <View style={styles.avatar}>
              <AppText variant="title" color={colors.accent}>
                {avatarLetter(session.host.displayName)}
              </AppText>
            </View>
            <View style={styles.buddyInfo}>
              <AppText variant="title" style={styles.buddyName}>
                {session.host.displayName}
              </AppText>
              <AppText variant="caption">{session.workoutName}</AppText>
              <View style={styles.tierRow}>
                <Tag
                  label={session.host.tier.toUpperCase()}
                  variant="dim"
                  color={colors.textDim}
                />
                {session.host.tier === tier ? (
                  <Tag label="SAME PLAN" variant="outline" color={colors.success} />
                ) : (
                  <Tag label="DIFFERENT PLAN" variant="dim" color={colors.warning} />
                )}
              </View>
            </View>
          </View>
          <Button
            label={joining === session.id ? 'Joining…' : 'Join session'}
            variant="primary"
            loading={joining === session.id}
            onPress={() => handleJoin(session.id)}
            disabled={session.host.tier !== tier}
            style={styles.formBtn}
          />
          {session.host.tier !== tier ? (
            <AppText variant="caption" color={colors.warning} style={styles.formMsg}>
              {joinSessionErrorLine('tier_mismatch')}
            </AppText>
          ) : null}
        </View>
      ))}
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Start session form
// ════════════════════════════════════════════════════════════════

function StartSessionForm({
  onStart,
  onEnd,
  mySession,
}: {
  onStart: (workoutName: string) => Promise<boolean>;
  onEnd: (sessionId: string) => Promise<void>;
  mySession: BuddySession | null;
}) {
  const [workoutName, setWorkoutName] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(false);

  async function handleStart() {
    if (!workoutName.trim() || starting) return;
    setStarting(true);
    setError(false);
    const ok = await onStart(workoutName);
    setStarting(false);
    if (ok) {
      setWorkoutName('');
    } else {
      setError(true);
    }
  }

  if (mySession) {
    return (
      <View style={styles.mySessionCard}>
        <View style={styles.sessionTop}>
          <LiveDot />
          <AppText variant="label" color={colors.accent}>
            YOUR SESSION IS LIVE
          </AppText>
        </View>
        <AppText variant="title" style={styles.mySessionName}>
          {mySession.workoutName}
        </AppText>
        <Button
          label="End session"
          variant="danger"
          onPress={() => onEnd(mySession.id)}
          style={styles.formBtn}
        />
      </View>
    );
  }

  return (
    <View style={styles.formCard}>
      <AppText variant="caption" style={styles.formHint}>
        Start a live workout and let your buddies join in real time.
      </AppText>
      <AppTextInput
        value={workoutName}
        onChangeText={setWorkoutName}
        placeholder="Workout name (e.g. Push Day)"
        returnKeyType="send"
        onSubmitEditing={handleStart}
        style={styles.textInput}
      />
      <Button
        label={starting ? 'Starting…' : 'Start live session'}
        variant="primary"
        onPress={handleStart}
        disabled={!workoutName.trim() || starting}
        loading={starting}
        style={styles.formBtn}
      />
      {error ? (
        <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
          <AppText variant="caption" color={colors.error} style={styles.formMsg}>
            Couldn&apos;t start the session — try again in a bit.
          </AppText>
        </Animated.View>
      ) : null}
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Referral section
// ════════════════════════════════════════════════════════════════

function ReferralSection({
  referrals,
  onRefer,
  onReload,
}: {
  referrals: Referral[];
  onRefer: (email: string) => Promise<BuddyErrorCode | null>;
  onReload: () => void;
}) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleRefer() {
    if (!email.trim() || sending) return;
    setSending(true);
    setError(null);
    setSuccess(false);
    const code = await onRefer(email);
    setSending(false);
    if (code === null) {
      setEmail('');
      setSuccess(true);
      onReload();
    } else {
      setError(referralErrorLine(code));
    }
  }

  const joinedCount = referrals.filter((r) => r.status === 'joined' || r.status === 'rewarded').length;

  return (
    <View>
      <View style={styles.referralHero}>
        <Ionicons name="gift-outline" size={28} color={colors.accent} />
        <View style={styles.referralHeroText}>
          <AppText variant="title">Invite friends, earn discounts</AppText>
          <AppText variant="caption">
            For every friend who joins, you both get a subscription discount.
            {joinedCount > 0 ? ` ${joinedCount} friend${joinedCount > 1 ? 's' : ''} joined so far!` : ''}
          </AppText>
        </View>
      </View>

      <View style={styles.formCard}>
        <AppTextInput
          value={email}
          onChangeText={setEmail}
          placeholder="friend@email.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          onSubmitEditing={handleRefer}
          style={styles.textInput}
        />
        <Button
          label={sending ? 'Sending…' : 'Send referral'}
          variant="primary"
          onPress={handleRefer}
          disabled={!email.trim() || sending}
          loading={sending}
          style={styles.formBtn}
        />
        {success ? (
          <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
            <AppText variant="caption" color={colors.success} style={styles.formMsg}>
              Referral sent! You&apos;ll get a discount when they join.
            </AppText>
          </Animated.View>
        ) : null}
        {error ? (
          <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
            <AppText variant="caption" color={colors.error} style={styles.formMsg}>
              {error}
            </AppText>
          </Animated.View>
        ) : null}
      </View>

      {referrals.length > 0 ? (
        <View style={styles.referralList}>
          {referrals.map((ref, i) => (
            <Animated.View
              key={ref.id}
              entering={enterFade(i)}
              layout={layoutSpring}
              style={styles.referralRow}
            >
              <View style={styles.avatar}>
                <AppText variant="title" color={colors.textDim}>
                  {avatarLetter(ref.inviteeEmail)}
                </AppText>
              </View>
              <View style={styles.buddyInfo}>
                <AppText style={styles.referralEmail}>{ref.inviteeEmail}</AppText>
                <AppText
                  variant="caption"
                  color={
                    ref.status === 'rewarded'
                      ? colors.success
                      : ref.status === 'joined'
                        ? colors.accent
                        : colors.textDim
                  }
                >
                  {referralStatusLabel(ref.status)}
                </AppText>
              </View>
              {ref.status === 'joined' || ref.status === 'rewarded' ? (
                <Ionicons name="checkmark-circle" size={22} color={colors.success} />
              ) : (
                <Ionicons name="hourglass-outline" size={22} color={colors.textFaint} />
              )}
            </Animated.View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Styles
// ════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  heroTitle: { fontSize: 25, lineHeight: 32 },
  signedOutBtns: { gap: spacing.md, marginTop: spacing.xl },

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

  // Cards
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  textInput: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
  },
  formBtn: { marginTop: spacing.xs },
  formMsg: { marginTop: spacing.xs },
  formHint: { marginBottom: spacing.xs },

  // Buddy card
  buddyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  buddyTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buddyInfo: { flex: 1, gap: 2 },
  buddyName: { fontSize: 17 },
  iconBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buddyActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionBtn: { flex: 1 },
  buddyExpand: { gap: spacing.md },
  weekLabel: { marginBottom: spacing.xs },
  weekStrip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  weekDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceRaised,
  },
  weekDotOn: { backgroundColor: colors.accent },

  // Public leaderboard entry card
  publicBoardCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  publicBoardIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.accentFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  emptyText: { paddingHorizontal: spacing.xl },

  // Live sessions
  sessionList: { gap: spacing.md },
  sessionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.accentFaint,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sessionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveDotWrap: {
    width: 8,
    height: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveHalo: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  sessionBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  tierRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  mySessionCard: {
    backgroundColor: colors.accentFaint,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.accent,
    padding: spacing.lg,
    gap: spacing.md,
    marginTop: spacing.md,
  },
  mySessionName: { fontSize: 18 },

  // Referrals
  referralHero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  referralHeroText: { flex: 1, gap: 4 },
  referralList: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  referralRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  referralEmail: {
    fontFamily: type.body,
    fontSize: 15,
    color: colors.text,
  },

});
