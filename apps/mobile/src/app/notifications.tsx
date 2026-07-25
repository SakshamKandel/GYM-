import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, RefreshControl, StyleSheet, Switch, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  Card,
  EmptyState,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
} from '../components/ui';
import {
  getNotificationPrefs,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  putNotificationPrefs,
  toNotificationError,
  type NotificationPrefsState,
  type NotificationRow,
} from '../features/notifications/api';
import {
  deepLinkForNotification,
  getNotificationPermissionState,
  registerForPushNotificationsAsync,
  requestPermission,
  setNotificationBadgeCount,
  type NotificationPermissionState,
} from '../lib/notifications';
import { useAuth } from '../state/auth';

/**
 * /notifications — the member-facing notification center (Pack B / Pack P;
 * WP-2's `GET /api/notifications` + `PUT /api/notifications/prefs` frozen
 * contract). Two sections: a paginated inbox (tap → mark read + deep-link,
 * pull-to-refresh, "mark all read") and per-category push preferences +
 * quiet hours. Same screen skeleton as /invite and /badges: Screen scroll,
 * back header, quiet stale/retry row instead of a blocking error state.
 */

const CATEGORY_LABEL: Record<NotificationCategory, { title: string; blurb: string }> = {
  orders: { title: 'Meal orders', blurb: 'When an order is placed, on the way, or cancelled.' },
  payments: { title: 'Payments', blurb: 'When we check a receipt or send money you are owed.' },
  support: { title: 'Support', blurb: 'Replies to anything you have written to us.' },
  coaching: { title: 'Coaching', blurb: 'Messages from your coach, check-ins and milestones.' },
  billing: { title: 'Membership', blurb: 'When your membership is about to end or renews.' },
  engagement: { title: 'Nudges', blurb: 'Your streak, and a word when you have been away.' },
};

const PAGE_SIZE = 30;
const QUIET_DEFAULT_START = 22 * 60; // 22:00
const QUIET_DEFAULT_END = 7 * 60; // 07:00

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

/**
 * Push off at the OS level makes every switch below a lie, so read the real
 * state and say so. Wrapped because the web build of `lib/notifications` has
 * no permission helper — web simply never shows the banner.
 */
async function readPermissionState(): Promise<NotificationPermissionState> {
  try {
    return await getNotificationPermissionState();
  } catch {
    return 'unsupported';
  }
}

/** Keep the app-icon badge in step with the inbox. Never throws (see above). */
function syncBadge(unread: number): void {
  try {
    void setNotificationBadgeCount(unread);
  } catch {
    // No badge support on this platform build.
  }
}

function hourLabel(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60) % 24;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${suffix}`;
}

/**
 * Quiet hours are measured in Nepal time for everyone, because that is the one
 * clock the server has — no member time zone is stored yet. This screen used to
 * print the hours bare, which read as "your local hours" and quietly misled
 * anyone travelling or living elsewhere: their quiet window sat in the middle
 * of their afternoon. Until a member time zone exists, name the clock.
 */
const QUIET_HOURS_ZONE = 'Nepal time';

function NotificationRowItem({
  row,
  onPress,
}: {
  row: NotificationRow;
  onPress: (row: NotificationRow) => void;
}) {
  const unread = row.readAt === null;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${row.title}. ${row.body}`}
      onPress={() => onPress(row)}
      style={styles.row}
    >
      {unread ? <View style={styles.unreadDot} /> : <View style={styles.unreadDotSpacer} />}
      <View style={styles.rowText}>
        <AppText variant="bodyBold" numberOfLines={1}>
          {row.title}
        </AppText>
        <AppText variant="caption" numberOfLines={2} color={colors.textDim}>
          {row.body}
        </AppText>
      </View>
      <AppText variant="caption" color={colors.textFaint}>
        {relativeTime(row.createdAt)}
      </AppText>
    </PressableScale>
  );
}

export default function NotificationsScreen() {
  const token = useAuth((s) => s.token);
  return <NotificationsSession key={token ?? 'signed-out'} token={token} />;
}

function NotificationsSession({ token }: { token: string | null }) {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [prefs, setPrefs] = useState<NotificationPrefsState | null>(null);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  // 'unsupported' until we've actually read the OS state, so the banner can
  // never flash on a device where notifications are perfectly fine.
  const [permission, setPermission] = useState<NotificationPermissionState>('unsupported');
  const [askingPermission, setAskingPermission] = useState(false);

  const listSeq = useRef(0);
  const prefsSeq = useRef(0);

  const load = useCallback(async () => {
    if (!token) return;
    const seq = ++listSeq.current;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    try {
      const page = await getNotifications(token, { limit: PAGE_SIZE });
      if (listSeq.current !== seq || useAuth.getState().token !== token) return;
      setRows(page.notifications);
      setUnreadCount(page.unreadCount);
      setNextOffset(page.nextOffset);
      syncBadge(page.unreadCount);
    } catch (e) {
      if (listSeq.current !== seq || useAuth.getState().token !== token) return;
      setError(toNotificationError(e).code === 'unauthorized'
        ? 'Your session expired. Sign in again.'
        : "Couldn't load your notifications.");
    } finally {
      if (listSeq.current === seq && useAuth.getState().token === token) setLoading(false);
    }
  }, [token]);

  const loadPrefs = useCallback(async () => {
    if (!token) return;
    const seq = ++prefsSeq.current;
    try {
      const next = await getNotificationPrefs(token);
      if (prefsSeq.current !== seq || useAuth.getState().token !== token) return;
      setPrefs(next);
    } catch {
      // Stay null — the section shows its own quiet retry line.
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
      void loadPrefs();
      // Re-read on every focus: the user may have just come back from phone
      // settings, where they could have flipped notifications either way.
      void readPermissionState().then(setPermission);
    }, [load, loadPrefs]),
  );

  /** "Turn on notifications" — only offered while the OS can still ask. */
  async function onAskPermission(): Promise<void> {
    if (askingPermission) return;
    setAskingPermission(true);
    try {
      if (await requestPermission()) {
        // Just granted — claim this device for the account now, instead of
        // leaving push dead until the next cold start.
        await registerForPushNotificationsAsync();
      }
    } catch {
      // Never throws in practice; the re-read below reports the truth anyway.
    }
    setPermission(await readPermissionState());
    setAskingPermission(false);
  }

  async function onRefresh(): Promise<void> {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function loadMore(): Promise<void> {
    if (!token || loadingMore || nextOffset === null) return;
    const seq = listSeq.current;
    setLoadingMore(true);
    try {
      const page = await getNotifications(token, { limit: PAGE_SIZE, offset: nextOffset });
      if (listSeq.current !== seq || useAuth.getState().token !== token) return;
      setRows((prev) => [...prev, ...page.notifications]);
      setNextOffset(page.nextOffset);
    } catch {
      // Best-effort — the "load more" row just stays tappable to retry.
    } finally {
      if (listSeq.current === seq && useAuth.getState().token === token) setLoadingMore(false);
    }
  }

  async function openRow(row: NotificationRow): Promise<void> {
    if (!token) return;
    if (row.readAt === null) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, readAt: new Date().toISOString() } : r)));
      setUnreadCount((n) => Math.max(0, n - 1));
      syncBadge(Math.max(0, unreadCount - 1));
      void markNotificationRead(row.id, token).catch(() => {
        // Best-effort — worst case it re-shows as unread next load.
      });
    }
    const target = deepLinkForNotification(row.data);
    if (target) router.push(target as never);
  }

  async function onMarkAllRead(): Promise<void> {
    if (!token || unreadCount === 0) return;
    setRows((prev) => prev.map((r) => (r.readAt === null ? { ...r, readAt: new Date().toISOString() } : r)));
    setUnreadCount(0);
    syncBadge(0);
    try {
      await markAllNotificationsRead(token);
    } catch {
      // Best-effort — a retry (or the next load) reconciles.
    }
  }

  async function toggleCategory(category: NotificationCategory, on: boolean): Promise<void> {
    if (!token || !prefs || prefsBusy) return;
    const nextCategories: NotificationPrefsState['categories'] = { ...prefs.categories };
    for (const c of NOTIFICATION_CATEGORIES) {
      nextCategories[c] = { push: nextCategories[c]?.push ?? true };
    }
    nextCategories[category] = { push: on };
    setPrefs({ ...prefs, categories: nextCategories });
    setPrefsBusy(true);
    setPrefsError(null);
    try {
      const fresh = await putNotificationPrefs({ categories: nextCategories }, token);
      if (useAuth.getState().token !== token) return;
      setPrefs(fresh);
    } catch {
      if (useAuth.getState().token !== token) return;
      setPrefsError("Couldn't save. Try again.");
      void loadPrefs();
    } finally {
      if (useAuth.getState().token === token) setPrefsBusy(false);
    }
  }

  async function toggleQuietHours(on: boolean): Promise<void> {
    if (!token || !prefs || prefsBusy) return;
    const next = on
      ? { quietHoursStart: QUIET_DEFAULT_START, quietHoursEnd: QUIET_DEFAULT_END }
      : { quietHoursStart: null, quietHoursEnd: null };
    setPrefs({ ...prefs, ...next });
    setPrefsBusy(true);
    setPrefsError(null);
    try {
      const fresh = await putNotificationPrefs(next, token);
      if (useAuth.getState().token !== token) return;
      setPrefs(fresh);
    } catch {
      if (useAuth.getState().token !== token) return;
      setPrefsError("Couldn't save. Try again.");
      void loadPrefs();
    } finally {
      if (useAuth.getState().token === token) setPrefsBusy(false);
    }
  }

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  const quietOn = prefs?.quietHoursStart !== null && prefs?.quietHoursStart !== undefined;

  return (
    <Screen
      scroll
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.accent} />
      }
    >
      <Animated.View entering={enterDown()} style={styles.backRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={goBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>

      <ScreenHeader eyebrow="Stay in the loop" title="Notifications" style={styles.header} />

      <Animated.View entering={enterUp(0)}>
        <View style={styles.sectionHeadRow}>
          <SectionLabel>Inbox</SectionLabel>
          {unreadCount > 0 ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Mark all as read"
              onPress={() => void onMarkAllRead()}
              style={styles.markAllBtn}
            >
              <AppText variant="caption" color={colors.accent}>
                Mark all read
              </AppText>
            </PressableScale>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Retry"
            onPress={() => void load()}
            style={styles.retry}
          >
            <Ionicons name="refresh" size={15} color={colors.textDim} />
            <AppText variant="caption">{error} Tap to retry.</AppText>
          </PressableScale>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="notifications-outline"
            title="You're all caught up"
            body="Order updates, coach messages and account alerts land here."
          />
        ) : (
          <Card style={styles.listCard}>
            {rows.map((row) => (
              <NotificationRowItem key={row.id} row={row} onPress={(r) => void openRow(r)} />
            ))}
            {nextOffset !== null ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Load more notifications"
                onPress={() => void loadMore()}
                style={styles.loadMoreRow}
              >
                {loadingMore ? (
                  <ActivityIndicator size="small" color={colors.textDim} />
                ) : (
                  <AppText variant="caption" color={colors.textDim}>
                    Load more
                  </AppText>
                )}
              </PressableScale>
            ) : null}
          </Card>
        )}
      </Animated.View>

      <Animated.View entering={enterUp(1)}>
        <SectionLabel>What we can notify you about</SectionLabel>

        {/* The switches below only matter if the phone lets notifications
            through at all. When it doesn't, say so first — otherwise six
            toggles read as "on" while nothing can ever arrive. */}
        {permission === 'canAsk' || permission === 'blocked' ? (
          <Card style={styles.permissionCard}>
            <View style={styles.permissionHead}>
              <Ionicons name="notifications-off-outline" size={20} color={colors.warning} />
              <AppText variant="bodyBold" style={styles.permissionTitle}>
                {permission === 'canAsk'
                  ? 'Notifications are not turned on'
                  : 'Notifications are switched off'}
              </AppText>
            </View>
            <AppText variant="body" color={colors.textDim}>
              {permission === 'canAsk'
                ? "Your phone hasn't been asked yet, so nothing below can reach you. Everything still waits for you here in your inbox."
                : 'Your phone is blocking notifications from this app. Turn them back on in your phone settings. Until then, nothing below can reach you.'}
            </AppText>
            {permission === 'canAsk' ? (
              <Button
                label="Turn on notifications"
                loading={askingPermission}
                onPress={() => void onAskPermission()}
                style={styles.permissionBtn}
              />
            ) : (
              <Button
                label="Open Settings"
                onPress={() => {
                  void Linking.openSettings().catch(() => undefined);
                }}
                style={styles.permissionBtn}
              />
            )}
          </Card>
        ) : null}

        {!prefs ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <Card style={styles.prefsCard}>
            {NOTIFICATION_CATEGORIES.map((category) => {
              const on = prefs.categories[category]?.push ?? true;
              const meta = CATEGORY_LABEL[category];
              return (
                <View key={category} style={styles.prefRow}>
                  <View style={styles.rowText}>
                    <AppText variant="bodyBold" numberOfLines={1}>
                      {meta.title}
                    </AppText>
                    <AppText variant="caption" color={colors.textDim} numberOfLines={2}>
                      {meta.blurb}
                    </AppText>
                  </View>
                  <Switch
                    value={on}
                    onValueChange={(v) => void toggleCategory(category, v)}
                    disabled={prefsBusy}
                    trackColor={{ false: colors.surfaceRaised, true: colors.accentDim }}
                    thumbColor={on ? colors.accent : colors.textDim}
                    accessibilityLabel={`Notify me about ${meta.title.toLowerCase()}`}
                  />
                </View>
              );
            })}

            <View style={[styles.prefRow, styles.quietRow]}>
              <View style={styles.rowText}>
                <AppText variant="bodyBold" numberOfLines={1}>
                  Quiet hours
                </AppText>
                <AppText variant="caption" color={colors.textDim} numberOfLines={3}>
                  {quietOn && prefs.quietHoursStart !== null && prefs.quietHoursEnd !== null
                    ? `No notifications ${hourLabel(prefs.quietHoursStart)} to ${hourLabel(
                        prefs.quietHoursEnd,
                      )}, ${QUIET_HOURS_ZONE}. They'll still be waiting in your inbox.`
                    : `Notifications can arrive any time. Quiet hours run on ${QUIET_HOURS_ZONE}.`}
                </AppText>
              </View>
              <Switch
                value={quietOn}
                onValueChange={(v) => void toggleQuietHours(v)}
                disabled={prefsBusy}
                trackColor={{ false: colors.surfaceRaised, true: colors.accentDim }}
                thumbColor={quietOn ? colors.accent : colors.textDim}
                accessibilityLabel="Quiet hours"
              />
            </View>

            {prefsError ? (
              <AppText variant="caption" color={colors.error} style={styles.prefsErrorText}>
                {prefsError}
              </AppText>
            ) : null}
          </Card>
        )}
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  backRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.gutter },
  sectionHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  markAllBtn: { minHeight: touch.min, justifyContent: 'center', paddingHorizontal: spacing.xs },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  retry: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  listCard: { gap: 0, marginBottom: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 64,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.blockRed,
  },
  unreadDotSpacer: { width: 8, height: 8 },
  rowText: { flex: 1, gap: 2, minWidth: 0 },
  loadMoreRow: { alignItems: 'center', paddingVertical: spacing.md, minHeight: touch.min, justifyContent: 'center' },
  permissionCard: { gap: spacing.sm, marginBottom: spacing.md },
  permissionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  permissionTitle: { flex: 1, minWidth: 0 },
  permissionBtn: { alignSelf: 'stretch', marginTop: spacing.xs },
  prefsCard: { gap: 0, marginBottom: spacing.xl },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surfaceRaised,
  },
  quietRow: { marginTop: spacing.xs },
  prefsErrorText: { marginTop: spacing.sm },
});
