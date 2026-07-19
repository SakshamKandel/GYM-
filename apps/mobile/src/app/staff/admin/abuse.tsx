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
  Chip,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Sheet,
  StatBlock,
  Tag,
} from '../../../components/ui';
import {
  getAbuseDashboard,
  resetTrial,
  toStaffError,
  type AbuseDashboard,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { replaceStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Abuse — referral + trial-usage dashboard, plus a trial reset tool
 * (ARCHITECTURE-REVIEW §6 NEXT, mobile parity B; gated on
 * `subscription.override` — not a new permission key, mirrors the nav hub's
 * Abuse row). Resetting a trial is destructive (it erases the account's
 * trial history, letting it start fresh) so it sits behind a typed-confirm
 * sheet — the same pattern staff.tsx uses for coach offboarding — rather
 * than a plain yes/no dialog.
 */

type TrialTier = 'silver' | 'gold' | 'elite';
const TRIAL_TIERS: TrialTier[] = ['silver', 'gold', 'elite'];
const RESET_WORD = 'RESET';

function errorLine(code: StaffErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired — sign in again.';
    case 'forbidden':
      return "You don't have permission to view abuse signals.";
    case 'not_found':
      return 'No account with that id.';
    case 'invalid':
      return 'That account id looks wrong. Check it and try again.';
    default:
      return "Couldn't reach the server. Check your connection and retry.";
  }
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
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

function whoLabel(row: { displayName: string; email: string }): string {
  return row.displayName.trim() || row.email || 'Unknown account';
}

// ── Reset-trial panel ─────────────────────────────────────────────

function ResetTrialPanel({
  token,
  onReset,
}: {
  token: string;
  onReset: () => Promise<void>;
}) {
  const [accountId, setAccountId] = useState('');
  const [tier, setTier] = useState<TrialTier | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [typedConfirm, setTypedConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const confirmMatches = typedConfirm.trim().toUpperCase() === RESET_WORD;

  function openConfirm(): void {
    if (!accountId.trim()) {
      setError('Enter an account id first.');
      return;
    }
    setError(null);
    setResult(null);
    setTypedConfirm('');
    setSheetOpen(true);
  }

  async function submit(): Promise<void> {
    if (!confirmMatches || saving) return;
    setSaving(true);
    setError(null);
    try {
      const cleared = await resetTrial(accountId.trim(), tier ?? undefined, token);
      setSheetOpen(false);
      setResult(
        cleared.length > 0
          ? `Cleared trial history for: ${cleared.join(', ')}.`
          : 'That account had no trial history to clear.',
      );
      setAccountId('');
      setTier(null);
      await onReset();
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
      setSheetOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card style={styles.resetCard}>
      <AppText variant="bodyBold">Reset trial usage</AppText>
      <AppText variant="caption" color={colors.textDim}>
        Clears the account’s trial-usage record so it can start a fresh trial. Leave the tier
        unset to clear every tier.
      </AppText>

      <AppTextInput
        value={accountId}
        onChangeText={setAccountId}
        placeholder="Account id"
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Account id"
      />

      <View style={styles.chipRow}>
        <Chip label="All tiers" selected={tier === null} onPress={() => setTier(null)} />
        {TRIAL_TIERS.map((t) => (
          <Chip key={t} label={t} selected={tier === t} onPress={() => setTier(t)} />
        ))}
      </View>

      <Button label="Reset" variant="danger" onPress={openConfirm} style={styles.resetBtn} />

      {error ? (
        <AppText variant="caption" color={colors.error}>
          {error}
        </AppText>
      ) : result ? (
        <AppText variant="caption" color={colors.success}>
          {result}
        </AppText>
      ) : null}

      <Sheet
        visible={sheetOpen}
        onClose={() => (saving ? undefined : setSheetOpen(false))}
        title="Reset trial usage?"
      >
        <View style={styles.sheetBody}>
          <AppText variant="body" color={colors.textDim}>
            This permanently erases {tier ? `the ${tier} trial record` : 'every trial record'} for
            account {accountId.trim()}. This can’t be undone.
          </AppText>
          <AppText variant="caption" color={colors.textDim} style={styles.typedHint}>
            Type {RESET_WORD} to confirm.
          </AppText>
          <AppTextInput
            value={typedConfirm}
            onChangeText={setTypedConfirm}
            placeholder={RESET_WORD}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!saving}
            accessibilityLabel={`Type ${RESET_WORD} to confirm`}
          />
          <View style={styles.sheetActions}>
            <Button
              label="Cancel"
              variant="secondary"
              disabled={saving}
              onPress={() => setSheetOpen(false)}
              style={styles.sheetBtn}
            />
            <Button
              label={saving ? 'Resetting…' : 'Reset'}
              variant="danger"
              loading={saving}
              disabled={saving || !confirmMatches}
              onPress={() => void submit()}
              style={styles.sheetBtn}
            />
          </View>
        </View>
      </Sheet>
    </Card>
  );
}

// ── Screen ───────────────────────────────────────────────────────

export default function AdminAbuseScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = staffCan(staffPermissions, 'subscription.override');

  const [dashboard, setDashboard] = useState<AbuseDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setDashboard(await getAbuseDashboard(token));
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replaceStaff(STAFF_ROUTES.adminHome);
  }

  if (!allowed || !token) {
    return (
      <Screen>
        <BackRow onBack={goBack} />
        <Animated.View entering={enterUp(0)} style={styles.locked}>
          <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textFaint}>
            Only a member admin, main admin or super admin can review abuse signals.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen scroll keyboardAware>
      <BackRow onBack={goBack} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.retryWrap}>
          <RetryLine message={error} onRetry={() => void load()} />
        </View>
      ) : dashboard ? (
        <View style={styles.body}>
          <ResetTrialPanel token={token} onReset={load} />

          <SectionLabel>Referrals</SectionLabel>
          <Card style={styles.statCard}>
            <View style={styles.statGrid}>
              <StatBlock label="Total" value={dashboard.referrals.total} size="stat" style={styles.statCell} />
              <StatBlock label="Pending" value={dashboard.referrals.pending} size="stat" style={styles.statCell} />
              <StatBlock label="Joined" value={dashboard.referrals.joined} size="stat" style={styles.statCell} />
              <StatBlock label="Rewarded" value={dashboard.referrals.rewarded} size="stat" style={styles.statCell} />
            </View>
          </Card>

          <AppText variant="label" style={styles.subLabel}>
            Top referrers
          </AppText>
          {dashboard.referrals.topReferrers.length === 0 ? (
            <AppText variant="caption" color={colors.textFaint} style={styles.empty}>
              No referrals yet.
            </AppText>
          ) : (
            dashboard.referrals.topReferrers.map((r, i) => (
              <Animated.View key={r.referrerId} entering={enterUp(i)}>
                <View style={styles.listRow}>
                  <AppText variant="body" numberOfLines={1} style={styles.listRowText}>
                    {whoLabel(r)}
                  </AppText>
                  <AppText variant="caption" color={colors.textFaint} tabular>
                    {r.totalCount} invite{r.totalCount === 1 ? '' : 's'} · {r.rewardedCount} rewarded
                  </AppText>
                </View>
              </Animated.View>
            ))
          )}

          <SectionLabel>Trials</SectionLabel>
          <Card style={styles.statCard}>
            <View style={styles.statGrid}>
              <StatBlock label="Total" value={dashboard.trials.total} size="stat" style={styles.statCell} />
              <StatBlock label="Silver" value={dashboard.trials.byTier.silver} size="stat" style={styles.statCell} />
              <StatBlock label="Gold" value={dashboard.trials.byTier.gold} size="stat" style={styles.statCell} />
              <StatBlock label="Elite" value={dashboard.trials.byTier.elite} size="stat" style={styles.statCell} />
            </View>
          </Card>

          <AppText variant="label" style={styles.subLabel}>
            Multi-tier trial accounts
          </AppText>
          {dashboard.trials.multiTrialAccounts.length === 0 ? (
            <AppText variant="caption" color={colors.textFaint} style={styles.empty}>
              No account has trialed more than one tier.
            </AppText>
          ) : (
            dashboard.trials.multiTrialAccounts.map((a, i) => (
              <Animated.View key={a.accountId} entering={enterUp(i)}>
                <View style={styles.listRow}>
                  <AppText variant="body" numberOfLines={1} style={styles.listRowText}>
                    {whoLabel(a)}
                  </AppText>
                  <View style={styles.tagRow}>
                    {a.tiersTrialed.map((t) => (
                      <Tag key={t} label={t} variant="outline" color={colors.warning} />
                    ))}
                  </View>
                </View>
              </Animated.View>
            ))
          )}

          <AppText variant="label" style={styles.subLabel}>
            Recent trial starts
          </AppText>
          {dashboard.trials.recentTrials.length === 0 ? (
            <AppText variant="caption" color={colors.textFaint} style={styles.empty}>
              No trials started yet.
            </AppText>
          ) : (
            dashboard.trials.recentTrials.map((t, i) => (
              <Animated.View key={`${t.accountId}-${t.tier}`} entering={enterUp(i)}>
                <View style={styles.listRow}>
                  <View style={styles.listRowText}>
                    <AppText variant="body" numberOfLines={1}>
                      {whoLabel(t)}
                    </AppText>
                    <AppText variant="caption" color={colors.textFaint}>
                      {fmtDate(t.startedAt)} → {fmtDate(t.expiresAt)}
                    </AppText>
                  </View>
                  <Tag label={t.tier} variant="outline" />
                </View>
              </Animated.View>
            ))
          )}

          {dashboard.limitations.length > 0 ? (
            <View style={styles.limitationsBox}>
              {dashboard.limitations.map((line, i) => (
                <AppText key={i} variant="caption" color={colors.textFaint}>
                  · {line}
                </AppText>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
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
      <ScreenHeader eyebrow="Admin console" title="Abuse" style={styles.header} />
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
  retryWrap: { marginTop: spacing.sm },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  body: { gap: spacing.sm },
  resetCard: { gap: spacing.md, marginBottom: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  resetBtn: { alignSelf: 'flex-start', paddingHorizontal: spacing.xl },
  sheetBody: { gap: spacing.md, paddingBottom: spacing.md },
  typedHint: { marginTop: spacing.xs },
  sheetActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  sheetBtn: { flex: 1 },
  statCard: { marginBottom: spacing.sm },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.lg },
  statCell: { width: '50%' },
  subLabel: { marginTop: spacing.md, marginBottom: spacing.xs },
  empty: { paddingVertical: spacing.sm },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 56,
  },
  listRowText: { flex: 1, gap: 2, minWidth: 0 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  limitationsBox: {
    marginTop: spacing.md,
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
});
