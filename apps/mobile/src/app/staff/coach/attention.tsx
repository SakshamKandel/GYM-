import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Divider,
  enterDown,
  enterUp,
  layoutSpring,
  PressableScale,
  Screen,
  ScreenHeader,
  Tag,
} from '../../../components/ui';
import {
  getCoachAttention,
  replyToCheckIn,
  toStaffError,
  type CoachAttentionRow,
  type StaffErrorCode,
  type Tier,
} from '../../../features/staff/api';
import { pushStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { successHaptic } from '../../../lib/haptics';
import { useAuth } from '../../../state/auth';

/**
 * Coach · Attention — the caller's assigned clients sorted stalest-first, the
 * phone twin of the web `/coach/attention` queue. The server already orders
 * the roster (max of days-since-workout / days-since-check-in, never-synced
 * clients on top), so this screen does NO re-sorting — same contract as the
 * web `AttentionList`.
 *
 * Each card carries the latest check-in in full (bodyweight, the three
 * self-ratings, the week rollup, the member's own words) and an inline reply
 * box. That reply goes through `replyToCheckIn`, NOT the thread reply: only
 * the check-in route links the message back to the check-in, which is what
 * marks it answered. This screen used to hand the coach off to the thread
 * instead, so every check-in a phone coach answered stayed in the queue
 * forever and the web console said the client was still waiting. Answering
 * here flips the card to "Answered" straight away, and the reply still lands
 * in the same chat thread the client already reads.
 *
 * Tapping the card name still opens the thread for the wider conversation, and
 * a `pendingSuggestions` badge deep-links to Review.
 */

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

const REPLY_MAX_LEN = 2000;

function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired. Sign in again.';
  if (code === 'forbidden') return "You don't have coach access.";
  return "Couldn't load the attention queue.";
}

function replyErrorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired. Sign in again.';
  if (code === 'forbidden') return 'This client is no longer assigned to you.';
  if (code === 'not_found') return 'That check-in is gone. Pull down to refresh.';
  if (code === 'invalid') return 'That reply is too long to send.';
  return "Couldn't send that reply. Check your connection and try again.";
}

/** Whole-day staleness label; null = the client never produced this signal. */
function daysLabel(days: number | null): string {
  if (days === null) return 'Never';
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

/** Neutral under a week, warning at 7+, critical at 14+ or never — mirrors
 * the web queue's staleness tone. */
function staleColor(days: number | null): string {
  if (days === null || days >= 14) return colors.error;
  if (days >= 7) return colors.warning;
  return colors.textDim;
}

/** "82.5 kg" / "100 kg" — canonical kg, one decimal at most. */
function formatKg(kg: number): string {
  const rounded = Math.round(kg * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} kg`;
}

function StaleSignal({ label, days }: { label: string; days: number | null }) {
  return (
    <View style={styles.staleSignal}>
      <AppText variant="caption" color={colors.textFaint}>
        {label}
      </AppText>
      <AppText variant="label" color={staleColor(days)}>
        {daysLabel(days)}
      </AppText>
    </View>
  );
}

/** One "Sleep 4/5" style figure. Skipped entirely when the value is missing. */
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <AppText variant="caption" color={colors.textFaint}>
        {label}
      </AppText>
      <AppText variant="label" color={colors.text} tabular>
        {value}
      </AppText>
    </View>
  );
}

/** Per-card reply state, kept in the parent so only one card is ever sending. */
interface ReplyState {
  clientId: string;
  draft: string;
}

function ClientCard({
  row,
  index,
  replying,
  sending,
  error,
  contactHidden,
  onOpenReply,
  onChangeDraft,
  onCancelReply,
  onSend,
}: {
  row: CoachAttentionRow;
  index: number;
  /** The open composer's draft, or null when this card's composer is closed. */
  replying: string | null;
  sending: boolean;
  error: string | null;
  contactHidden: boolean;
  onOpenReply: () => void;
  onChangeDraft: (text: string) => void;
  onCancelReply: () => void;
  onSend: () => void;
}) {
  const name = row.displayName.trim() || 'Client';
  const checkIn = row.latestCheckIn;
  const answered = checkIn?.coachReplyMessageId != null;
  const canSend = (replying ?? '').trim().length > 0 && !sending;

  return (
    <Animated.View entering={enterUp(index)} layout={layoutSpring} style={styles.card}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Open chat with ${name}`}
        onPress={() =>
          pushStaff(
            `/staff/coach/thread/${encodeURIComponent(row.id)}?name=${encodeURIComponent(
              name,
            )}&tier=${row.tier}`,
          )
        }
        style={styles.cardTop}
      >
        <View style={styles.nameLine}>
          <AppText variant="bodyBold" numberOfLines={1} style={styles.name}>
            {name}
          </AppText>
          <Tag label={TIER_LABEL[row.tier]} variant="outline" color={TIER_COLOR[row.tier]} />
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </PressableScale>

      <View style={styles.signalsRow}>
        <StaleSignal label="Last workout" days={row.daysSinceWorkout} />
        <StaleSignal label="Last check-in" days={row.daysSinceCheckIn} />
      </View>

      <Divider />

      {checkIn ? (
        <View style={styles.checkInBlock}>
          <View style={styles.checkInHead}>
            <AppText variant="label" color={colors.textFaint}>
              Latest check-in · {checkIn.date || '—'}
            </AppText>
            {answered ? <Tag label="Answered" variant="dim" /> : null}
          </View>

          <View style={styles.metricsRow}>
            {checkIn.bodyweightKg !== null ? (
              <Metric label="Bodyweight" value={formatKg(checkIn.bodyweightKg)} />
            ) : null}
            {checkIn.sleep !== null ? (
              <Metric label="Sleep" value={`${checkIn.sleep}/5`} />
            ) : null}
            {checkIn.energy !== null ? (
              <Metric label="Energy" value={`${checkIn.energy}/5`} />
            ) : null}
            {checkIn.soreness !== null ? (
              <Metric label="Soreness" value={`${checkIn.soreness}/5`} />
            ) : null}
          </View>

          {checkIn.summary ? (
            <View style={styles.metricsRow}>
              <Metric label="Sessions that week" value={String(checkIn.summary.sessions)} />
              <Metric
                label="Volume"
                value={`${Math.round(checkIn.summary.volumeKg).toLocaleString()} kg`}
              />
              <Metric label="Records" value={String(checkIn.summary.prCount)} />
            </View>
          ) : null}

          {checkIn.note ? (
            <AppText variant="body" numberOfLines={6} style={styles.noteText}>
              “{checkIn.note}”
            </AppText>
          ) : null}

          {replying !== null ? (
            <View style={styles.composer}>
              <AppTextInput
                value={replying}
                onChangeText={onChangeDraft}
                placeholder={`Reply to ${name.split(' ')[0]}'s check-in…`}
                multiline
                maxLength={REPLY_MAX_LEN}
                editable={!sending}
                autoFocus
                style={styles.composerInput}
                accessibilityLabel={`Reply to ${name}'s check-in`}
              />
              {error ? (
                <AppText variant="caption" color={colors.error}>
                  {error}
                </AppText>
              ) : null}
              <View style={styles.composerActions}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={onCancelReply}
                  disabled={sending}
                  style={styles.composerBtn}
                  accessibilityLabel={`Cancel the reply to ${name}`}
                />
                <Button
                  label={sending ? 'Sending…' : 'Send reply'}
                  onPress={onSend}
                  loading={sending}
                  disabled={!canSend}
                  style={styles.composerBtn}
                  accessibilityLabel={`Send the reply to ${name}`}
                />
              </View>
            </View>
          ) : (
            <View style={styles.replyRow}>
              {contactHidden ? (
                <AppText variant="caption" color={colors.textDim}>
                  Sent, but we hid the contact details in that message. Coaching stays in the app.
                </AppText>
              ) : null}
              {error ? (
                <AppText variant="caption" color={colors.error}>
                  {error}
                </AppText>
              ) : null}
              <Button
                label={answered ? 'Reply again' : 'Reply'}
                variant="secondary"
                onPress={onOpenReply}
                style={styles.replyBtn}
                accessibilityLabel={`Reply to ${name}'s check-in`}
              />
            </View>
          )}
        </View>
      ) : (
        <AppText variant="caption" color={colors.textFaint} style={styles.checkInBlock}>
          No check-ins yet.
        </AppText>
      )}

      {row.pendingSuggestions > 0 ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${row.pendingSuggestions} suggestions to review for ${name}`}
          onPress={() => pushStaff(STAFF_ROUTES.coachReview)}
          style={styles.reviewPill}
        >
          <Ionicons name="trending-up-outline" size={14} color={colors.accent} />
          <AppText variant="label" color={colors.accent}>
            {row.pendingSuggestions} to review
          </AppText>
        </PressableScale>
      ) : null}
    </Animated.View>
  );
}

export default function CoachAttentionScreen() {
  const token = useAuth((s) => s.token);

  const [rows, setRows] = useState<CoachAttentionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<StaffErrorCode | null>(null);

  // One composer open at a time — the list is a working queue, not a chat.
  const [reply, setReply] = useState<ReplyState | null>(null);
  const [sending, setSending] = useState(false);
  const [replyErrors, setReplyErrors] = useState<Record<string, string>>({});
  // Which client's last reply was stored with contact details taken out. Keyed
  // by client id because the composer closes on send, so the notice has to
  // survive on the collapsed card.
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!token) {
        setError('unauthorized');
        setLoading(false);
        return;
      }
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);
      try {
        setRows(await getCoachAttention(token));
        setError(null);
      } catch (err) {
        setError(toStaffError(err).code);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  const openReply = useCallback((clientId: string) => {
    setReply({ clientId, draft: '' });
    setHiddenFor(null);
    setReplyErrors((prev) => {
      if (!(clientId in prev)) return prev;
      const next = { ...prev };
      delete next[clientId];
      return next;
    });
  }, []);

  const send = useCallback(
    async (row: CoachAttentionRow) => {
      const checkIn = row.latestCheckIn;
      const body = reply?.draft.trim() ?? '';
      if (!token || !checkIn || sending || body.length === 0) return;
      setSending(true);
      setReplyErrors((prev) => {
        if (!(row.id in prev)) return prev;
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      try {
        const sent = await replyToCheckIn(checkIn.id, body, token);
        if (useAuth.getState().token !== token) return;
        successHaptic();
        setHiddenFor(sent.contactHidden ? row.id : null);
        // Flip the card to answered straight away — the same field the server
        // just wrote, so a refresh agrees rather than undoing this.
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id && r.latestCheckIn
              ? {
                  ...r,
                  latestCheckIn: {
                    ...r.latestCheckIn,
                    coachReplyMessageId: sent.message.id,
                  },
                }
              : r,
          ),
        );
        setReply(null);
      } catch (err) {
        if (useAuth.getState().token !== token) return;
        setReplyErrors((prev) => ({
          ...prev,
          [row.id]: replyErrorLine(toStaffError(err).code),
        }));
      } finally {
        setSending(false);
      }
    },
    [token, reply, sending],
  );

  const waiting = rows.filter(
    (r) => r.latestCheckIn !== null && r.latestCheckIn.coachReplyMessageId === null,
  ).length;

  return (
    <Screen
      scroll
      keyboardAware
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load('refresh')}
          tintColor={colors.accent}
          colors={[colors.accent]}
        />
      }
    >
      <Animated.View entering={enterDown()} style={styles.backRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back to coach console"
          onPress={() => pushStaff(STAFF_ROUTES.coachInbox)}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>

      <ScreenHeader
        eyebrow="Coach console"
        title="Attention"
        meta={
          rows.length > 0 ? (
            <>
              <View style={styles.metaChip}>
                <AppText variant="label" color={colors.text}>
                  {rows.length} client{rows.length === 1 ? '' : 's'}, stalest first
                </AppText>
              </View>
              {waiting > 0 ? (
                <View style={styles.metaChip}>
                  <AppText variant="label" color={colors.text}>
                    {waiting} check-in{waiting === 1 ? '' : 's'} to answer
                  </AppText>
                </View>
              ) : null}
            </>
          ) : undefined
        }
        style={styles.header}
      />

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error && rows.length === 0 ? (
        <View style={styles.centre}>
          <Ionicons name="cloud-offline-outline" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textDim}>
            {errorLine(error)}
          </AppText>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Retry"
            onPress={() => void load('initial')}
            style={styles.retryBtn}
          >
            <AppText variant="label" color={colors.accent}>
              Tap to retry
            </AppText>
          </PressableScale>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.centre}>
          <Ionicons name="checkmark-circle-outline" size={32} color={colors.textFaint} />
          <AppText variant="title" center>
            No clients yet
          </AppText>
          <AppText variant="caption" center color={colors.textDim}>
            Members assigned to you will appear here, sorted by how long they&apos;ve been quiet.
          </AppText>
        </View>
      ) : (
        <View style={styles.list}>
          {rows.map((row, i) => (
            <ClientCard
              key={row.id}
              row={row}
              index={i}
              replying={reply?.clientId === row.id ? reply.draft : null}
              sending={sending && reply?.clientId === row.id}
              error={replyErrors[row.id] ?? null}
              contactHidden={hiddenFor === row.id}
              onOpenReply={() => openReply(row.id)}
              onChangeDraft={(text) =>
                setReply((prev) => (prev && prev.clientId === row.id ? { ...prev, draft: text } : prev))
              }
              onCancelReply={() => {
                if (!sending) setReply(null);
              }}
              onSend={() => void send(row)}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  backRow: { marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.gutter },
  metaChip: {
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centre: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
  },
  retryBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  list: { gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.md,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: touch.min,
  },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1, minWidth: 0 },
  name: { flexShrink: 1 },
  signalsRow: { flexDirection: 'row', gap: spacing.xl, flexWrap: 'wrap' },
  staleSignal: { gap: 2 },
  checkInBlock: { gap: spacing.sm },
  checkInHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.xl, rowGap: spacing.xs },
  metric: { gap: 2 },
  noteText: { fontStyle: 'italic' },
  replyRow: { gap: spacing.sm, marginTop: spacing.xs },
  replyBtn: { alignSelf: 'flex-start', minHeight: touch.min, paddingHorizontal: spacing.xl },
  composer: { gap: spacing.sm, marginTop: spacing.xs },
  composerInput: { minHeight: 88, paddingTop: spacing.md, textAlignVertical: 'top' },
  composerActions: { flexDirection: 'row', gap: spacing.sm },
  composerBtn: { flex: 1, minHeight: touch.min, paddingHorizontal: spacing.lg },
  reviewPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    minHeight: touch.min,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.accentFaint,
  },
});
