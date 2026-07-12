import { useMemo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Card,
  ConfirmDialog,
  enterFade,
  enterUp,
  FLOATING_TAB_SPACE,
  FractionStat,
  IconChip,
  layoutSpring,
  PressableScale,
  Screen,
  ScreenHeader,
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
  isSessionParticipant,
  joinedBuddies,
  joinedBuddiesLabel,
  joinSessionErrorLine,
  lastTrainedLabel,
  referralErrorLine,
  referralStatusLabel,
  weekDots,
} from '../../features/buddy/logic';
import { nudgedToday, unreadForLink, useBuddyStore } from '../../features/buddy/store';
import { ChallengeCard } from '../../features/gamification/components/ChallengeCard';
import type {
  BuddyErrorCode,
  BuddyEvent,
  BuddyLink,
  BuddySession,
  BuddySessionParticipant,
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
// Meta chip — outlined pill under the screen title (brief §6).
// Chips are allowed borders; the no-border law is for cards.
// ════════════════════════════════════════════════════════════════

function MetaChip({ label }: { label: string }) {
  return (
    <View style={styles.metaChip}>
      <AppText variant="label" color={colors.text}>
        {label}
      </AppText>
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Signed-out view — red hero block carries the invite to sign in
// ════════════════════════════════════════════════════════════════

function SignedOutView() {
  return (
    <Screen scroll bottomInset={FLOATING_TAB_SPACE}>
      <ScreenHeader eyebrow="Gym buddy" title="Buddy" />
      <Animated.View entering={enterUp(1)} style={styles.heroWrap}>
        <Card variant="red" style={styles.heroCard}>
          <AppText variant="title" color={colors.onBlock}>
            Train together, stay accountable
          </AppText>
          <AppText variant="body" color={colors.onBlock}>
            Sign in to add friends, start live sessions, and unlock referral rewards.
          </AppText>
          <Button
            label="Sign in"
            variant="onBlock"
            onPress={() => router.push('/auth/sign-in')}
            style={styles.formBtn}
          />
        </Card>
      </Animated.View>
      <View style={styles.signedOutBtns}>
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
  // Fed by useBuddyData's 12s poll (getUnread) and by pushRefresh on an
  // incoming 'buddy_message' push — reactive so a badge appears/clears
  // without the buddy needing to re-open the tab.
  const unread = useBuddyStore((s) => s.unread);
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
      <ScreenHeader
        eyebrow="Gym buddy"
        title="Buddy"
        meta={
          <>
            <MetaChip label={sessions.length > 0 ? 'Live now' : 'Team'} />
            <MetaChip label={`${accepted.length}/${BUDDY_LIMIT} buddies`} />
          </>
        }
      />

      {stale ? (
        <Animated.View entering={enterFade(0)}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Showing last known state. Tap to retry."
            onPress={reload}
            style={styles.staleRow}
          >
            <Ionicons name="cloud-offline" size={14} color={colors.textDim} />
            <AppText variant="body" color={colors.textDim} style={styles.staleText}>
              Showing last known state — tap to retry.
            </AppText>
            <Ionicons name="refresh" size={15} color={colors.textDim} />
          </PressableScale>
        </Animated.View>
      ) : null}

      {/* ── Red hero: buddy crew summary ──────────────────────── */}
      <Animated.View entering={enterUp(1)} style={styles.heroWrap}>
        <Card variant="red" style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <AppText variant="label" color={colors.onBlock}>
              Your crew
            </AppText>
            {sessions.length > 0 ? <Tag label="Live now" variant="onBlock" /> : null}
          </View>
          <FractionStat value={accepted.length} total={BUDDY_LIMIT} onBlock />
          <AppText variant="body" color={colors.onBlock}>
            {sessions.length > 0
              ? 'A training session is live. Join in, send support, and keep the streak moving.'
              : 'Pair up, train live, and use friendly pressure to stay consistent.'}
          </AppText>
        </Card>
      </Animated.View>

      {/* ── Pending incoming invites ──────────────────────────── */}
      {pendingIn.length > 0 ? (
        <View>
          <SectionLabel>Pending invites</SectionLabel>
          {pendingIn.map((link) => (
            <PendingInviteRow
              key={link.linkId}
              link={link}
              onRespond={async (accept) => {
                const ok = await respondInvite(link.linkId, accept);
                reload();
                return ok;
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
              unread={unreadForLink(unread, link.linkId)}
              onNudge={async () => {
                const ok = await sendNudge(link.linkId);
                reload();
                return ok;
              }}
              onRemove={async () => {
                const ok = await removeLink(link.linkId);
                reload();
                return ok;
              }}
            />
          ))}
        </View>
      ) : (
        <Animated.View entering={enterFade(0)} style={styles.emptyState}>
          <Ionicons name="people-outline" size={40} color={colors.textFaint} />
          <AppText variant="body" color={colors.textDim} center style={styles.emptyText}>
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
                const ok = await removeLink(link.linkId);
                reload();
                return ok;
              }}
            />
          ))}
        </View>
      ) : null}

      {accepted.length > 0 ? (
        <>
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
          <IconChip icon="podium" color={colors.accentFaint} iconColor={colors.accent} />
          <View style={styles.buddyInfo}>
            <AppText variant="bodyBold">This month&apos;s consistency ranking</AppText>
            <AppText variant="caption">Whole gym — session-days, one per day.</AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
        </PressableScale>
      </View>

      {/* ── Live sessions ─────────────────────────────────────── */}
      <View>
        <SectionLabel>Live sessions</SectionLabel>
        <LiveSessionSection
          sessions={buddySessions}
          tier={joinTier}
          myId={myId}
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
            const ok = await endLiveSession(sessionId);
            reload();
            return ok;
          }}
          mySession={mySession}
        />
      </View>

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
        <AppText variant="body" color={colors.warning}>
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
              <AppText variant="body" color={colors.success} style={styles.formMsg}>
                Invite sent! They&apos;ll appear here once they accept.
              </AppText>
            </Animated.View>
          ) : null}
          {error ? (
            <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
              <AppText variant="body" color={colors.error} style={styles.formMsg}>
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
  unread,
  onNudge,
  onRemove,
}: {
  link: BuddyLink;
  events: BuddyEvent[];
  subtitle: string;
  tier: string;
  /** Unread DM count from this buddy — feeds the chat button's badge. */
  unread: number;
  onNudge: () => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const [showActions, setShowActions] = useState(false);
  // One in-flight action per row: both buttons disable together so a slow
  // network can't queue duplicate nudges/removes from double-taps.
  const [busy, setBusy] = useState<'nudge' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Removing a buddy hard-deletes the pair's DM history for BOTH sides
  // (buddy_messages cascades off buddy_links) — irreversible, so this needs
  // an explicit confirm instead of a single tap.
  const [confirmingRemove, setConfirmingRemove] = useState(false);
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

  async function handleNudge() {
    if (busy !== null) return;
    setBusy('nudge');
    setError(null);
    const ok = await onNudge();
    setBusy(null);
    if (!ok) setError(inviteErrorLine('network'));
  }

  async function handleRemove() {
    if (busy !== null) return;
    setBusy('remove');
    setError(null);
    const ok = await onRemove();
    setBusy(null);
    if (ok) setShowActions(false);
    else setError(inviteErrorLine('network'));
  }

  return (
    <Animated.View style={styles.buddyCard} layout={layoutSpring}>
      <View style={styles.buddyTop}>
        <View style={styles.avatar}>
          <AppText variant="title" color={colors.accent}>
            {avatarLetter(link.buddy.displayName)}
          </AppText>
        </View>
        <View style={styles.buddyInfo}>
          <AppText variant="bodyBold">
            {link.buddy.displayName || link.buddy.email}
          </AppText>
          <AppText variant="caption">{subtitle}</AppText>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={
            unread > 0
              ? `Message ${link.buddy.displayName || 'buddy'}, ${unread} unread`
              : `Message ${link.buddy.displayName || 'buddy'}`
          }
          onPress={() =>
            pushPath(
              `/buddy/chat/${encodeURIComponent(link.linkId)}?name=${encodeURIComponent(
                link.buddy.displayName || 'Buddy',
              )}`,
            )
          }
          style={styles.iconBtn}
        >
          <Ionicons name="chatbubble-outline" size={20} color={colors.textDim} />
          {unread > 0 ? (
            <View style={styles.chatBadge} accessibilityLabel={`${unread} unread`}>
              <AppText variant="label" color={colors.onBlock} tabular>
                {unread > 9 ? '9+' : String(unread)}
              </AppText>
            </View>
          ) : null}
        </PressableScale>
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
              label={nudged ? 'Nudged today' : busy === 'nudge' ? 'Nudging…' : 'Nudge'}
              variant="secondary"
              disabled={nudged || busy !== null}
              loading={busy === 'nudge'}
              onPress={handleNudge}
              style={styles.actionBtn}
            />
            <Button
              label={busy === 'remove' ? 'Removing…' : 'Remove'}
              variant="danger"
              disabled={busy !== null}
              loading={busy === 'remove'}
              onPress={() => setConfirmingRemove(true)}
              style={styles.actionBtn}
            />
          </View>
          {error ? (
            <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
              <AppText variant="body" color={colors.error} style={styles.formMsg}>
                {error}
              </AppText>
            </Animated.View>
          ) : null}
        </Animated.View>
      ) : null}

      <ConfirmDialog
        visible={confirmingRemove}
        title={`Remove ${link.buddy.displayName || 'this buddy'}?`}
        message="This permanently deletes your chat history with them for both of you — it can't be undone."
        confirmLabel="Remove"
        cancelLabel="Keep buddy"
        danger
        onConfirm={() => {
          setConfirmingRemove(false);
          void handleRemove();
        }}
        onCancel={() => setConfirmingRemove(false)}
      />
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
  onRespond: (accept: boolean) => Promise<boolean>;
}) {
  // Both buttons disable while EITHER response is in flight — a double-tap
  // (or Accept-then-Decline) must not fire two conflicting responses.
  const [responding, setResponding] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRespond(accept: boolean) {
    if (responding !== null) return;
    setResponding(accept ? 'accept' : 'decline');
    setError(null);
    const ok = await onRespond(accept);
    setResponding(null);
    if (!ok) setError(inviteErrorLine('network'));
  }

  return (
    <View style={styles.buddyCard}>
      <View style={styles.buddyTop}>
        <View style={styles.avatar}>
          <AppText variant="title" color={colors.accent}>
            {avatarLetter(link.buddy.displayName)}
          </AppText>
        </View>
        <View style={styles.buddyInfo}>
          <AppText variant="bodyBold">
            {link.buddy.displayName || link.buddy.email}
          </AppText>
          <AppText variant="caption">wants to be your buddy</AppText>
        </View>
      </View>
      <View style={styles.buddyActions}>
        <Button
          label="Accept"
          variant="primary"
          onPress={() => handleRespond(true)}
          disabled={responding !== null}
          loading={responding === 'accept'}
          style={styles.actionBtn}
        />
        <Button
          label="Decline"
          variant="secondary"
          onPress={() => handleRespond(false)}
          disabled={responding !== null}
          loading={responding === 'decline'}
          style={styles.actionBtn}
        />
      </View>
      {error ? (
        <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
          <AppText variant="body" color={colors.error} style={styles.formMsg}>
            {error}
          </AppText>
        </Animated.View>
      ) : null}
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Pending outgoing row
// ════════════════════════════════════════════════════════════════

function PendingOutRow({ link, onCancel }: { link: BuddyLink; onCancel: () => Promise<boolean> }) {
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    if (canceling) return;
    setCanceling(true);
    setError(null);
    const ok = await onCancel();
    setCanceling(false);
    if (!ok) setError(inviteErrorLine('network'));
  }

  return (
    <View style={styles.buddyCard}>
      <View style={styles.buddyTop}>
        <View style={styles.avatar}>
          <AppText variant="title" color={colors.textDim}>
            {avatarLetter(link.buddy.displayName)}
          </AppText>
        </View>
        <View style={styles.buddyInfo}>
          <AppText variant="bodyBold">
            {link.buddy.displayName || link.buddy.email}
          </AppText>
          <AppText variant="caption">waiting for response…</AppText>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Cancel invite"
          accessibilityState={{ disabled: canceling }}
          disabled={canceling}
          onPress={handleCancel}
          style={styles.iconBtn}
        >
          <Ionicons name="close" size={20} color={colors.textDim} />
        </PressableScale>
      </View>
      {error ? (
        <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
          <AppText variant="body" color={colors.error} style={styles.formMsg}>
            {error}
          </AppText>
        </Animated.View>
      ) : null}
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Live status dot — a static solid accent dot. The block language bans
// looping/pulsing motion, so "live" reads through the red dot + LIVE
// label, not animation.
// ════════════════════════════════════════════════════════════════

function LiveDot() {
  return <View style={styles.liveDot} />;
}

// ════════════════════════════════════════════════════════════════
// Participant chips — compact "who's in this session" row.
// ════════════════════════════════════════════════════════════════

function ParticipantChips({
  participants,
  chipStyle,
}: {
  participants: BuddySessionParticipant[];
  /** Override the chip fill — needed on surfaceRaised cards (my-session) so
   * the chip doesn't disappear against a same-tone background. */
  chipStyle?: StyleProp<ViewStyle>;
}) {
  if (participants.length === 0) return null;
  return (
    <View style={styles.participantChips}>
      {participants.map((p) => (
        <View key={p.accountId} style={[styles.participantChip, chipStyle]}>
          <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
            {p.displayName}
          </AppText>
        </View>
      ))}
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Live session section
// ════════════════════════════════════════════════════════════════

function LiveSessionSection({
  sessions,
  tier,
  myId,
  onJoin,
  onReload,
}: {
  sessions: BuddySession[];
  tier: string;
  myId: string | null;
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
        <AppText variant="body" color={colors.textDim} center style={styles.emptyText}>
          No active live sessions. Start one below or wait for a buddy to go live.
        </AppText>
      </Animated.View>
    );
  }

  return (
    <View style={styles.sessionList}>
      {error ? (
        <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
          <AppText variant="body" color={colors.error} style={styles.formMsg}>
            {error}
          </AppText>
        </Animated.View>
      ) : null}
      {sessions.map((session) => {
        const alreadyJoined = isSessionParticipant(session, myId);
        const others = joinedBuddies(session);
        return (
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
                <AppText variant="bodyBold">
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
            <ParticipantChips participants={others} />
            <Button
              label={alreadyJoined ? 'Joined' : joining === session.id ? 'Joining…' : 'Join session'}
              variant={alreadyJoined ? 'secondary' : 'primary'}
              loading={joining === session.id}
              onPress={() => handleJoin(session.id)}
              disabled={alreadyJoined || session.host.tier !== tier}
              style={styles.formBtn}
            />
            {!alreadyJoined && session.host.tier !== tier ? (
              <AppText variant="body" color={colors.warning} style={styles.formMsg}>
                {joinSessionErrorLine('tier_mismatch')}
              </AppText>
            ) : null}
          </View>
        );
      })}
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
  onEnd: (sessionId: string) => Promise<boolean>;
  mySession: BuddySession | null;
}) {
  const [workoutName, setWorkoutName] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);

  async function handleEnd(sessionId: string) {
    if (ending) return;
    setEnding(true);
    setEndError(null);
    const ok = await onEnd(sessionId);
    setEnding(false);
    if (!ok) setEndError(inviteErrorLine('network'));
  }

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
    const buddies = joinedBuddies(mySession);
    return (
      <View style={styles.mySessionCard}>
        <View style={styles.sessionTop}>
          <LiveDot />
          <AppText variant="label" color={colors.accent}>
            YOUR SESSION IS LIVE
          </AppText>
        </View>
        <AppText variant="title">
          {mySession.workoutName}
        </AppText>
        <AppText variant="caption" color={colors.textDim}>
          {joinedBuddiesLabel(mySession)}
        </AppText>
        <ParticipantChips participants={buddies} chipStyle={styles.participantChipOnRaised} />
        <Button
          label={ending ? 'Ending…' : 'End session'}
          variant="danger"
          disabled={ending}
          loading={ending}
          onPress={() => handleEnd(mySession.id)}
          style={styles.formBtn}
        />
        {endError ? (
          <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
            <AppText variant="body" color={colors.error} style={styles.formMsg}>
              {endError}
            </AppText>
          </Animated.View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.formCard}>
      <AppText variant="body" color={colors.textDim}>
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
          <AppText variant="body" color={colors.error} style={styles.formMsg}>
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
      {/* Cream counterpoint block (the screen's one cream card, brief §2) */}
      <Card variant="cream" style={styles.referralCream}>
        <Ionicons name="gift-outline" size={28} color={colors.onBlock} />
        <View style={styles.referralHeroText}>
          <AppText variant="title" color={colors.onBlock}>
            Invite friends, earn discounts
          </AppText>
          <AppText variant="body" color={colors.creamDim}>
            For every friend who joins, you both get a subscription discount.
            {joinedCount > 0 ? ` ${joinedCount} friend${joinedCount > 1 ? 's' : ''} joined so far!` : ''}
          </AppText>
        </View>
      </Card>

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
            <AppText variant="body" color={colors.success} style={styles.formMsg}>
              Referral sent! You&apos;ll get a discount when they join.
            </AppText>
          </Animated.View>
        ) : null}
        {error ? (
          <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
            <AppText variant="body" color={colors.error} style={styles.formMsg}>
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
                <AppText variant="body" numberOfLines={1}>{ref.inviteeEmail}</AppText>
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
// Styles — block language: borderless charcoal cards, one red hero,
// one cream counterpoint, pill chips, fill-contrast separation.
// ════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  // Header & hero
  heroWrap: { marginTop: spacing.xl },
  heroCard: { gap: spacing.md },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  signedOutBtns: { gap: spacing.md, marginTop: spacing.md },

  // Outlined meta chip under the title (brief §6: 34–36 pill, borderStrong)
  metaChip: {
    minHeight: 34,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  staleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: touch.min,
    marginTop: spacing.md,
  },
  staleText: { flex: 1 },

  // Charcoal form modules — chunky blocks, no borders
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.md,
  },
  textInput: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
  },
  formBtn: { marginTop: spacing.xs },
  formMsg: { marginTop: spacing.xs },

  // Buddy rows — rounded charcoal rows; gaps replace hairlines
  buddyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
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
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buddyInfo: { flex: 1, gap: 2 },
  iconBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Unread pip on the chat icon button — same accent-fill badge language as
  // the staff coach console's roster badge (app/staff/coach/index.tsx).
  chatBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  buddyActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionBtn: { flex: 1 },
  buddyExpand: { gap: spacing.md },
  weekLabel: { marginBottom: spacing.xs },
  weekStrip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  weekDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  weekDotOn: { backgroundColor: colors.accent },

  // Public leaderboard entry row
  publicBoardCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  emptyText: { paddingHorizontal: spacing.xl },

  // Live sessions — charcoal blocks; "live" reads via dot + label
  sessionList: { gap: spacing.md },
  sessionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.md,
  },
  sessionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  sessionBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  tierRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  participantChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  participantChip: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
  },
  // mySessionCard's own background IS surfaceRaised, so its chips need the
  // next step up the ramp to stay visible.
  participantChipOnRaised: { backgroundColor: colors.surfacePressed },
  mySessionCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.md,
    marginTop: spacing.md,
  },

  // Referrals — cream counterpoint block + charcoal rows
  referralCream: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  referralHeroText: { flex: 1, gap: spacing.xs },
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
    minHeight: 64,
  },
});
