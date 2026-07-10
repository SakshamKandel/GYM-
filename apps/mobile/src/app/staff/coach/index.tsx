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
  FractionStat,
  IconChip,
  layoutSpring,
  PressableScale,
  Screen,
  ScreenHeader,
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
import {
  StaffHeaderAction,
  StaffSignOutDialog,
  switchToMemberApp,
  useStaffSignOut,
} from '../../../features/staff/StaffExit';

/**
 * Coach inbox — the assigned-client roster, the first screen of Greece's phone
 * workflow. Block language (REVAMP-BRIEF): icon-button bar → poster header →
 * ONE red hero block (the attention count, shown only when clients are
 * waiting) → the roster as borderless charcoal rows. Rows with unread float to
 * the top and carry a thin red attention bar down their left edge plus a red
 * count badge with black ink (black-on-red law). Loading is a quiet spinner,
 * errors a tappable retry line, and a pull-to-refresh keeps the roster fresh
 * after replying.
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
  return "Couldn't load your clients.";
}

/** First name only, falling back to the email local-part, then a placeholder. */
function shortName(row: CoachInboxRow): string {
  const name = row.displayName.trim();
  if (name) return name;
  const local = row.email.split('@')[0]?.trim();
  return local && local.length > 0 ? local : 'Client';
}

/** Outlined meta pill for the header row (counts, status). Not a tap target. */
function MetaChip({ label }: { label: string }) {
  return (
    <View style={styles.metaChip}>
      <AppText variant="label" color={colors.text}>
        {label}
      </AppText>
    </View>
  );
}

/** One client row — attention bar (unread), avatar-initial, name + email,
 * tier tag, unread badge. Borderless charcoal block per the row sketch. */
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
        {/* Thin red attention bar — the sanctioned accent detail on dark. */}
        {unread ? <View style={styles.attentionBar} /> : null}

        <View style={[styles.avatar, unread && styles.avatarUnread]}>
          <AppText variant="bodyBold" color={unread ? colors.onBlock : colors.text}>
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
            <AppText variant="label" color={colors.onBlock} tabular>
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
  const signOut = useStaffSignOut();

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
      {/* Icon-button bar: back → the staff hub (always reachable, never an
          app-exit), then the console actions on the right. */}
      <Animated.View entering={enterDown()} style={styles.topBar}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back to staff console"
          onPress={() => pushStaff(STAFF_ROUTES.hub)}
          style={styles.iconBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
        <View style={styles.topBarSpacer} />
        {/* Leave the console for the member app (stay signed in) — the fix for
            the back button dead-ending after a fresh coach login. */}
        <StaffHeaderAction
          icon="phone-portrait-outline"
          label="Switch to member app"
          onPress={switchToMemberApp}
        />
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Coaching profile"
          onPress={() => pushStaff(STAFF_ROUTES.coachProfile)}
          style={styles.iconBtn}
        >
          <Ionicons name="person-circle-outline" size={24} color={colors.text} />
        </PressableScale>
        <StaffHeaderAction
          icon="log-out-outline"
          label="Sign out of the staff console"
          onPress={signOut.requestSignOut}
        />
      </Animated.View>

      <ScreenHeader
        eyebrow="Coach console"
        title="Inbox"
        meta={
          rows.length > 0 ? (
            <>
              <MetaChip label={`${rows.length} client${rows.length === 1 ? '' : 's'}`} />
              <MetaChip
                label={totalUnread > 0 ? `${totalUnread} waiting` : 'All caught up'}
              />
            </>
          ) : undefined
        }
        style={styles.header}
      />

      {/* The ONE red hero block: the attention count, only when someone is
          actually waiting — black ink on red, never white. */}
      {totalUnread > 0 ? (
        <Animated.View entering={enterUp(0)} style={styles.hero}>
          <FractionStat label="Needs reply" value={totalUnread} total={rows.length} onBlock />
          <AppText variant="caption" color={colors.onBlock} style={styles.heroDim}>
            client{totalUnread === 1 ? '' : 's'} waiting on you
          </AppText>
        </Animated.View>
      ) : null}

      {/* ── videos-feature: link to the coach video library (owned by the
          videos/subscription slice — kept as its own block below the header for
          a clean merge with the header/sign-out work). ── */}
      <Animated.View entering={enterUp(1)}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Open the plan-video library"
          onPress={() => pushStaff(STAFF_ROUTES.coachVideos)}
          style={styles.videosLink}
        >
          <IconChip icon="film-outline" color={colors.accentFaint} iconColor={colors.accent} />
          <View style={styles.videosText}>
            <AppText variant="bodyBold">Video library</AppText>
            <AppText variant="caption" color={colors.textDim}>
              Add, retier or remove plan videos · see view counts
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
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

      <StaffSignOutDialog
        confirming={signOut.confirming}
        signingOut={signOut.signingOut}
        confirmSignOut={signOut.confirmSignOut}
        cancelSignOut={signOut.cancelSignOut}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  topBarSpacer: { flex: 1 },
  iconBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.gutter },
  // Outlined meta pill (chips may carry strokes — the no-border law is cards).
  metaChip: {
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Red hero block — no border, chunky radius, black ink (brief §2/§11b).
  hero: {
    backgroundColor: colors.blockRed,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  // 13px caption: black at 0.8 over red stays ≥4.5:1.
  heroDim: { opacity: 0.8 },
  // videos-feature: the video-library link block (borderless charcoal row).
  videosLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 64,
    marginBottom: spacing.lg,
  },
  videosText: { flex: 1, gap: 2 },
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
  // Borderless charcoal row (brief §11c) — separation by fill, not strokes.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 64,
  },
  // The red-left-bar attention mark on unread rows (thin accent bar on dark).
  attentionBar: {
    width: 4,
    alignSelf: 'stretch',
    borderRadius: radius.full,
    backgroundColor: colors.accent,
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
