import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
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
  toStaffError,
  type CoachAttentionRow,
  type StaffErrorCode,
  type Tier,
} from '../../../features/staff/api';
import { pushStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Coach · Attention — the caller's assigned clients sorted stalest-first, the
 * phone twin of the web `/coach/attention` queue. The server already orders
 * the roster (max of days-since-workout / days-since-check-in, never-synced
 * clients on top), so this screen does NO re-sorting — same contract as the
 * web `AttentionList`.
 *
 * Mobile's read model (features/staff/api.ts) is a thinner slice than the web
 * route: no coach-reply id, and `latestCheckIn.summary` is a plain string, not
 * a {sessions,volumeKg,prCount} object. So instead of an inline reply composer
 * this screen deep-links the whole card into the client's thread — the
 * reply lands there, matching the "attention list w/ deep-links to
 * client/thread" brief. A `pendingSuggestions` badge deep-links to Review.
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

function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have coach access.";
  return "Couldn't load the attention queue.";
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

function ClientCard({ row, index }: { row: CoachAttentionRow; index: number }) {
  const name = row.displayName.trim() || 'Client';
  const checkIn = row.latestCheckIn;

  return (
    <Animated.View entering={enterUp(index)} layout={layoutSpring}>
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
        style={styles.card}
      >
        <View style={styles.cardTop}>
          <View style={styles.nameLine}>
            <AppText variant="bodyBold" numberOfLines={1} style={styles.name}>
              {name}
            </AppText>
            <Tag label={TIER_LABEL[row.tier]} variant="outline" color={TIER_COLOR[row.tier]} />
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </View>

        <View style={styles.signalsRow}>
          <StaleSignal label="Last workout" days={row.daysSinceWorkout} />
          <StaleSignal label="Last check-in" days={row.daysSinceCheckIn} />
        </View>

        <Divider />

        {checkIn ? (
          <View style={styles.checkInBlock}>
            <AppText variant="label" color={colors.textFaint}>
              Latest check-in · {checkIn.date || '—'}
            </AppText>
            {checkIn.summary ? (
              <AppText variant="caption" color={colors.textDim} numberOfLines={2}>
                {checkIn.summary}
              </AppText>
            ) : null}
            {checkIn.note ? (
              <AppText variant="body" numberOfLines={3} style={styles.noteText}>
                “{checkIn.note}”
              </AppText>
            ) : null}
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
      </PressableScale>
    </Animated.View>
  );
}

export default function CoachAttentionScreen() {
  const token = useAuth((s) => s.token);

  const [rows, setRows] = useState<CoachAttentionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<StaffErrorCode | null>(null);

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

  return (
    <Screen
      scroll
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
            <View style={styles.metaChip}>
              <AppText variant="label" color={colors.text}>
                {rows.length} client{rows.length === 1 ? '' : 's'}, stalest first
              </AppText>
            </View>
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
            <ClientCard key={row.id} row={row} index={i} />
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
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1, minWidth: 0 },
  name: { flexShrink: 1 },
  signalsRow: { flexDirection: 'row', gap: spacing.xl, flexWrap: 'wrap' },
  staleSignal: { gap: 2 },
  checkInBlock: { gap: spacing.xs },
  noteText: { fontStyle: 'italic' },
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
