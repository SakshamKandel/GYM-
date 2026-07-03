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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, AppTextInput, PressableScale, Tag } from '../../../../components/ui';
import { successHaptic } from '../../../../lib/haptics';
import { useAuth } from '../../../../state/auth';
import {
  getCoachThread,
  replyToClient,
  toStaffError,
  type CoachThreadMessage,
  type StaffErrorCode,
  type Tier,
} from '../../../../features/staff/api';
import { pushStaff, STAFF_ROUTES } from '../../../../features/staff/nav';

/**
 * Coach thread — the full coach_chat history with one client, built to feel like
 * a real chat. The CLIENT's messages sit right-aligned in the red bubble (this
 * is the coach's phone, so "their" outbound side is the client); the COACH's own
 * replies sit left with the Newie avatar, mirroring the athlete-side chat exactly
 * but flipped for who's holding the phone. A header shows the client's name and
 * tier, and a pinned composer sends via replyToClient() then refetches so the
 * server-confirmed row (and read receipts) land in the list.
 */

const NEWIE = require('../../../../../assets/images/newie.png');
const MAX_LEN = 2000;

const TIER_COLOR: Record<Tier, string> = {
  starter: colors.textDim,
  silver: colors.blue,
  gold: colors.fat,
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

/** One bubble. Client = right/red; coach (you) = left/surface + avatar. */
function Bubble({ message }: { message: CoachThreadMessage }) {
  const isClient = message.sender === 'user';
  return (
    <View style={[styles.bubbleRow, isClient ? styles.rowRight : styles.rowLeft]}>
      {!isClient ? (
        <Image
          source={NEWIE}
          style={styles.avatar}
          contentFit="cover"
          contentPosition="top"
          accessibilityLabel="You"
        />
      ) : null}
      <View style={[styles.bubble, isClient ? styles.clientBubble : styles.coachBubble]}>
        <AppText color={isClient ? colors.onAccent : colors.text}>{message.body}</AppText>
      </View>
    </View>
  );
}

export default function CoachThreadScreen() {
  const token = useAuth((s) => s.token);
  const params = useLocalSearchParams<{ userId: string; name?: string; tier?: string }>();
  const userId = params.userId;
  const insets = useSafeAreaInsets();

  const clientName = params.name?.trim() || 'Client';
  const tier = isTier(params.tier) ? params.tier : null;

  const [messages, setMessages] = useState<CoachThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<StaffErrorCode | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<StaffErrorCode | null>(null);

  const listRef = useRef<FlatList<CoachThreadMessage>>(null);

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
    } catch (err) {
      setLoadError(toStaffError(err).code);
    } finally {
      setLoading(false);
    }
  }, [token, userId]);

  useEffect(() => {
    void load();
  }, [load]);

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
    void (async () => {
      try {
        await replyToClient(userId, body, token);
        successHaptic();
        // Refetch so the server-confirmed row + read state replace the draft.
        await load();
      } catch (err) {
        setSendError(toStaffError(err).code);
        setDraft((d) => (d.length === 0 ? body : d)); // restore if still empty
      } finally {
        setSending(false);
      }
    })();
  }, [draft, sending, token, userId, load]);

  const renderItem = useCallback<ListRenderItem<CoachThreadMessage>>(
    ({ item }) => <Bubble message={item} />,
    [],
  );

  const showEmpty = !loading && !loadError && messages.length === 0;

  return (
    <View style={styles.fill}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back to inbox"
          onPress={() => pushStaff(STAFF_ROUTES.coachInbox)}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
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
      </View>

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

        <View style={[styles.inputBar, { paddingBottom: insets.bottom + spacing.sm }]}>
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
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Ionicons name="arrow-up" size={22} color={colors.onAccent} />
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
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 2,
    flexGrow: 1,
  },
  staleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: spacing.sm,
  },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginVertical: 4,
  },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft: { justifyContent: 'flex-start' },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.lg,
  },
  clientBubble: {
    backgroundColor: colors.accent,
    borderBottomRightRadius: radius.sm,
  },
  coachBubble: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: radius.sm,
  },
  errorRow: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
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
