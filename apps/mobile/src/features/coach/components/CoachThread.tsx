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
import { Image } from 'expo-image';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, AppTextInput, enterUp, PressableScale } from '../../../components/ui';
import { addDays, posterDate, toIsoDate, todayIso } from '../../../lib/dates';
import { successHaptic } from '../../../lib/haptics';
import type { CoachMessage, CoachThreadKind } from '../../../lib/api/client';
import { isTypingMessage, useCoachThread } from '../useCoachThread';
import { MessageBubble } from './MessageBubble';

/**
 * Reusable Elite chat thread: a scrollable message list over a pinned input.
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
  starter: {
    minHeight: touch.min,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
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
  },
  errorRow: { paddingHorizontal: spacing.xs, paddingBottom: spacing.xs },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: { flex: 1, maxHeight: 120, paddingTop: 16, paddingBottom: 16 },
  sendBtn: {
    width: touch.primary,
    height: touch.primary,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
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

export function CoachThread({ kind, emptyTitle, emptyBody, placeholder, starters }: Props) {
  const { messages, loading, stale, sending, reload, send, sendError } = useCoachThread(kind);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<CoachMessage>>(null);
  const inputRef = useRef<TextInput>(null);

  // Keep the newest message in view as the thread grows or the keyboard opens.
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
  }, [draft, sending, send]);

  const applyStarter = useCallback((text: string) => {
    setDraft(text);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const renderItem = useCallback<ListRenderItem<CoachMessage>>(
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
          <MessageBubble
            message={item}
            firstInGroup={firstInGroup}
            lastInGroup={lastInGroup}
            showAvatar={item.sender === 'coach' && lastInGroup}
            typing={isTypingMessage(item)}
          />
        </Animated.View>
      );
    },
    [messages],
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
          <AppText variant="caption" center>
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
          <AppText variant="caption" color={colors.error}>
            {sendError === 'forbidden'
              ? 'Messaging is an Elite feature.'
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
          placeholder={placeholder}
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
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Ionicons name="arrow-up" size={22} color={colors.onAccent} />
          )}
        </PressableScale>
      </View>
    </KeyboardAvoidingView>
  );
}
