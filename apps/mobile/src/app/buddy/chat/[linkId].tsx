import { useCallback, useEffect, useRef, useState } from 'react';
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
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
} from '../../../components/ui';
import type { BuddyChatMessage } from '../../../features/buddy/chatApi';
import { useBuddyChatThread } from '../../../features/buddy/hooks';
import { MessageBubble } from '../../../features/coach/components/MessageBubble';
import { addDays, posterDate, toIsoDate, todayIso } from '../../../lib/dates';
import { successHaptic } from '../../../lib/haptics';
import type { CoachMessage } from '../../../lib/api/client';
import { useAuth } from '../../../state/auth';

/**
 * One friend-to-friend DM thread (SCALE-UP-PLAN §4.4 / §5.1). Built on the
 * same idioms as CoachThread.tsx (day dividers, grouped bubbles, optimistic
 * send with rollback) but for a peer, not Greece: pushed from the Buddy tab's
 * chat icon with `?name=` for the header before the thread loads.
 *
 * Reuses features/coach/components/MessageBubble for the bubble language
 * (fill/tail/timestamp), but ALWAYS with `showAvatar={false}` — the Newie
 * mascot belongs to the coach threads only, never a friend's messages.
 * `toBubbleMessage` maps `senderAccountId` onto MessageBubble's 'user'/'coach'
 * sides purely by "is this me" — the 'coach' bucket just means "the other
 * person" here.
 */

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

function DayDivider({ iso }: { iso: string }) {
  return (
    <View style={styles.dayDivider} accessibilityRole="header">
      <AppText variant="label" color={colors.textDim}>
        {dividerLabel(iso)}
      </AppText>
    </View>
  );
}

/** Adapt a buddy DM row into MessageBubble's expected shape. Only `sender`
 * (which side of the bubble) and `body`/`createdAt` matter here — `kind` is
 * unused by MessageBubble and `readByUser` doesn't drive anything visual. */
function toBubbleMessage(m: BuddyChatMessage, myId: string | null): CoachMessage {
  return {
    id: m.id,
    kind: 'coach_chat',
    sender: m.senderAccountId === myId ? 'user' : 'coach',
    body: m.body,
    createdAt: m.createdAt,
    readByUser: true,
  };
}

export default function BuddyChatScreen() {
  const params = useLocalSearchParams<{ linkId: string; name?: string }>();
  const linkId = params.linkId ?? '';
  const buddyName = params.name?.trim() || 'Buddy';
  const myId = useAuth((s) => s.user?.id ?? null);

  const { messages, loading, stale, sending, reload, send, sendError } =
    useBuddyChatThread(linkId);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<BuddyChatMessage>>(null);
  const inputRef = useRef<TextInput>(null);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);
  useEffect(() => {
    if (messages.length > 0) scrollToEnd();
  }, [messages.length, scrollToEnd]);

  const canSend = draft.trim().length > 0 && !sending;

  const onSend = useCallback(() => {
    const body = draft.trim();
    if (body.length === 0 || sending) return;
    setDraft('');
    void (async () => {
      const ok = await send(body);
      if (ok) successHaptic();
      else setDraft((d) => (d.length === 0 ? body : d)); // restore if input still empty
    })();
  }, [draft, sending, send, setDraft]);

  const renderItem = useCallback<ListRenderItem<BuddyChatMessage>>(
    ({ item, index }) => {
      const prev = index > 0 ? messages[index - 1] : undefined;
      const next = index < messages.length - 1 ? messages[index + 1] : undefined;
      const newDay = !prev || !sameLocalDay(prev.createdAt, item.createdAt);
      const firstInGroup =
        newDay || prev === undefined || prev.senderAccountId !== item.senderAccountId;
      const lastInGroup =
        !next ||
        !sameLocalDay(next.createdAt, item.createdAt) ||
        next.senderAccountId !== item.senderAccountId;

      return (
        <Animated.View entering={enterUp()}>
          {newDay ? <DayDivider iso={item.createdAt} /> : null}
          <MessageBubble
            message={toBubbleMessage(item, myId)}
            firstInGroup={firstInGroup}
            lastInGroup={lastInGroup}
            showAvatar={false}
          />
        </Animated.View>
      );
    },
    [messages, myId],
  );

  const showEmpty = !loading && messages.length === 0;

  return (
    <Screen edges={{ bottom: true }}>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </PressableScale>
        <View style={styles.headerAvatar}>
          <AppText variant="bodyBold" color={colors.accent}>
            {buddyName.charAt(0).toUpperCase()}
          </AppText>
        </View>
        <AppText variant="title" numberOfLines={1} style={styles.headerName}>
          {buddyName}
        </AppText>
      </Animated.View>

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
            <Ionicons name="chatbubbles-outline" size={40} color={colors.textFaint} />
            <AppText variant="title" center>
              Say hi to {buddyName}
            </AppText>
            <AppText variant="body" color={colors.textDim} center>
              Nothing here yet — send the first message.
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
                ? "You're no longer connected as buddies."
                : "Couldn't send — check your connection and try again."}
            </AppText>
          </View>
        ) : null}

        <View style={styles.inputBar}>
          <AppTextInput
            ref={inputRef}
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={`Message ${buddyName}…`}
            multiline
            maxLength={MAX_LEN}
            onFocus={scrollToEnd}
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
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
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerName: { flex: 1 },
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
