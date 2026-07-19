import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
} from '../../../components/ui';
import {
  adjustMemberXp,
  getGamificationOverview,
  listChallengesAdmin,
  moderateChallenge,
  revokeBadge,
  toStaffError,
  type AdminChallengeRow,
  type AwardedBadgeRow,
  type GamificationOverview,
  type StaffErrorCode,
  type XpCorrectionRow,
} from '../../../features/staff/api';
import { replaceStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { ReauthSheet, useReauth } from '../../../features/staff/ReauthGate';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Gamification — XP overview + corrections, badge revoke, and
 * challenge moderation (v1.0.3 mobile parity, ARCHITECTURE-REVIEW-2026-07-18
 * §6 NEXT). There is no single "overview" route server-side — this composes
 * getGamificationOverview (recent corrections + recent awarded badges, both
 * optionally narrowed to one account) with the separate global
 * listChallengesAdmin feed, mirroring the web console's three-panel layout.
 *
 * XP adjustment is money-adjacent (it moves a virtual balance members may
 * feel entitled to), so it requires a non-empty audited `reason` and goes
 * through the same password step-up gate (ReauthGate) used elsewhere for
 * destructive admin actions. Badge revoke and challenge moderation are
 * reversible/inspectable via the audit trail and stay a plain ConfirmDialog.
 *
 * Requires `gamification.manage`.
 */

function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have access to this.";
  if (code === 'not_found') return 'Account not found.';
  if (code === 'invalid') return 'Enter a non-zero XP amount.';
  return "Couldn't reach the server.";
}

/** Short relative age ("3m", "2h", "5d") with an absolute fallback. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
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

function CorrectionRow({ row }: { row: XpCorrectionRow }) {
  const positive = row.amount >= 0;
  return (
    <View style={styles.listRow}>
      <View style={styles.listRowHead}>
        <AppText variant="bodyBold" numberOfLines={1} style={styles.listRowTitle}>
          {row.accountName?.trim() || row.accountEmail || row.accountId}
        </AppText>
        <AppText variant="bodyBold" tabular color={positive ? colors.success : colors.error}>
          {positive ? '+' : ''}
          {row.amount.toLocaleString()} XP
        </AppText>
      </View>
      <AppText variant="caption" color={colors.textFaint}>
        {relativeTime(row.createdAt)}
      </AppText>
    </View>
  );
}

function BadgeRow({
  row,
  onRevoke,
}: {
  row: AwardedBadgeRow;
  onRevoke: (row: AwardedBadgeRow) => void;
}) {
  return (
    <View style={styles.listRow}>
      <View style={styles.listRowHead}>
        <AppText variant="bodyBold" numberOfLines={1} style={styles.listRowTitle}>
          {row.badgeName || row.badgeId}
        </AppText>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Revoke ${row.badgeName || 'badge'} from ${row.accountName || row.accountEmail}`}
          onPress={() => onRevoke(row)}
          style={styles.iconBtn}
        >
          <Ionicons name="trash-outline" size={18} color={colors.error} />
        </PressableScale>
      </View>
      <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
        {row.accountName?.trim() || row.accountEmail}
      </AppText>
      <AppText variant="caption" color={colors.textFaint}>
        {row.status} · earned {relativeTime(row.earnedAt)}
      </AppText>
    </View>
  );
}

function ChallengeRow({
  row,
  onModerate,
}: {
  row: AdminChallengeRow;
  onModerate: (row: AdminChallengeRow) => void;
}) {
  return (
    <View style={styles.listRow}>
      <View style={styles.listRowHead}>
        <AppText variant="bodyBold" numberOfLines={1} style={styles.listRowTitle}>
          {row.title}
        </AppText>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Remove challenge ${row.title}`}
          onPress={() => onModerate(row)}
          style={styles.iconBtn}
        >
          <Ionicons name="trash-outline" size={18} color={colors.error} />
        </PressableScale>
      </View>
      <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
        {row.coachName?.trim() || row.coachEmail || row.coachId} · {row.monthKey}
      </AppText>
      <AppText variant="caption" color={colors.textFaint}>
        Target {row.targetDays}d · {row.memberCount} member{row.memberCount === 1 ? '' : 's'}
      </AppText>
    </View>
  );
}

export default function AdminGamificationScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = staffCan(staffPermissions, 'gamification.manage');
  const reauth = useReauth();

  const [searchAccountId, setSearchAccountId] = useState('');
  const [overview, setOverview] = useState<GamificationOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [challenges, setChallenges] = useState<AdminChallengeRow[] | null>(null);
  const [challengesLoading, setChallengesLoading] = useState(true);
  const [challengesError, setChallengesError] = useState<string | null>(null);

  // XP adjustment form.
  const [adjustDelta, setAdjustDelta] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustSuccess, setAdjustSuccess] = useState<string | null>(null);
  const [confirmAdjust, setConfirmAdjust] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<AwardedBadgeRow | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [moderateTarget, setModerateTarget] = useState<AdminChallengeRow | null>(null);
  const [moderateBusy, setModerateBusy] = useState(false);

  const loadOverview = useCallback(
    async (accountId?: string) => {
      if (!token) return;
      setOverviewLoading(true);
      setOverviewError(null);
      try {
        setOverview(await getGamificationOverview(token, accountId));
      } catch (e) {
        setOverviewError(errorLine(toStaffError(e).code));
      } finally {
        setOverviewLoading(false);
      }
    },
    [token],
  );

  const loadChallenges = useCallback(async () => {
    if (!token) return;
    setChallengesLoading(true);
    setChallengesError(null);
    try {
      setChallenges(await listChallengesAdmin(token));
    } catch (e) {
      setChallengesError(errorLine(toStaffError(e).code));
    } finally {
      setChallengesLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (allowed) {
      void loadOverview();
      void loadChallenges();
    }
  }, [allowed, loadOverview, loadChallenges]);

  function runSearch(): void {
    void loadOverview(searchAccountId.trim() || undefined);
  }

  const adjustDeltaNumber = Number(adjustDelta);
  const canAdjust =
    searchAccountId.trim().length > 0 &&
    adjustDelta.trim().length > 0 &&
    Number.isFinite(adjustDeltaNumber) &&
    adjustDeltaNumber !== 0 &&
    adjustReason.trim().length > 0;

  function openAdjustConfirm(): void {
    setAdjustError(null);
    setAdjustSuccess(null);
    if (!searchAccountId.trim()) {
      setAdjustError('Enter an account id to adjust.');
      return;
    }
    if (!Number.isFinite(adjustDeltaNumber) || adjustDeltaNumber === 0) {
      setAdjustError('Enter a non-zero XP amount.');
      return;
    }
    if (!adjustReason.trim()) {
      setAdjustError('A reason is required — it is audited verbatim.');
      return;
    }
    setConfirmAdjust(true);
  }

  async function doAdjust(): Promise<void> {
    if (!token || adjustBusy) return;
    setAdjustBusy(true);
    setAdjustError(null);
    try {
      const result = await adjustMemberXp(
        searchAccountId.trim(),
        adjustDeltaNumber,
        adjustReason.trim(),
        token,
      );
      setAdjustSuccess(
        result.xpTotal !== null
          ? `Applied. New total: ${result.xpTotal.toLocaleString()} XP.`
          : 'Applied.',
      );
      setAdjustDelta('');
      setAdjustReason('');
      await loadOverview(searchAccountId.trim() || undefined);
    } catch (e) {
      setAdjustError(errorLine(toStaffError(e).code));
    } finally {
      setAdjustBusy(false);
    }
  }

  async function doRevoke(): Promise<void> {
    if (!token || !revokeTarget || revokeBusy) return;
    setRevokeBusy(true);
    try {
      await revokeBadge(revokeTarget.id, token);
      setRevokeTarget(null);
      await loadOverview(searchAccountId.trim() || undefined);
    } catch {
      // Surface via the overview error line on next load; the row simply
      // stays and the admin can retry.
      setRevokeTarget(null);
    } finally {
      setRevokeBusy(false);
    }
  }

  async function doModerate(): Promise<void> {
    if (!token || !moderateTarget || moderateBusy) return;
    setModerateBusy(true);
    try {
      await moderateChallenge(moderateTarget.id, token);
      setModerateTarget(null);
      await loadChallenges();
    } catch {
      setModerateTarget(null);
    } finally {
      setModerateBusy(false);
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
            Only a permitted admin can manage gamification.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen scroll keyboardAware>
      <BackRow onBack={goBack} />

      <Animated.View entering={enterUp(0)}>
        <Card style={styles.card}>
          <SectionLabel>Account (optional filter)</SectionLabel>
          <View style={styles.searchRow}>
            <AppTextInput
              value={searchAccountId}
              onChangeText={setSearchAccountId}
              placeholder="Account id"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.searchInput}
              accessibilityLabel="Account id filter"
            />
            <Button label="Search" variant="secondary" onPress={runSearch} style={styles.searchBtn} />
          </View>
          <AppText variant="caption" color={colors.textFaint}>
            Leave blank to see the platform-wide recent feed. Set this to target the XP adjustment
            below.
          </AppText>
        </Card>
      </Animated.View>

      <Animated.View entering={enterUp(1)}>
        <Card style={styles.card}>
          <SectionLabel>Adjust XP</SectionLabel>
          <AppTextInput
            value={adjustDelta}
            onChangeText={setAdjustDelta}
            placeholder="Delta (e.g. -50 or 100)"
            keyboardType="numbers-and-punctuation"
            editable={!adjustBusy}
            accessibilityLabel="XP delta"
          />
          <AppTextInput
            value={adjustReason}
            onChangeText={setAdjustReason}
            placeholder="Reason (required, audited)"
            editable={!adjustBusy}
            accessibilityLabel="Reason for XP adjustment"
          />
          {adjustError ? (
            <AppText variant="caption" color={colors.error}>
              {adjustError}
            </AppText>
          ) : null}
          {adjustSuccess ? (
            <AppText variant="caption" color={colors.success}>
              {adjustSuccess}
            </AppText>
          ) : null}
          <Button
            label={adjustBusy ? 'Applying…' : 'Apply adjustment'}
            onPress={openAdjustConfirm}
            disabled={adjustBusy || !canAdjust}
            loading={adjustBusy}
            style={styles.applyBtn}
          />
        </Card>
      </Animated.View>

      <Animated.View entering={enterUp(2)}>
        <SectionLabel>Recent XP corrections</SectionLabel>
        {overviewLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : overviewError ? (
          <RetryLine message={overviewError} onRetry={() => void loadOverview(searchAccountId.trim() || undefined)} />
        ) : !overview || overview.recentCorrections.length === 0 ? (
          <AppText variant="caption" color={colors.textFaint} style={styles.emptyInline}>
            No corrections recorded.
          </AppText>
        ) : (
          <Card style={styles.listCard}>
            {overview.recentCorrections.map((row) => (
              <CorrectionRow key={row.id} row={row} />
            ))}
          </Card>
        )}
      </Animated.View>

      <Animated.View entering={enterUp(3)}>
        <SectionLabel>Recent awarded badges</SectionLabel>
        {overviewLoading ? null : !overview || overview.recentBadges.length === 0 ? (
          <AppText variant="caption" color={colors.textFaint} style={styles.emptyInline}>
            No badges awarded.
          </AppText>
        ) : (
          <Card style={styles.listCard}>
            {overview.recentBadges.map((row) => (
              <BadgeRow key={row.id} row={row} onRevoke={setRevokeTarget} />
            ))}
          </Card>
        )}
      </Animated.View>

      <Animated.View entering={enterUp(4)}>
        <SectionLabel>Coach challenges</SectionLabel>
        {challengesLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : challengesError ? (
          <RetryLine message={challengesError} onRetry={() => void loadChallenges()} />
        ) : !challenges || challenges.length === 0 ? (
          <EmptyState icon="trophy" title="No challenges" body="Coach challenges appear here for moderation." />
        ) : (
          <Card style={styles.listCard}>
            {challenges.map((row) => (
              <ChallengeRow key={row.id} row={row} onModerate={setModerateTarget} />
            ))}
          </Card>
        )}
      </Animated.View>

      <ConfirmDialog
        visible={confirmAdjust}
        title="Apply this XP adjustment?"
        message={`${adjustDeltaNumber > 0 ? '+' : ''}${Number.isFinite(adjustDeltaNumber) ? adjustDeltaNumber.toLocaleString() : adjustDelta} XP to ${searchAccountId.trim()}. Reason: "${adjustReason.trim()}".`}
        confirmLabel="Apply"
        cancelLabel="Cancel"
        onConfirm={() => {
          setConfirmAdjust(false);
          reauth.guard(() => void doAdjust());
        }}
        onCancel={() => setConfirmAdjust(false)}
      />

      <ConfirmDialog
        visible={revokeTarget !== null}
        title="Revoke this badge?"
        message={
          revokeTarget
            ? `Removes "${revokeTarget.badgeName || revokeTarget.badgeId}" from ${revokeTarget.accountName || revokeTarget.accountEmail}. The member may re-earn it automatically if they still qualify.`
            : undefined
        }
        confirmLabel={revokeBusy ? 'Revoking…' : 'Revoke'}
        cancelLabel="Cancel"
        danger
        onConfirm={() => void doRevoke()}
        onCancel={() => setRevokeTarget(null)}
      />

      <ConfirmDialog
        visible={moderateTarget !== null}
        title="Remove this challenge?"
        message={
          moderateTarget
            ? `Removes "${moderateTarget.title}" and its member participation. Already-earned completion badges are kept.`
            : undefined
        }
        confirmLabel={moderateBusy ? 'Removing…' : 'Remove'}
        cancelLabel="Cancel"
        danger
        onConfirm={() => void doModerate()}
        onCancel={() => setModerateTarget(null)}
      />

      {/* Step-up password prompt for XP adjustment. */}
      <ReauthSheet controller={reauth} />
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
      <ScreenHeader eyebrow="Admin console" title="Gamification" style={styles.header} />
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
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  card: { gap: spacing.sm, marginBottom: spacing.lg },
  searchRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  searchInput: { flex: 1 },
  searchBtn: { paddingHorizontal: spacing.lg },
  applyBtn: { marginTop: spacing.sm },
  emptyInline: { paddingVertical: spacing.sm },
  listCard: { gap: 0, marginBottom: spacing.lg },
  listRow: {
    gap: 2,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surfaceRaised,
  },
  listRowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  listRowTitle: { flex: 1 },
  iconBtn: {
    width: touch.min,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
