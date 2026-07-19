import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  type ListRenderItem,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  enterDown,
  enterUp,
  PressableScale,
  Tag,
} from '../../../../components/ui';
import { addDays, posterDate, toIsoDate, todayIso } from '../../../../lib/dates';
import { successHaptic } from '../../../../lib/haptics';
import { useBottomClearance } from '../../../../lib/systemBars';
import { useAuth } from '../../../../state/auth';
import {
  getCoachInbox,
  getCoachThread,
  markCoachThreadRead,
  replyToClient,
  toStaffError,
  type CoachThreadMessage,
  type StaffErrorCode,
  type Tier,
} from '../../../../features/staff/api';
import { pushStaff, STAFF_ROUTES } from '../../../../features/staff/nav';

/**
 * Coach thread — the full coach_chat history with one client, built to feel like
 * a real chat. The CLIENT's messages sit right-aligned in the red block with
 * BLACK ink (black-on-red law); the COACH's own replies sit left in borderless
 * charcoal with the Newie avatar — mirroring the athlete-side MessageBubble
 * language exactly but flipped for who's holding the phone. Runs from one
 * sender group (tail corner, timestamp and avatar only on the last of a run),
 * day dividers ride quiet raised pills. A compact header shows the client's
 * name and tier, and a pinned pill composer sends via replyToClient() then
 * refetches so the server-confirmed row (and read receipts) land in the list.
 */

const NEWIE = require('../../../../../assets/images/newie.png');
const MAX_LEN = 2000;
const AVATAR = 30;

const TIER_COLOR: Record<Tier, string> = {
  starter: colors.textDim,
  silver: colors.blue,
  gold: colors.warning,
  elite: colors.accent,
};
const TIER_LABEL: Record<Tier, string> = {
  starter: 'Starter',
  silver: 'Silver',
  gold: 'Gold',
  elite: 'Elite',
};

const isTier = (v: string | undefined): v is Tier =>
  v === 'starter' || v === 'silver' || v === 'gold' || v === 'elite';

function loadErrorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return 'This client is no longer assigned to you.';
  if (code === 'not_found') return "This thread doesn't exist.";
  return "Couldn't load this conversation.";
}

function sendErrorLine(code: StaffErrorCode): string {
  if (code === 'forbidden') return 'This client is no longer assigned to you.';
  if (code === 'invalid') return 'That message is too long to send.';
  return "Couldn't send — check your connection and try again.";
}

/** "3:42 PM" — local wall-clock, deterministic (no Intl dependency). */
function clockLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'PM' : 'AM';
  h %= 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Same local calendar day? Used for grouping and day dividers. */
function sameLocalDay(a: string, b: string): boolean {
  return toIsoDate(new Date(a)) === toIsoDate(new Date(b));
}

/** "Today" / "Yesterday" / "THU, JUL 3" for the day divider. */
function dividerLabel(iso: string): string {
  const local = toIsoDate(new Date(iso));
  const today = todayIso();
  if (local === today) return 'Today';
  if (local === addDays(today, -1)) return 'Yesterday';
  return posterDate(local);
}

function DayDivider({ iso }: { iso: string }) {
  return (
    <View style={styles.dayDivider} accessibilityRole="header">
      <AppText variant="label" color={colors.textDim}>
        {dividerLabel(iso)}
      </AppText>
    </View>
  );
}

/** One bubble. Client = right/red block, black ink; coach (you) = left,
 * borderless charcoal + avatar. Tail + timestamp only on the last of a run. */
function Bubble({
  message,
  firstInGroup,
  lastInGroup,
  showAvatar,
}: {
  message: CoachThreadMessage;
  firstInGroup: boolean;
  lastInGroup: boolean;
  showAvatar: boolean;
}) {
  const isClient = message.sender === 'user';
  const time = clockLabel(message.createdAt);
  return (
    <View
      style={[
        styles.bubbleRow,
        isClient ? styles.rowRight : styles.rowLeft,
        firstInGroup ? styles.groupStart : styles.grouped,
      ]}
    >
      {!isClient ? (
        showAvatar ? (
          <Image
            source={NEWIE}
            style={styles.avatar}
            contentFit="cover"
            contentPosition="top"
            accessibilityLabel="You"
          />
        ) : (
          <View style={styles.avatarSpacer} />
        )
      ) : null}
      <View style={[styles.col, isClient ? styles.colClient : styles.colCoach]}>
        <View
          style={[
            styles.bubble,
            isClient ? styles.clientBubble : styles.coachBubble,
            lastInGroup ? (isClient ? styles.clientTail : styles.coachTail) : null,
          ]}
        >
          <AppText color={isClient ? colors.onBlock : colors.text}>{message.body}</AppText>
        </View>
        {lastInGroup && time ? (
          <AppText variant="label" color={colors.textFaint} style={styles.time}>
            {time}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

export default function CoachThreadScreen() {
  const token = useAuth((s) => s.token);
  const params = useLocalSearchParams<{ userId: string; name?: string; tier?: string }>();
  const userId = params.userId;
  const insets = useSafeAreaInsets();
  // Composer clearance above the SYSTEM nav area — some OEM 3-button builds
  // report insets.bottom=0 under edge-to-edge, which would leave the input
  // and send button under the 48dp bar; useBottomClearance falls back there.
  const bottomClearance = useBottomClearance();

  // The URL params are a snapshot from when the row was tapped in the inbox —
  // if the client's name or tier changed since (e.g. a tier upgrade applied
  // from this very thread), the header would otherwise stay stale for the
  // rest of the session (G15). Roster refetch below supplies the live values;
  // the params remain only as the first-paint fallback before that resolves.
  const [liveName, setLiveName] = useState<string | null>(null);
  const [liveTier, setLiveTier] = useState<Tier | null>(null);

  const clientName = liveName ?? (params.name?.trim() || 'Client');
  const clientInitial = clientName.charAt(0).toUpperCase();
  const tier = liveTier ?? (isTier(params.tier) ? params.tier : null);

  const [messages, setMessages] = useState<CoachThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<StaffErrorCode | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<StaffErrorCode | null>(null);

  const listRef = useRef<FlatList<CoachThreadMessage>>(null);
  const pendingSeq = useRef(0);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const load = useCallback(async () => {
    if (!token || !userId) {
      setLoadError('unauthorized');
      setLoading(false);
      return;
    }
    try {
      const thread = await getCoachThread(userId, token);
      setMessages(thread);
      setLoadError(null);
      // Mark read now that the thread is visible (F2: GET is read-only, this
      // is the separate write) — best-effort, never blocks the thread from
      // showing and never surfaces its own error.
      void markCoachThreadRead(userId, token).catch(() => {});
    } catch (err) {
      setLoadError(toStaffError(err).code);
    } finally {
      setLoading(false);
    }
  }, [token, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Resolve the client's CURRENT name/tier from the roster — best-effort; a
  // failure (or the client no longer appearing, e.g. coaching just ended)
  // simply leaves the params-derived fallback in place.
  useEffect(() => {
    if (!token || !userId) return;
    let cancelled = false;
    void getCoachInbox(token)
      .then((rows) => {
        if (cancelled) return;
        const row = rows.find((r) => r.id === userId);
        if (!row) return;
        setLiveName(row.displayName.trim() || null);
        setLiveTier(row.tier);
      })
      .catch(() => {
        // Non-fatal — the header keeps the params snapshot.
      });
    return () => {
      cancelled = true;
    };
  }, [token, userId]);

  useEffect(() => {
    if (messages.length > 0) scrollToEnd();
  }, [messages.length, scrollToEnd]);

  const canSend = draft.trim().length > 0 && !sending;

  const onSend = useCallback(() => {
    const body = draft.trim();
    if (body.length === 0 || sending || !token || !userId) return;
    setSending(true);
    setSendError(null);
    setDraft('');
    // Optimistic bubble: the coach's reply lands in the thread the instant they
    // tap send, rather than vanishing for the reply + refetch round-trips. On
    // success we swap it for the server-confirmed row; on failure we pull it
    // back out and restore the draft so nothing looks lost or double-sent.
    const tempId = `pending-${(pendingSeq.current += 1)}`;
    const optimistic: CoachThreadMessage = {
      id: tempId,
      kind: 'text',
      sender: 'coach',
      body,
      senderAccountId: null,
      readByUser: false,
      readByCoach: true,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    void (async () => {
      try {
        const saved = await replyToClient(userId, body, token);
        successHaptic();
        // Swap the optimistic bubble for the server-confirmed row.
        setMessages((prev) => prev.map((m) => (m.id === tempId ? saved : m)));
      } catch (err) {
        setSendError(toStaffError(err).code);
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setDraft((d) => (d.length === 0 ? body : d)); // restore if still empty
        setSending(false);
        return;
      }
      setSending(false);
      // Background refetch for read state + any client messages that arrived —
      // non-fatal since the reply already shows.
      void load();
    })();
  }, [draft, sending, token, userId, load]);

  const renderItem = useCallback<ListRenderItem<CoachThreadMessage>>(
    ({ item, index }) => {
      const prev = index > 0 ? messages[index - 1] : undefined;
      const next = index < messages.length - 1 ? messages[index + 1] : undefined;
      const newDay = !prev || !sameLocalDay(prev.createdAt, item.createdAt);
      const firstInGroup = newDay || prev === undefined || prev.sender !== item.sender;
      const lastInGroup =
        !next || !sameLocalDay(next.createdAt, item.createdAt) || next.sender !== item.sender;
      return (
        <Animated.View entering={enterUp()}>
          {newDay ? <DayDivider iso={item.createdAt} /> : null}
          <Bubble
            message={item}
            firstInGroup={firstInGroup}
            lastInGroup={lastInGroup}
            showAvatar={item.sender !== 'user' && lastInGroup}
          />
        </Animated.View>
      );
    },
    [messages],
  );

  const showEmpty = !loading && !loadError && messages.length === 0;

  return (
    <View style={styles.fill}>
      {/* Compact chat header — no hairline; the thread owns the screen. */}
      <Animated.View
        entering={enterDown()}
        style={[styles.header, { paddingTop: insets.top + spacing.md }]}
      >
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back to inbox"
          onPress={() => pushStaff(STAFF_ROUTES.coachInbox)}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
        <View style={styles.clientAvatar}>
          <AppText variant="bodyBold">{clientInitial}</AppText>
        </View>
        <View style={styles.headerText}>
          <AppText variant="title" numberOfLines={1}>
            {clientName}
          </AppText>
          {tier ? (
            <View style={styles.tierRow}>
              <Tag label={TIER_LABEL[tier]} variant="outline" color={TIER_COLOR[tier]} />
            </View>
          ) : (
            <AppText variant="caption">Coaching chat</AppText>
          )}
        </View>
        {/* Manage this client's subscription — tier + expiry, own active
            clients only (the coach-scoped endpoint enforces ownership). */}
        {userId ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Manage ${clientName}'s subscription`}
            onPress={() =>
              pushStaff(
                `${STAFF_ROUTES.coachClient(userId)}?name=${encodeURIComponent(clientName)}${
                  tier ? `&tier=${tier}` : ''
                }`,
              )
            }
            style={styles.backBtn}
          >
            <Ionicons name="card-outline" size={22} color={colors.text} />
          </PressableScale>
        ) : null}
      </Animated.View>

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + spacing.md : 0}
      >
        {loading ? (
          <View style={styles.centre}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : loadError && messages.length === 0 ? (
          <View style={styles.centre}>
            <Ionicons name="cloud-offline-outline" size={28} color={colors.textFaint} />
            <AppText variant="caption" center color={colors.textDim}>
              {loadErrorLine(loadError)}
            </AppText>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Retry"
              onPress={() => {
                setLoading(true);
                void load();
              }}
              style={styles.retryBtn}
            >
              <AppText variant="label" color={colors.accent}>
                Tap to retry
              </AppText>
            </PressableScale>
          </View>
        ) : showEmpty ? (
          <View style={styles.centre}>
            <Image
              source={NEWIE}
              style={styles.emptyAvatar}
              contentFit="cover"
              contentPosition="top"
              accessibilityLabel="You"
            />
            <AppText variant="title" center>
              No messages yet
            </AppText>
            <AppText variant="caption" center color={colors.textDim}>
              Send {clientName.split(' ')[0]} a message to get the conversation going.
            </AppText>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={scrollToEnd}
            ListHeaderComponent={
              loadError ? (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading messages"
                  onPress={() => void load()}
                  style={styles.staleRow}
                >
                  <Ionicons
                    name="cloud-offline-outline"
                    size={14}
                    color={colors.textDim}
                  />
                  <AppText variant="caption">Showing saved messages · tap to retry</AppText>
                </PressableScale>
              ) : null
            }
          />
        )}

        {sendError ? (
          <View style={styles.errorRow}>
            <AppText variant="caption" color={colors.error}>
              {sendErrorLine(sendError)}
            </AppText>
          </View>
        ) : null}

        {/* Pill composer beside the red send circle — no hairline above; the
            filled pill separates itself from the thread (no-border law). */}
        <View style={[styles.inputBar, { paddingBottom: bottomClearance + spacing.sm }]}>
          <AppTextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={`Reply to ${clientName.split(' ')[0]}…`}
            multiline
            maxLength={MAX_LEN}
            onFocus={scrollToEnd}
            accessibilityLabel="Reply"
          />
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Send reply"
            disabled={!canSend}
            onPress={onSend}
            style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
          >
            {sending ? (
              <ActivityIndicator color={colors.onBlock} />
            ) : (
              <Ionicons name="arrow-up" size={22} color={colors.onBlock} />
            )}
          </PressableScale>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.md,
  },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clientAvatar: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 2 },
  tierRow: { flexDirection: 'row' },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  emptyAvatar: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    marginBottom: spacing.xs,
  },
  retryBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  listContent: {
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.md,
    flexGrow: 1,
  },
  staleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: spacing.sm,
  },
  dayDivider: {
    alignSelf: 'center',
    marginVertical: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft: { justifyContent: 'flex-start' },
  groupStart: { marginTop: spacing.sm },
  grouped: { marginTop: 2 },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  avatarSpacer: { width: AVATAR },
  col: { flexShrink: 1, maxWidth: '80%' },
  colClient: { alignItems: 'flex-end' },
  colCoach: { alignItems: 'flex-start' },
  bubble: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  // Client = red block with BLACK ink; coach = borderless charcoal —
  // separation by fill contrast, never strokes (mirrors MessageBubble).
  clientBubble: { backgroundColor: colors.blockRed },
  coachBubble: { backgroundColor: colors.surface },
  clientTail: { borderBottomRightRadius: radius.sm },
  coachTail: { borderBottomLeftRadius: radius.sm },
  time: { marginTop: spacing.xs, marginHorizontal: spacing.xs },
  errorRow: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.xs },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.sm,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.gutter,
    borderRadius: radius.full,
  },
  sendBtn: {
    width: touch.primary,
    height: touch.primary,
    borderRadius: radius.full,
    backgroundColor: colors.blockRed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});
