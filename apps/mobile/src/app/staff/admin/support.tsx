import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  Sheet,
  Tag,
} from '../../../components/ui';
import {
  getAdminSupportThread,
  getAdminSupportThreads,
  replyToSupportThread,
  toSupportError,
  type SupportErrorCode,
  type SupportMessage,
  type SupportThreadRow,
} from '../../../features/staff/supportApi';
import { canReviewSupport, replaceStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Support — every account with a support ticket (SCALE-UP-PLAN §4.4).
 * A flat list, unread-first (server-sorted), opens a bottom Sheet with the
 * full thread (chat bubbles, client-side mirroring the coach console's
 * bubble language) and a reply composer. Opening a thread server-marks it
 * read, so closing the sheet reloads the list to clear its unread badge.
 */

const MAX_LEN = 2000;

function loadErrorLine(code: SupportErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have access to this.";
  return "Couldn't load the inbox.";
}

function sendErrorLine(code: SupportErrorCode): string {
  if (code === 'forbidden') return "You don't have permission to reply.";
  if (code === 'invalid') return 'That message is too long to send.';
  return "Couldn't send — check your connection and try again.";
}

/** Short relative age ("3m", "2h", "5d") with an absolute fallback. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < 0) return 'now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString();
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

function RetryLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Retry"
      onPress={onRetry}
      style={styles.retry}
    >
      <Ionicons name="refresh" size={15} color={colors.textDim} />
      <AppText variant="caption">{message} Tap to retry.</AppText>
    </PressableScale>
  );
}

/** One chat bubble — member on the right (block red, black ink), support on the left. */
function Bubble({ message }: { message: SupportMessage }) {
  const fromUser = message.sender === 'user';
  return (
    <View style={[styles.bubbleRow, fromUser ? styles.rowRight : styles.rowLeft]}>
      <View style={[styles.col, fromUser ? styles.colUser : styles.colSupport]}>
        <View style={[styles.bubble, fromUser ? styles.userBubble : styles.supportBubble]}>
          <AppText color={fromUser ? colors.onBlock : colors.text}>{message.body}</AppText>
        </View>
        <AppText variant="label" color={colors.textFaint} style={styles.time}>
          {fromUser ? 'Member' : 'You'} · {clockLabel(message.createdAt)}
        </AppText>
      </View>
    </View>
  );
}

export default function AdminSupportScreen() {
  const token = useAuth((s) => s.token);
  const staffRole = useAuth((s) => s.staffRole);
  const allowed = canReviewSupport(staffRole);

  const [rows, setRows] = useState<SupportThreadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<SupportThreadRow | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await getAdminSupportThreads(token));
    } catch (e) {
      setError(loadErrorLine(toSupportError(e).code));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; load() owns its own loading/error state.
    if (allowed) void load();
  }, [allowed, load]);

  const loadThread = useCallback(
    async (accountId: string) => {
      if (!token) return;
      setThreadLoading(true);
      setThreadError(null);
      try {
        setMessages(await getAdminSupportThread(accountId, token));
      } catch (e) {
        setThreadError(loadErrorLine(toSupportError(e).code));
      } finally {
        setThreadLoading(false);
      }
    },
    [token],
  );

  function openThread(row: SupportThreadRow): void {
    setSelected(row);
    setMessages([]);
    setDraft('');
    setSendError(null);
    void loadThread(row.account.id);
  }

  function closeThread(): void {
    setSelected(null);
    void load();
  }

  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length]);

  const canSend = draft.trim().length > 0 && !sending;

  async function send(): Promise<void> {
    if (!canSend || !token || !selected) return;
    const body = draft.trim();
    setSending(true);
    setSendError(null);
    try {
      await replyToSupportThread(selected.account.id, body, token);
      setDraft('');
      await loadThread(selected.account.id);
    } catch (e) {
      setSendError(sendErrorLine(toSupportError(e).code));
    } finally {
      setSending(false);
    }
  }

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replaceStaff(STAFF_ROUTES.adminHome);
  }

  if (!allowed) {
    return (
      <Screen>
        <BackRow onBack={goBack} />
        <Animated.View entering={enterUp(0)} style={styles.locked}>
          <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textFaint}>
            Only a support admin, main admin or super admin can view the support inbox.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <BackRow onBack={goBack} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.retryWrap}>
          <RetryLine message={error} onRetry={() => void load()} />
        </View>
      ) : rows.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.emptyLine}>
          No support tickets yet.
        </AppText>
      ) : (
        <View style={styles.list}>
          {rows.map((r, i) => (
            <Animated.View key={r.account.id} entering={enterUp(Math.min(i, 6))}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Open support thread with ${r.account.displayName.trim() || r.account.email}`}
                onPress={() => openThread(r)}
                style={styles.row}
              >
                <View style={styles.rowText}>
                  <View style={styles.rowNameLine}>
                    <AppText variant="bodyBold" numberOfLines={1} style={styles.rowNameGrow}>
                      {r.account.displayName.trim() || r.account.email}
                    </AppText>
                    {r.unread > 0 ? (
                      <View style={styles.unreadDot}>
                        <AppText variant="label" color={colors.onBlock}>
                          {r.unread}
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                  <AppText variant="caption" numberOfLines={1}>
                    {r.lastSender === 'coach' ? 'You: ' : ''}
                    {r.lastBody}
                  </AppText>
                </View>
                <AppText variant="caption" color={colors.textFaint}>
                  {relativeTime(r.lastAt)}
                </AppText>
                <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
              </PressableScale>
            </Animated.View>
          ))}
        </View>
      )}

      <Sheet
        visible={selected !== null}
        onClose={closeThread}
        title={selected ? selected.account.displayName.trim() || selected.account.email : 'Support ticket'}
      >
        {selected ? (
          <View style={styles.sheetInner}>
            <View style={styles.sheetHeaderRow}>
              <AppText variant="caption" color={colors.textDim} numberOfLines={1} style={styles.sheetEmail}>
                {selected.account.email}
              </AppText>
              <Tag label={selected.account.tier.toUpperCase()} variant="dim" />
            </View>

            {threadLoading ? (
              <View style={styles.centerSm}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : threadError ? (
              <View style={styles.retryWrap}>
                <RetryLine
                  message={threadError}
                  onRetry={() => void loadThread(selected.account.id)}
                />
              </View>
            ) : (
              <ScrollView
                ref={scrollRef}
                style={styles.sheetScroll}
                contentContainerStyle={styles.sheetScrollContent}
                showsVerticalScrollIndicator={false}
              >
                {messages.length === 0 ? (
                  <AppText variant="caption" color={colors.textFaint} center>
                    No messages yet.
                  </AppText>
                ) : (
                  messages.map((m) => <Bubble key={m.id} message={m} />)
                )}
              </ScrollView>
            )}

            {sendError ? (
              <AppText variant="caption" color={colors.error} style={styles.sendErrorText}>
                {sendError}
              </AppText>
            ) : null}

            <View style={styles.composerRow}>
              <AppTextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Reply…"
                multiline
                maxLength={MAX_LEN}
                style={styles.composerInput}
                accessibilityLabel="Reply"
              />
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Send reply"
                disabled={!canSend}
                onPress={() => void send()}
                style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
              >
                {sending ? (
                  <ActivityIndicator color={colors.onBlock} />
                ) : (
                  <Ionicons name="arrow-up" size={20} color={colors.onBlock} />
                )}
              </PressableScale>
            </View>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

/** Shared back row + revamp header. */
function BackRow({ onBack }: { onBack: () => void }) {
  return (
    <>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>
      <ScreenHeader eyebrow="Admin console" title="Support" style={styles.header} />
    </>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.gutter },
  locked: {
    marginTop: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  centerSm: { paddingVertical: spacing.lg, alignItems: 'center' },
  retryWrap: { marginTop: spacing.md },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  emptyLine: { marginTop: spacing.lg, paddingHorizontal: spacing.xs },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 64,
  },
  rowText: { flex: 1, gap: 2, minWidth: 0 },
  rowNameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowNameGrow: { flexShrink: 1 },
  unreadDot: {
    minWidth: 20,
    height: 20,
    borderRadius: radius.full,
    paddingHorizontal: 6,
    backgroundColor: colors.blockRed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetInner: { gap: spacing.md, maxHeight: '100%' },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sheetEmail: { flex: 1 },
  sheetScroll: { maxHeight: 360 },
  sheetScrollContent: { paddingVertical: spacing.sm, gap: spacing.xs },
  bubbleRow: { flexDirection: 'row' },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft: { justifyContent: 'flex-start' },
  col: { flexShrink: 1, maxWidth: '82%', marginBottom: spacing.sm },
  colUser: { alignItems: 'flex-end' },
  colSupport: { alignItems: 'flex-start' },
  bubble: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  userBubble: { backgroundColor: colors.blockRed },
  supportBubble: { backgroundColor: colors.surfaceRaised },
  time: { marginTop: spacing.xs, marginHorizontal: spacing.xs },
  sendErrorText: { paddingHorizontal: spacing.xs },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  composerInput: {
    flex: 1,
    maxHeight: 100,
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
