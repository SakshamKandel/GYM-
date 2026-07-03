import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  type ListRenderItem,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, AppTextInput } from '../../../components/ui';
import { successHaptic } from '../../../lib/haptics';
import type { CoachMessage, CoachThreadKind } from '../../../lib/api/client';
import { useCoachThread } from '../useCoachThread';
import { MessageBubble } from './MessageBubble';

/**
 * Reusable Elite chat thread: a scrollable message list over a pinned input.
 * Crash-safe and offline-tolerant — the hook keeps the last-known thread and
 * a failed load shows a quiet retry row, never a blocking error screen.
 * Optimistic send; successHaptic fires only when a message actually posts.
 */

interface Props {
  kind: CoachThreadKind;
  /** Empty-state copy shown before the first message in a thread. */
  emptyTitle: string;
  emptyBody: string;
  /** Placeholder for the input. */
  placeholder: string;
}

const MAX_LEN = 2000;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  listContent: {
    paddingVertical: spacing.md,
    gap: 2,
    flexGrow: 1,
  },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
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

export function CoachThread({ kind, emptyTitle, emptyBody, placeholder }: Props) {
  const { messages, loading, stale, sending, reload, send, sendError } = useCoachThread(kind);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<CoachMessage>>(null);

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

  const renderItem = useCallback<ListRenderItem<CoachMessage>>(
    ({ item }) => <MessageBubble message={item} />,
    [],
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
          <AppText variant="title" center>
            {emptyTitle}
          </AppText>
          <AppText variant="caption" center>
            {emptyBody}
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading messages"
                onPress={reload}
                style={styles.staleRow}
              >
                <Ionicons name="cloud-offline-outline" size={14} color={colors.textDim} />
                <AppText variant="caption">Showing saved messages · tap to retry</AppText>
              </Pressable>
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
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          multiline
          maxLength={MAX_LEN}
          onFocus={scrollToEnd}
          accessibilityLabel="Message"
        />
        <Pressable
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
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
