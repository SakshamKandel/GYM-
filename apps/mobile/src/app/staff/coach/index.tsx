import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  type ListRenderItem,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated from 'react-native-reanimated';
import { formatMoney } from '@gym/shared';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  enterDown,
  enterUp,
  FractionStat,
  IconChip,
  layoutSpring,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Tag,
} from '../../../components/ui';
import { useAuth } from '../../../state/auth';
import {
  decideCoachRequest,
  getCoachInbox,
  getCoachRequests,
  getCoachWallet,
  toStaffError,
  type CoachInboxRow,
  type CoachRequest,
  type CoachRequestAction,
  type CoachWallet,
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

function requestErrorLine(code: StaffErrorCode): string {
  if (code === 'full') return 'Your roster is at capacity — raise it in your profile.';
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'not_found') return 'This request is no longer pending — pull to refresh.';
  return "Couldn't update this request — try again.";
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

/** First name only, then a placeholder — client emails never reach the
 * console (contact stays inside the app, mirroring the chat PII mask). */
function shortName(row: CoachInboxRow): string {
  const name = row.displayName.trim();
  return name || 'Client';
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
            {row.unreadForCoach > 0
              ? `${row.unreadForCoach} unread message${row.unreadForCoach === 1 ? '' : 's'}`
              : 'All caught up'}
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

/** One pending mentorship request — name + tier, the intro message, age, and
 * the accept/decline pair. Borderless charcoal block like the roster rows. */
function RequestRow({
  row,
  index,
  busyAction,
  error,
  onDecide,
}: {
  row: CoachRequest;
  index: number;
  /** Which action is in flight for THIS row (disables both buttons). */
  busyAction: CoachRequestAction | null;
  error: string | null;
  onDecide: (action: CoachRequestAction) => void;
}) {
  const name = row.displayName.trim() || 'Member';
  const message = row.message.trim();
  const busy = busyAction !== null;

  return (
    <Animated.View entering={enterUp(index)} layout={layoutSpring} style={styles.requestRow}>
      <View style={styles.nameLine}>
        <AppText variant="bodyBold" numberOfLines={1} style={styles.name}>
          {name}
        </AppText>
        <Tag label={TIER_LABEL[row.tier]} variant="outline" color={TIER_COLOR[row.tier]} />
        <View style={styles.requestSpacer} />
        <AppText variant="caption" color={colors.textFaint}>
          {relativeTime(row.createdAt)}
        </AppText>
      </View>

      {message ? (
        <AppText variant="caption" numberOfLines={2}>
          {message}
        </AppText>
      ) : null}

      {error ? (
        <AppText variant="caption" color={colors.error}>
          {error}
        </AppText>
      ) : null}

      <View style={styles.requestActions}>
        <Button
          label="Accept"
          accessibilityLabel={`Accept request from ${name}`}
          onPress={() => onDecide('accept')}
          loading={busyAction === 'accept'}
          disabled={busy}
          style={styles.requestBtn}
        />
        <Button
          label="Decline"
          variant="secondary"
          accessibilityLabel={`Decline request from ${name}`}
          onPress={() => onDecide('decline')}
          loading={busyAction === 'decline'}
          disabled={busy}
          style={styles.requestBtn}
        />
      </View>
    </Animated.View>
  );
}

/**
 * Wallet + promo hero card — the coach's commission balance, own auto-issued
 * promo code, and redemption count. Sits below the header alongside the
 * video-library link. Loading is silent (the inbox spinner already covers the
 * screen's first paint); a failure collapses to a quiet retry row so it never
 * blocks the roster underneath.
 *
 * Copy-to-clipboard: `expo-clipboard` is not in this app's dependency tree
 * (feature-module isolation — this track may only touch app/staff + features/
 * staff, not package.json), so the code is rendered as native `selectable`
 * text: long-press opens the OS "Copy" callout. No button needed.
 */
function WalletPromoCard({
  token,
  refreshSignal,
}: {
  token: string | null;
  /** Bumped by the parent on every pull-to-refresh so this card's data stays
   * in step with the roster instead of only ever loading once at mount. */
  refreshSignal: number;
}) {
  const [wallet, setWallet] = useState<CoachWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError(false);
    try {
      setWallet(await getCoachWallet(token));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    // refreshSignal intentionally re-triggers the load on pull-to-refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, refreshSignal]);

  if (loading) return null;

  if (error || !wallet) {
    return (
      <Animated.View entering={enterUp(2)}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Retry loading your wallet"
          onPress={() => void load()}
          style={styles.walletRetry}
        >
          <Ionicons name="cloud-offline-outline" size={16} color={colors.textDim} />
          <AppText variant="caption">Couldn&apos;t load your wallet · tap to retry</AppText>
        </PressableScale>
      </Animated.View>
    );
  }

  const redemptions = wallet.code?.redemptionCount ?? 0;

  return (
    <Animated.View entering={enterUp(2)} style={styles.walletCard}>
      <View style={styles.walletHeadRow}>
        <AppText variant="label" color={colors.textDim}>
          Your wallet
        </AppText>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="View wallet ledger"
          onPress={() => pushStaff(STAFF_ROUTES.coachWallet)}
          style={styles.walletLedgerLink}
        >
          <AppText variant="caption" color={colors.accent}>
            Ledger
          </AppText>
          <Ionicons name="chevron-forward" size={14} color={colors.accent} />
        </PressableScale>
      </View>

      {wallet.balances.length > 0 ? (
        <View style={styles.walletBalanceRow}>
          {wallet.balances.map((b) => (
            <AppText key={b.currency} variant="stat" tabular>
              {formatMoney(b.amountMinor, b.currency)}
            </AppText>
          ))}
        </View>
      ) : (
        <AppText variant="body" color={colors.textDim}>
          No commission yet
        </AppText>
      )}

      {wallet.code ? (
        <View style={styles.walletCodeBlock}>
          <AppText variant="label" color={colors.textFaint}>
            Your promo code
          </AppText>
          <Text selectable style={styles.walletCodeText}>
            {wallet.code.code}
          </Text>
          <AppText variant="caption" color={colors.textFaint}>
            Long-press to copy · {redemptions} redemption{redemptions === 1 ? '' : 's'}
          </AppText>
        </View>
      ) : null}

      <AppText variant="caption" color={colors.textDim} style={styles.walletCaption}>
        30% off for them — 30% to you.
      </AppText>
    </Animated.View>
  );
}

export default function CoachInboxScreen() {
  const token = useAuth((s) => s.token);
  const signOut = useStaffSignOut();

  const [rows, setRows] = useState<CoachInboxRow[]>([]);
  const [requests, setRequests] = useState<CoachRequest[]>([]);
  const [busyRequest, setBusyRequest] = useState<{
    id: string;
    action: CoachRequestAction;
  } | null>(null);
  const [requestErrors, setRequestErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<StaffErrorCode | null>(null);
  // Bumped on every pull-to-refresh — passed to WalletPromoCard so its wallet
  // fetch rides along instead of only ever loading once at mount (G15).
  const [walletRefreshSignal, setWalletRefreshSignal] = useState(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!token) {
        setError('unauthorized');
        setLoading(false);
        return;
      }
      if (mode === 'refresh') {
        setRefreshing(true);
        setWalletRefreshSignal((n) => n + 1);
      } else setLoading(true);
      try {
        // The pending-request queue is secondary — a failure there must never
        // blank the roster, so it resolves to null and keeps the last value.
        const [inbox, pending] = await Promise.all([
          getCoachInbox(token),
          getCoachRequests(token).catch(() => null),
        ]);
        if (pending) setRequests(pending);
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

  /** Accept/decline one pending request. Per-row busy; success removes the
   * row (and an accept reloads the roster so the new client appears). */
  const decide = useCallback(
    async (req: CoachRequest, action: CoachRequestAction) => {
      if (!token || busyRequest) return;
      setBusyRequest({ id: req.id, action });
      setRequestErrors((prev) => {
        if (!(req.id in prev)) return prev;
        const next = { ...prev };
        delete next[req.id];
        return next;
      });
      try {
        await decideCoachRequest(req.id, action, token);
        setRequests((prev) => prev.filter((r) => r.id !== req.id));
        if (action === 'accept') void load('refresh');
      } catch (err) {
        const code = toStaffError(err).code;
        setRequestErrors((prev) => ({ ...prev, [req.id]: requestErrorLine(code) }));
      } finally {
        setBusyRequest(null);
      }
    },
    [token, busyRequest, load],
  );

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

      {/* promo-economy: commission wallet + own promo code. */}
      <WalletPromoCard token={token} refreshSignal={walletRefreshSignal} />

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error && rows.length === 0 && requests.length === 0 ? (
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
      ) : rows.length === 0 && requests.length === 0 ? (
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
            <>
              {error ? (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading clients"
                  onPress={() => void load('initial')}
                  style={styles.staleRow}
                >
                  <Ionicons name="cloud-offline-outline" size={14} color={colors.textDim} />
                  <AppText variant="caption">Couldn&apos;t refresh · tap to retry</AppText>
                </PressableScale>
              ) : null}
              {/* Pending mentorship requests — ABOVE the roster, only when
                  someone is actually asking. Oldest first (server order). */}
              {requests.length > 0 ? (
                <View>
                  <SectionLabel>Requests</SectionLabel>
                  <View style={styles.requestList}>
                    {requests.map((req, i) => (
                      <RequestRow
                        key={req.id}
                        row={req}
                        index={i}
                        busyAction={busyRequest?.id === req.id ? busyRequest.action : null}
                        error={requestErrors[req.id] ?? null}
                        onDecide={(action) => void decide(req, action)}
                      />
                    ))}
                  </View>
                  {rows.length > 0 ? <SectionLabel>Clients</SectionLabel> : null}
                </View>
              ) : null}
            </>
          }
          ListEmptyComponent={
            <View style={styles.emptyRoster}>
              <AppText variant="caption" center color={colors.textDim}>
                No active clients yet — members you accept appear here.
              </AppText>
            </View>
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
  // promo-economy: the wallet+code card (borderless charcoal block).
  walletCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  walletHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  walletLedgerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: touch.min,
    paddingHorizontal: spacing.xs,
  },
  walletBalanceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  walletCodeBlock: { marginTop: spacing.xs, gap: 2 },
  walletCodeText: {
    fontFamily: type.display,
    fontSize: 24,
    letterSpacing: 2,
    color: colors.accent,
  },
  walletCaption: { marginTop: spacing.xs },
  walletRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
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
  // Pending-request block — same borderless charcoal language as the roster.
  requestList: { gap: spacing.sm },
  requestRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  requestSpacer: { flex: 1 },
  requestActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  // Compact pair — still ≥48dp (touch.min beats the Button's 56dp default).
  requestBtn: { flex: 1, minHeight: touch.min, paddingHorizontal: spacing.lg },
  emptyRoster: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
});
