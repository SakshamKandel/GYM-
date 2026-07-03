import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  type ListRenderItem,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  enterDown,
  enterUp,
  layoutSpring,
  PressableScale,
  Screen,
  Tag,
} from '../../../components/ui';
import { useAuth } from '../../../state/auth';
import {
  getCoachInbox,
  toStaffError,
  type CoachInboxRow,
  type StaffErrorCode,
  type Tier,
} from '../../../features/staff/api';
import { pushStaff, STAFF_ROUTES } from '../../../features/staff/nav';

/**
 * Coach inbox — the assigned-client roster, the first screen of Greece's phone
 * workflow. One row per active client with a tier chip and an unread badge;
 * rows with unread messages float to the top. Tapping a row opens that client's
 * thread. Loading is a quiet spinner, errors a tappable retry line, and a
 * pull-to-refresh keeps the roster fresh after replying.
 */

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

function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have coach access.";
  return "Couldn't load your clients.";
}

/** First name only, falling back to the email local-part, then a placeholder. */
function shortName(row: CoachInboxRow): string {
  const name = row.displayName.trim();
  if (name) return name;
  const local = row.email.split('@')[0]?.trim();
  return local && local.length > 0 ? local : 'Client';
}

/** One client row — avatar-initial, name + email, tier tag, unread badge. */
function ClientRow({ row, index }: { row: CoachInboxRow; index: number }) {
  const name = shortName(row);
  const initial = name.charAt(0).toUpperCase();
  const unread = row.unreadForCoach > 0;

  return (
    <Animated.View entering={enterUp(index)} layout={layoutSpring}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Open chat with ${name}${
          unread ? `, ${row.unreadForCoach} unread` : ''
        }`}
        onPress={() =>
          pushStaff(
            `/staff/coach/thread/${encodeURIComponent(row.id)}?name=${encodeURIComponent(
              name,
            )}&tier=${row.tier}`,
          )
        }
        style={styles.row}
      >
        <View style={[styles.avatar, unread && styles.avatarUnread]}>
          <AppText variant="bodyBold" color={unread ? colors.onAccent : colors.text}>
            {initial}
          </AppText>
        </View>

        <View style={styles.rowText}>
          <View style={styles.nameLine}>
            <AppText variant="bodyBold" numberOfLines={1} style={styles.name}>
              {name}
            </AppText>
            <Tag
              label={TIER_LABEL[row.tier]}
              variant="outline"
              color={TIER_COLOR[row.tier]}
            />
          </View>
          <AppText variant="caption" numberOfLines={1}>
            {row.email}
          </AppText>
        </View>

        {unread ? (
          <View
            accessibilityLabel={`${row.unreadForCoach} unread`}
            style={styles.badge}
          >
            <AppText variant="label" color={colors.onAccent} tabular>
              {row.unreadForCoach > 99 ? '99+' : String(row.unreadForCoach)}
            </AppText>
          </View>
        ) : (
          <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
        )}
      </PressableScale>
    </Animated.View>
  );
}

export default function CoachInboxScreen() {
  const token = useAuth((s) => s.token);

  const [rows, setRows] = useState<CoachInboxRow[]>([]);
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
        const inbox = await getCoachInbox(token);
        // Unread first, then by name so the list is stable between refreshes.
        inbox.sort((a, b) => {
          if ((b.unreadForCoach > 0 ? 1 : 0) !== (a.unreadForCoach > 0 ? 1 : 0)) {
            return (b.unreadForCoach > 0 ? 1 : 0) - (a.unreadForCoach > 0 ? 1 : 0);
          }
          if (b.unreadForCoach !== a.unreadForCoach) {
            return b.unreadForCoach - a.unreadForCoach;
          }
          return shortName(a).localeCompare(shortName(b));
        });
        setRows(inbox);
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

  const renderItem = useCallback<ListRenderItem<CoachInboxRow>>(
    ({ item, index }) => <ClientRow row={item} index={index} />,
    [],
  );

  const totalUnread = rows.reduce((n, r) => n + (r.unreadForCoach > 0 ? 1 : 0), 0);

  return (
    <Screen edges={{ bottom: false }}>
      <Animated.View entering={enterDown()} style={styles.header}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back to staff console"
          onPress={() => pushStaff(STAFF_ROUTES.hub)}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
        <View style={styles.headerText}>
          <AppText variant="heading">Inbox</AppText>
          <AppText variant="caption">
            {rows.length === 0
              ? 'Your assigned clients'
              : totalUnread > 0
                ? `${totalUnread} client${totalUnread === 1 ? '' : 's'} waiting on you`
                : 'All caught up'}
          </AppText>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Coaching profile"
          onPress={() => pushStaff(STAFF_ROUTES.coachProfile)}
          style={styles.backBtn}
        >
          <Ionicons name="person-circle-outline" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>

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
          <Ionicons name="people-outline" size={32} color={colors.textFaint} />
          <AppText variant="title" center>
            No clients yet
          </AppText>
          <AppText variant="caption" center color={colors.textDim}>
            Members assigned to you will appear here. Pull down to refresh.
          </AppText>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          ListHeaderComponent={
            error ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Retry loading clients"
                onPress={() => void load('initial')}
                style={styles.staleRow}
              >
                <Ionicons name="cloud-offline-outline" size={14} color={colors.textDim} />
                <AppText variant="caption">Couldn&apos;t refresh · tap to retry</AppText>
              </PressableScale>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
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
  headerText: { flex: 1, gap: 2 },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  retryBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  listContent: { paddingBottom: spacing.xxl, gap: spacing.sm },
  staleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarUnread: { backgroundColor: colors.accent },
  rowText: { flex: 1, gap: 3 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flexShrink: 1 },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
});
