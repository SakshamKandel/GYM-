import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Divider,
  enterUp,
  FLOATING_TAB_SPACE,
  HeroCard,
  PressableScale,
  Screen,
  SectionLabel,
  Tag,
} from '../../components/ui';
import { todayIso } from '../../lib/dates';
import { useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';
import { useBuddyData } from '../../features/buddy/hooks';
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
import {
  avatarLetter,
  BUDDY_LIMIT,
  inviteErrorLine,
  joinSessionErrorLine,
  lastTrainedLabel,
  referralErrorLine,
  referralStatusLabel,
} from '../../features/buddy/logic';
import { nudgedToday, useBuddyStore } from '../../features/buddy/store';
import type { BuddyErrorCode, BuddyLink, BuddySession, Referral } from '../../lib/api/client';

/** Buddy — pair up, train live, and refer friends for rewards. */

export default function BuddyScreen() {
  const status = useAuth((s) => s.status);
  const { list, events, sessions, referrals, stale, reload } =
    useBuddyData();

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
}

function BuddyContent({
  list,
  events,
  sessions,
  referrals,
  stale,
  reload,
}: ContentProps) {
  const tier = useProfile((s) => s.tier);
  const myId = useAuth((s) => s.user?.id ?? null);
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
        <View style={styles.staleRow}>
          <Ionicons name="cloud-offline" size={14} color={colors.textDim} />
          <AppText variant="caption">Showing last known state — tap to retry.</AppText>
        </View>
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
        <View style={styles.emptyState}>
          <Ionicons name="people-outline" size={40} color={colors.textFaint} />
          <AppText variant="caption" center style={styles.emptyText}>
            No buddies yet — invite a friend above to get started.
          </AppText>
        </View>
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

      <Divider />

      {/* ── Live sessions ─────────────────────────────────────── */}
      <View>
        <SectionLabel>Live sessions</SectionLabel>
        <LiveSessionSection
          sessions={buddySessions}
          tier={tier}
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
          You've hit the {BUDDY_LIMIT}-buddy limit. Remove a buddy to add someone new.
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
            <AppText variant="caption" color={colors.success} style={styles.formMsg}>
              Invite sent! They'll appear here once they accept.
            </AppText>
          ) : null}
          {error ? (
            <AppText variant="caption" color={colors.error} style={styles.formMsg}>
              {error}
            </AppText>
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
  subtitle,
  tier,
  onNudge,
  onRemove,
}: {
  link: BuddyLink;
  subtitle: string;
  tier: string;
  onNudge: () => void;
  onRemove: () => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const nudged = nudgedToday(
    useBuddyStore.getState().nudgedByLink,
    link.linkId,
    todayIso(),
  );

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
          <AppText variant="caption">{subtitle}</AppText>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Toggle actions"
          onPress={() => setShowActions(!showActions)}
          style={styles.iconBtn}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textDim} />
        </PressableScale>
      </View>

      {showActions ? (
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
      ) : null}
    </View>
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
      <View style={styles.emptyState}>
        <Ionicons name="barbell-outline" size={36} color={colors.textFaint} />
        <AppText variant="caption" center style={styles.emptyText}>
          No active live sessions. Start one below or wait for a buddy to go live.
        </AppText>
      </View>
    );
  }

  return (
    <View style={styles.sessionList}>
      {error ? (
        <AppText variant="caption" color={colors.error} style={styles.formMsg}>
          {error}
        </AppText>
      ) : null}
      {sessions.map((session) => (
        <View key={session.id} style={styles.sessionCard}>
          <View style={styles.sessionTop}>
            <View style={styles.liveDot} />
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
          <View style={styles.liveDot} />
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
        <AppText variant="caption" color={colors.error} style={styles.formMsg}>
          Couldn't start the session — try again in a bit.
        </AppText>
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
          <AppText variant="caption" color={colors.success} style={styles.formMsg}>
            Referral sent! You'll get a discount when they join.
          </AppText>
        ) : null}
        {error ? (
          <AppText variant="caption" color={colors.error} style={styles.formMsg}>
            {error}
          </AppText>
        ) : null}
      </View>

      {referrals.length > 0 ? (
        <View style={styles.referralList}>
          {referrals.map((ref) => (
            <View key={ref.id} style={styles.referralRow}>
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
            </View>
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
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },

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
