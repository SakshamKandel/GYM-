import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, RefreshControl, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  Chip,
  ConfirmDialog,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  Tag,
} from '../../../components/ui';
import {
  decideGymReport,
  getGymEnquiries,
  getGymReports,
  getGymReviews,
  moderateGymReview,
  setGymEnquiryStatus,
  toStaffError,
  type GymEnquiryRow,
  type GymEnquiryStatus,
  type GymReportRow,
  type GymReviewRow,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { replaceStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { successHaptic } from '../../../lib/haptics';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Gym reports, reviews and enquiries — the phone twin of the web
 * `/admin/gyms/reports` console, on the same `gyms.manage` permission that
 * unlocks the gym editor. Three queues that all existed server-side with no
 * way to work them from a phone:
 *
 *  - Reports: a member says something on a listing is wrong. Fix the listing,
 *    then resolve; dismiss when the report was wrong or a duplicate.
 *  - Reviews: genuine member reviews with a hide/show lever. Hiding drops a
 *    review from the public listing AND its star rating immediately, so it
 *    takes a confirmation.
 *  - Enquiries: membership and day-pass leads. Every member in this queue was
 *    told the team would get back to them, which makes this list a promise.
 *
 * Each action refetches its own queue, so nothing on screen drifts from the
 * server after a decision.
 */

type Tab = 'reports' | 'reviews' | 'enquiries';

const TABS: { key: Tab; label: string }[] = [
  { key: 'reports', label: 'Reports' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'enquiries', label: 'Enquiries' },
];

/** The listing part a member flagged, in plain words. */
const FIELD_LABEL: Record<string, string> = {
  hours: 'Opening hours',
  phone: 'Phone number',
  address: 'Address',
  location: 'Map pin',
  closed: 'Permanently closed',
  other: 'Something else',
};

const REPORT_STATUS_LABEL: Record<GymReportRow['status'], string> = {
  open: 'Waiting',
  resolved: 'Fixed',
  dismissed: 'Dismissed',
};

const REPORT_STATUS_COLOR: Record<GymReportRow['status'], string> = {
  open: colors.warning,
  resolved: colors.success,
  dismissed: colors.textFaint,
};

const ENQUIRY_STATUS_LABEL: Record<GymEnquiryStatus, string> = {
  open: 'Waiting',
  contacted: 'Contacted',
  closed: 'Closed',
};

const ENQUIRY_STATUS_COLOR: Record<GymEnquiryStatus, string> = {
  open: colors.warning,
  contacted: colors.blue,
  closed: colors.textFaint,
};

function errorLine(code: StaffErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired. Sign in again.';
    case 'forbidden':
      return "You don't have access to moderate gym listings.";
    case 'not_found':
      return 'That one is gone already. Pull down to refresh.';
    default:
      return "Couldn't reach the server. Check your connection and try again.";
  }
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** ISO stamp → "12 Mar 2026". */
function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''} ${d.getFullYear()}`;
}

/** "★★★★☆" — a rating a person can read at a glance. */
function starLabel(stars: number): string {
  const n = Math.max(0, Math.min(5, Math.round(stars)));
  return `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`;
}

function QueueMessage({ text }: { text: string }) {
  return (
    <AppText variant="caption" color={colors.textFaint} style={styles.emptyLine}>
      {text}
    </AppText>
  );
}

export default function AdminGymModerationScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = staffCan(staffPermissions, 'gyms.manage');

  const [tab, setTab] = useState<Tab>('reports');
  const [reports, setReports] = useState<GymReportRow[] | null>(null);
  const [reviews, setReviews] = useState<GymReviewRow[] | null>(null);
  const [enquiries, setEnquiries] = useState<GymEnquiryRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The visible review a hide is being confirmed for. */
  const [hideTarget, setHideTarget] = useState<GymReviewRow | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!token) return;
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);
      setLoadError(null);
      try {
        // One queue failing must not blank the other two — each resolves on its
        // own and a failure leaves that tab's last-known list in place.
        const [nextReports, nextReviews, nextEnquiries] = await Promise.all([
          getGymReports(token).catch(() => null),
          getGymReviews(token).catch(() => null),
          getGymEnquiries(token).catch(() => null),
        ]);
        if (nextReports) setReports(nextReports);
        if (nextReviews) setReviews(nextReviews);
        if (nextEnquiries) setEnquiries(nextEnquiries);
        if (!nextReports && !nextReviews && !nextEnquiries) {
          setLoadError("Couldn't load the moderation queues.");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (allowed) void load('initial');
  }, [allowed, load]);

  const decideReport = useCallback(
    async (row: GymReportRow, status: 'resolved' | 'dismissed') => {
      if (!token || busyId) return;
      setBusyId(row.id);
      setActionError(null);
      try {
        await decideGymReport(row.id, status, token);
        successHaptic();
        setReports(await getGymReports(token));
      } catch (err) {
        setActionError(errorLine(toStaffError(err).code));
      } finally {
        setBusyId(null);
      }
    },
    [token, busyId],
  );

  const setReviewVisibility = useCallback(
    async (row: GymReviewRow, status: 'visible' | 'hidden') => {
      if (!token || busyId) return;
      setBusyId(row.id);
      setActionError(null);
      try {
        await moderateGymReview(row.id, status, token);
        successHaptic();
        setReviews(await getGymReviews(token));
      } catch (err) {
        setActionError(errorLine(toStaffError(err).code));
      } finally {
        setBusyId(null);
        setHideTarget(null);
      }
    },
    [token, busyId],
  );

  const moveEnquiry = useCallback(
    async (row: GymEnquiryRow, status: GymEnquiryStatus) => {
      if (!token || busyId) return;
      setBusyId(row.id);
      setActionError(null);
      try {
        await setGymEnquiryStatus(row.id, status, token);
        successHaptic();
        setEnquiries(await getGymEnquiries(token));
      } catch (err) {
        setActionError(errorLine(toStaffError(err).code));
      } finally {
        setBusyId(null);
      }
    },
    [token, busyId],
  );

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replaceStaff(STAFF_ROUTES.adminGyms);
  }

  if (!allowed) {
    return (
      <Screen>
        <BackRow onBack={goBack} />
        <Animated.View entering={enterUp(0)} style={styles.locked}>
          <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textFaint}>
            You don&apos;t have access to moderate gym listings.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  const openReports = reports?.filter((r) => r.status === 'open').length ?? 0;
  const openEnquiries = enquiries?.filter((e) => e.status === 'open').length ?? 0;

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
      <BackRow onBack={goBack} />

      <View style={styles.filterRow}>
        {TABS.map((t) => (
          <Chip
            key={t.key}
            label={
              t.key === 'reports' && openReports > 0
                ? `${t.label} (${openReports})`
                : t.key === 'enquiries' && openEnquiries > 0
                  ? `${t.label} (${openEnquiries})`
                  : t.label
            }
            selected={tab === t.key}
            onPress={() => setTab(t.key)}
          />
        ))}
      </View>

      {loadError ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Retry loading the moderation queues"
          onPress={() => void load('initial')}
          style={styles.retry}
        >
          <Ionicons name="refresh" size={15} color={colors.textDim} />
          <AppText variant="caption">{loadError} Tap to retry.</AppText>
        </PressableScale>
      ) : null}

      {actionError ? (
        <AppText variant="caption" color={colors.error} style={styles.actionError}>
          {actionError}
        </AppText>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : tab === 'reports' ? (
        !reports || reports.length === 0 ? (
          <QueueMessage text="No one has reported a wrong listing yet." />
        ) : (
          <View style={styles.list}>
            {reports.map((row, i) => (
              <Animated.View key={row.id} entering={enterUp(Math.min(i, 6))} style={styles.card}>
                <View style={styles.cardHead}>
                  <AppText variant="bodyBold" numberOfLines={1} style={styles.cardTitle}>
                    {row.gymName || 'Gym'}
                  </AppText>
                  <Tag
                    label={REPORT_STATUS_LABEL[row.status]}
                    variant="outline"
                    color={REPORT_STATUS_COLOR[row.status]}
                  />
                </View>
                <AppText variant="caption" color={colors.textDim}>
                  {FIELD_LABEL[row.field] ?? 'Something else'} · {formatDay(row.createdAt)}
                </AppText>
                {row.note ? <AppText variant="body">{row.note}</AppText> : null}
                <AppText variant="caption" color={colors.textFaint} numberOfLines={1}>
                  Reported by {row.reporterEmail || 'a member'}
                </AppText>
                {row.status === 'open' ? (
                  <View style={styles.actions}>
                    <Button
                      label="Fixed"
                      onPress={() => void decideReport(row, 'resolved')}
                      loading={busyId === row.id}
                      disabled={busyId !== null}
                      style={styles.actionBtn}
                      accessibilityLabel={`Mark the report on ${row.gymName} as fixed`}
                    />
                    <Button
                      label="Dismiss"
                      variant="secondary"
                      onPress={() => void decideReport(row, 'dismissed')}
                      disabled={busyId !== null}
                      style={styles.actionBtn}
                      accessibilityLabel={`Dismiss the report on ${row.gymName}`}
                    />
                  </View>
                ) : null}
              </Animated.View>
            ))}
          </View>
        )
      ) : tab === 'reviews' ? (
        !reviews || reviews.length === 0 ? (
          <QueueMessage text="No member has reviewed a gym yet." />
        ) : (
          <View style={styles.list}>
            <AppText variant="caption" color={colors.textDim} style={styles.blurb}>
              Hiding a review takes it off the listing and out of the star rating straight away.
            </AppText>
            {reviews.map((row, i) => (
              <Animated.View key={row.id} entering={enterUp(Math.min(i, 6))} style={styles.card}>
                <View style={styles.cardHead}>
                  <AppText variant="bodyBold" numberOfLines={1} style={styles.cardTitle}>
                    {row.gymName || 'Gym'}
                  </AppText>
                  <Tag
                    label={row.status === 'visible' ? 'Showing' : 'Hidden'}
                    variant="outline"
                    color={row.status === 'visible' ? colors.success : colors.textFaint}
                  />
                </View>
                <AppText variant="caption" color={colors.textDim}>
                  {starLabel(row.stars)} · {formatDay(row.createdAt)}
                </AppText>
                {row.note ? <AppText variant="body">{row.note}</AppText> : null}
                <AppText variant="caption" color={colors.textFaint} numberOfLines={1}>
                  Written by {row.authorEmail || 'a member'}
                </AppText>
                <View style={styles.actions}>
                  {row.status === 'visible' ? (
                    <Button
                      label="Hide"
                      variant="danger"
                      onPress={() => setHideTarget(row)}
                      disabled={busyId !== null}
                      style={styles.actionBtn}
                      accessibilityLabel={`Hide this review of ${row.gymName}`}
                    />
                  ) : (
                    <Button
                      label="Show again"
                      variant="secondary"
                      onPress={() => void setReviewVisibility(row, 'visible')}
                      loading={busyId === row.id}
                      disabled={busyId !== null}
                      style={styles.actionBtn}
                      accessibilityLabel={`Show this review of ${row.gymName} again`}
                    />
                  )}
                </View>
              </Animated.View>
            ))}
          </View>
        )
      ) : !enquiries || enquiries.length === 0 ? (
        <QueueMessage text="No one has asked about joining a gym yet." />
      ) : (
        <View style={styles.list}>
          <AppText variant="caption" color={colors.textDim} style={styles.blurb}>
            Everyone here was told the team would get back to them. Mark contacted once you have.
          </AppText>
          {enquiries.map((row, i) => (
            <Animated.View key={row.id} entering={enterUp(Math.min(i, 6))} style={styles.card}>
              <View style={styles.cardHead}>
                <AppText variant="bodyBold" numberOfLines={1} style={styles.cardTitle}>
                  {row.gymName || 'Gym'}
                </AppText>
                <Tag
                  label={ENQUIRY_STATUS_LABEL[row.status]}
                  variant="outline"
                  color={ENQUIRY_STATUS_COLOR[row.status]}
                />
              </View>
              <AppText variant="caption" color={colors.textDim}>
                {row.passTitle ? row.passTitle : 'Membership'} · {formatDay(row.createdAt)}
              </AppText>
              {row.message ? <AppText variant="body">{row.message}</AppText> : null}
              <View style={styles.memberBlock}>
                <AppText variant="bodyBold" numberOfLines={1}>
                  {row.memberName.trim() || 'Member'}
                </AppText>
                {row.memberEmail ? (
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={`Email ${row.memberName.trim() || 'this member'}`}
                    onPress={() => void Linking.openURL(`mailto:${row.memberEmail}`)}
                    style={styles.emailBtn}
                  >
                    <Ionicons name="mail-outline" size={16} color={colors.accent} />
                    <AppText variant="caption" color={colors.accent} numberOfLines={1}>
                      {row.memberEmail}
                    </AppText>
                  </PressableScale>
                ) : null}
              </View>
              <View style={styles.actions}>
                {row.status === 'open' ? (
                  <Button
                    label="Mark contacted"
                    onPress={() => void moveEnquiry(row, 'contacted')}
                    loading={busyId === row.id}
                    disabled={busyId !== null}
                    style={styles.actionBtn}
                    accessibilityLabel={`Mark ${row.memberName.trim() || 'this member'} as contacted`}
                  />
                ) : null}
                {row.status === 'closed' ? (
                  <Button
                    label="Reopen"
                    variant="secondary"
                    onPress={() => void moveEnquiry(row, 'open')}
                    loading={busyId === row.id}
                    disabled={busyId !== null}
                    style={styles.actionBtn}
                    accessibilityLabel="Reopen this enquiry"
                  />
                ) : (
                  <Button
                    label="Close"
                    variant="secondary"
                    onPress={() => void moveEnquiry(row, 'closed')}
                    disabled={busyId !== null}
                    style={styles.actionBtn}
                    accessibilityLabel="Close this enquiry"
                  />
                )}
              </View>
            </Animated.View>
          ))}
        </View>
      )}

      <ConfirmDialog
        visible={hideTarget !== null}
        title="Hide this review?"
        message={
          hideTarget
            ? `It comes off ${hideTarget.gymName || 'the listing'} and stops counting towards the star rating. You can put it back later.`
            : undefined
        }
        confirmLabel={busyId ? 'Hiding…' : 'Hide it'}
        cancelLabel="Leave it up"
        danger
        onConfirm={() => {
          if (hideTarget) void setReviewVisibility(hideTarget, 'hidden');
        }}
        onCancel={() => {
          if (!busyId) setHideTarget(null);
        }}
      />
    </Screen>
  );
}

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
      <ScreenHeader eyebrow="Admin console" title="Gym feedback" style={styles.header} />
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
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    minHeight: touch.min,
  },
  actionError: { marginBottom: spacing.sm },
  center: { paddingVertical: spacing.xxl, alignItems: 'center' },
  emptyLine: { marginTop: spacing.lg },
  blurb: { marginBottom: spacing.xs },
  list: { gap: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: { flexShrink: 1 },
  memberBlock: { marginTop: spacing.xs, gap: 2 },
  emailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    minHeight: touch.min,
    paddingRight: spacing.sm,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actionBtn: { flex: 1, minHeight: touch.min, paddingHorizontal: spacing.lg },
});
