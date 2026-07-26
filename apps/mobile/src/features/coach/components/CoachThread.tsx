import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  type ListRenderItem,
  Platform,
  StyleSheet,
  type TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, AppTextInput, enterUp, PressableScale } from '../../../components/ui';
import { addDays, posterDate, toIsoDate, todayIso } from '../../../lib/dates';
import { successHaptic } from '../../../lib/haptics';
import type { CoachMessage, CoachThreadKind } from '../../../lib/api/client';
import { useAuth } from '../../../state/auth';
import { isTypingMessage, useCoachThread } from '../useCoachThread';
import { MessageBubble } from './MessageBubble';

/**
 * Reusable Elite chat thread: an inverted message list over a pinned input, so
 * the newest message sits against the composer and older ones run up the
 * screen. Inverted is what makes a message arrive by itself: nothing has to
 * animate a scroll to the end, so reading two days back is never interrupted
 * by the coach replying (or by the keyboard opening).
 *
 * Crash-safe and offline-tolerant — the hook keeps the last-known thread and
 * a failed load shows a quiet retry row, never a blocking error screen.
 * Optimistic send; successHaptic fires only when a message actually posts.
 *
 * Messages are grouped by sender + day, fade in quietly (never slide), and the
 * empty state greets with the Newie mascot plus optional starter prompts that
 * pre-fill the composer.
 */

const NEWIE = require('../../../../assets/images/newie.png');

interface Props {
  kind: CoachThreadKind;
  /** Empty-state copy shown before the first message in a thread. */
  emptyTitle: string;
  emptyBody: string;
  /** Placeholder for the input. */
  placeholder: string;
  /** Optional tap-to-fill prompts shown in the empty state. */
  starters?: string[];
  /** The coach's display name for bubbles/labels; defaults to Greece. */
  coachName?: string;
  /**
   * Optional one-time seed for the composer — used when a screen already knows
   * what the message is about (e.g. /support opened from a meal order). Applied
   * on mount only, so it never overwrites what the member is typing. Omit it and
   * the composer starts empty exactly as before.
   */
  initialDraft?: string;
}

const MAX_LEN = 2000;

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

const styles = StyleSheet.create({
  fill: { flex: 1 },
  listContent: {
    paddingVertical: spacing.md,
    flexGrow: 1,
  },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyAvatar: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    marginBottom: spacing.sm,
  },
  starters: {
    alignSelf: 'stretch',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  // Filled charcoal pills — block language separates by fill, not strokes.
  starter: {
    minHeight: touch.min,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.gutter,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  dayDivider: {
    alignSelf: 'center',
    marginVertical: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  staleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    minHeight: touch.min,
  },
  errorRow: { paddingHorizontal: spacing.xs, paddingBottom: spacing.xs },
  // Composer: pill input beside the red send circle — no hairline above,
  // the filled pill separates itself from the thread (no-border law).
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
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

function DayDivider({ iso }: { iso: string }) {
  return (
    <View style={styles.dayDivider} accessibilityRole="header">
      <AppText variant="label" color={colors.textDim}>
        {dividerLabel(iso)}
      </AppText>
    </View>
  );
}

/**
 * Remount the composer with the session. This clears unsent draft text and all
 * child refs synchronously on an account switch, while useCoachThread guards
 * the asynchronous server state itself.
 */
export function CoachThread(props: Props) {
  const sessionKey = useAuth((state) => state.token ?? 'signed-out');
  return <CoachThreadSession key={sessionKey} {...props} />;
}

function CoachThreadSession({
  kind,
  emptyTitle,
  emptyBody,
  placeholder,
  starters,
  coachName,
  initialDraft,
}: Props) {
  const { messages, loading, stale, sending, reload, send, sendError, contactHidden } =
    useCoachThread(kind);
  // The seed is only an INITIAL value: it lands once, on mount, so later
  // renders (and a changing prop) leave whatever the member typed alone.
  const [draft, setDraft] = useState(initialDraft ?? '');
  const listRef = useRef<FlatList<CoachMessage>>(null);
  const inputRef = useRef<TextInput>(null);

  /**
   * Newest first, because the list is `inverted`: index 0 sits at the bottom,
   * against the composer, and the thread grows upwards from there. That is what
   * makes a new message arrive on its own without anyone scrolling — and, more
   * importantly, what stops the thread yanking itself to the bottom while the
   * member is reading something further up.
   */
  const ordered = useMemo(() => [...messages].reverse(), [messages]);

  /** The bottom of an inverted list is offset 0. Used only after our own send. */
  const scrollToNewest = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
  }, []);

  const canSend = draft.trim().length > 0 && !sending;

  const onSend = useCallback(() => {
    const body = draft.trim();
    if (body.length === 0 || sending) return;
    setDraft('');
    // Sending is the one moment the member DOES want to be taken to the newest
    // message — they just wrote it.
    scrollToNewest();
    void (async () => {
      const ok = await send(body);
      if (ok) successHaptic();
      else setDraft((d) => (d.length === 0 ? body : d)); // restore if input still empty
    })();
  }, [draft, sending, send, scrollToNewest]);

  const applyStarter = useCallback((text: string) => {
    setDraft(text);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const renderItem = useCallback<ListRenderItem<CoachMessage>>(
    ({ item, index }) => {
      // `ordered` runs newest → oldest, so the message ABOVE this one on screen
      // is the next index and the one BELOW is the previous. Grouping and day
      // dividers still read top-to-bottom; only the lookup direction flips.
      const prev = index < ordered.length - 1 ? ordered[index + 1] : undefined;
      const next = index > 0 ? ordered[index - 1] : undefined;
      const newDay = !prev || !sameLocalDay(prev.createdAt, item.createdAt);
      const firstInGroup = newDay || prev === undefined || prev.sender !== item.sender;
      const lastInGroup =
        !next || !sameLocalDay(next.createdAt, item.createdAt) || next.sender !== item.sender;

      return (
        <Animated.View entering={enterUp()}>
          {newDay ? <DayDivider iso={item.createdAt} /> : null}
          <MessageBubble
            message={item}
            firstInGroup={firstInGroup}
            lastInGroup={lastInGroup}
            showAvatar={item.sender === 'coach' && lastInGroup}
            typing={isTypingMessage(item)}
            coachName={coachName}
          />
        </Animated.View>
      );
    },
    [ordered, coachName],
  );

  const showEmpty = !loading && messages.length === 0;

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {loading && messages.length === 0 ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : showEmpty ? (
        <View style={styles.centre}>
          <Image source={NEWIE} style={styles.emptyAvatar} contentFit="cover" contentPosition="top" />
          <AppText variant="title" center>
            {emptyTitle}
          </AppText>
          <AppText variant="body" color={colors.textDim} center>
            {emptyBody}
          </AppText>
          {starters && starters.length > 0 ? (
            <View style={styles.starters}>
              {starters.map((s) => (
                <PressableScale
                  key={s}
                  accessibilityRole="button"
                  accessibilityLabel={`Start with: ${s}`}
                  onPress={() => applyStarter(s)}
                  style={styles.starter}
                >
                  <AppText color={colors.text} numberOfLines={2}>
                    {s}
                  </AppText>
                </PressableScale>
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <FlatList
          ref={listRef}
          inverted
          data={ordered}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          // Footer, not header: an inverted list draws its footer at the far
          // end of the thread, which is where this notice has always sat —
          // above the oldest message, not wedged against the composer.
          ListFooterComponent={
            stale ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Retry loading messages"
                onPress={reload}
                style={styles.staleRow}
              >
                <Ionicons name="cloud-offline-outline" size={14} color={colors.textDim} />
                <AppText variant="caption">Showing saved messages · tap to retry</AppText>
              </PressableScale>
            ) : null
          }
        />
      )}

      {sendError ? (
        <View style={styles.errorRow}>
          <AppText variant="body" color={colors.error}>
            {sendError === 'forbidden'
              ? 'Messaging is an Elite feature.'
              : // Not a connection problem, and saying so sent people to their
                // wifi settings: the server refuses to store a coach message
                // with no coach behind it, so nobody would ever read this one.
                sendError === 'coach_unavailable'
                ? "You don't have a coach right now, so there's nobody to read this. Pick a coach and your messages go straight to them."
                : "Couldn't send. Check your connection and try again."}
          </AppText>
        </View>
      ) : null}

      {/* Same row as a send error, quieter ink: the message DID land, we just
          took the contact details out of it first. Only coach chat is masked
          (support threads are not), and the server only ever sets the flag
          there, so the kind check is belt and braces. */}
      {contactHidden && kind === 'coach_chat' ? (
        <View style={styles.errorRow}>
          <AppText variant="body" color={colors.textDim}>
            Sent, but we hid the contact details in that message. Coaching stays in the app.
          </AppText>
        </View>
      ) : null}

      <View style={styles.inputBar}>
        <AppTextInput
          ref={inputRef}
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          multiline
          maxLength={MAX_LEN}
          accessibilityLabel="Message"
        />
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Send message"
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
  );
}
