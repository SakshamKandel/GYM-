import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Share, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  Chip,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  Tag,
} from '../../../components/ui';
import {
  exportCsvToFile,
  getAudit,
  type AuditEntry,
  toStaffError,
} from '../../../features/staff/api';
import { replaceStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * P1-10 CSV export contract: exportCsvToFile(kind, token) => Promise<string>
 * (M2 owns features/staff/api.ts — see the fuller note in members.tsx) downloads
 * the CSV straight to a local file and returns its `file://` URI — a short,
 * constant-size string, unlike the CSV content itself. No expo-sharing
 * dependency exists in this app, so the file goes through RN's built-in Share
 * sheet (which attaches it via `url` on iOS); the fallback block below shows
 * the on-device path as selectable text (never the CSV content — that would
 * risk the same crash/freeze this fix removes).
 */
async function shareFile(uri: string): Promise<void> {
  try {
    await Share.share({ url: uri });
  } catch {
    // Share sheet dismissed/unavailable — the file stays on-device; its path
    // stays visible in the fallback block as the copy-path fallback.
  }
}

/**
 * Admin · Audit trail (super_admin + main_admin).
 *
 * Keyset-paginated audit log (getAudit) — newest first, showing time, actor,
 * action and target. A row of quick action filters narrows the feed; the raw
 * filter re-runs from page one. "Load more" appends the next cursor page.
 * Gated: sub-roles see a locked notice, never the data.
 *
 * Block language (REVAMP-BRIEF): back row → ScreenHeader → pill filter chips →
 * charcoal entry rows separated by gaps (no hairline dividers, no borders).
 */

/**
 * One-tap filter chips. `getAudit`'s `action` param is an EXACT match against
 * `audit_log.action` (server: `eq(auditLog.action, action)`, not a prefix/
 * substring test) — so each chip must send one real, fully-qualified action
 * string a `logAudit(...)` call site actually writes, not a category guess.
 *
 * Defect F5: the original list only covered the pre-scale-up actions and
 * silently dropped every payment/promo/pricing/wallet/coach-tier/support/
 * content-mutation/roles-revoke/account-reactivate action the scale-up wave
 * added — an admin filtering for "Payments approved" saw an empty feed with
 * no hint why. Extended to the full existing action-string set (sourced from
 * `logAudit(...)` call sites across apps/web/src) PLUS contract §4.12's new
 * strings (`staff.login`, `staff.logout`, `coach.offboard`, `payment.refund`,
 * `broadcast.send`, `promo.grant.expire`) that WP1/WP2/WP6 land in parallel —
 * action strings are a FROZEN, stable contract so these chips are safe to
 * ship ahead of those routes.
 *
 * (stale-chips follow-up, WP-12): re-audited against every LIVE
 * `logAudit(...)` call site again for the v1.0.2 wave — the marketplace/gym/
 * catalog verticals that landed since F5 (meal-delivery payments, the gyms
 * directory, the plan-video catalog, coach-profile edits, member identity
 * edits) had NO chip at all, so an admin filtering audit for e.g. a meal
 * refund saw an empty feed with no indication the action even exists here.
 */
const ACTION_FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'subscription.override', label: 'Tier changes' },
  { key: 'coach.assign', label: 'Coach assigned' },
  { key: 'coach.unassign', label: 'Coach unassigned' },
  { key: 'coach.offboard', label: 'Coach offboarded' },
  { key: 'coach.update', label: 'Coach profile edited' },
  { key: 'coach.application.approve', label: 'Applications approved' },
  { key: 'coach.application.reject', label: 'Applications rejected' },
  { key: 'coach.tier.change', label: 'Coach tier approved' },
  { key: 'coach.tier.reject', label: 'Coach tier rejected' },
  { key: 'roles.grant', label: 'Roles granted' },
  { key: 'roles.revoke', label: 'Roles revoked' },
  { key: 'staff.login', label: 'Staff sign-ins' },
  { key: 'staff.logout', label: 'Staff sign-outs' },
  { key: 'account.suspend', label: 'Suspensions' },
  { key: 'account.reactivate', label: 'Reactivations' },
  { key: 'member.identity_update', label: 'Member identity edited' },
  { key: 'content.video.create', label: 'Videos added' },
  { key: 'content.video.update', label: 'Videos updated' },
  { key: 'content.video.delete', label: 'Videos removed' },
  { key: 'catalog.plan.create', label: 'Catalog plan added' },
  { key: 'catalog.plan.delete', label: 'Catalog plan removed' },
  { key: 'catalog.exercise.delete', label: 'Catalog exercise removed' },
  { key: 'payment.approve', label: 'Payments approved' },
  { key: 'payment.reject', label: 'Payments rejected' },
  { key: 'payment.refund', label: 'Payments refunded' },
  { key: 'meal_payment.approve', label: 'Meal payments approved' },
  { key: 'meal_payment.reject', label: 'Meal payments rejected' },
  { key: 'meal_payment.refund', label: 'Meal payments refunded' },
  { key: 'promo.create', label: 'Promo created' },
  { key: 'promo.update', label: 'Promo updated' },
  { key: 'promo.grant.expire', label: 'Promo grants expired' },
  { key: 'pricing.update', label: 'Pricing updated' },
  { key: 'wallet.adjust', label: 'Wallet adjustments' },
  { key: 'support.reply', label: 'Support replies' },
  { key: 'gym.update', label: 'Gym updated' },
  { key: 'broadcast.send', label: 'Broadcasts sent' },
];

/** Short relative time ("3m", "2h", "5d") with an absolute fallback. */
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

/** Turn "member.tier.override" into "Member tier override". */
function humanAction(action: string): string {
  const words = action.replace(/[._]/g, ' ').trim();
  if (!words) return action;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function AuditScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const canViewAudit = staffCan(staffPermissions, 'audit.read');

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // P1-10: CSV export of the audit trail, shared via the OS share sheet —
  // with a selectable-link fallback sheet when the share sheet is
  // unavailable or dismissed.
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvLinkOpen, setCsvLinkOpen] = useState(false);
  const [csvLink, setCsvLink] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  async function exportAuditCsv(): Promise<void> {
    if (!token || csvBusy) return;
    setCsvBusy(true);
    setCsvError(null);
    try {
      const uri = await exportCsvToFile('audit', token);
      setCsvLink(uri);
      setCsvLinkOpen(true);
      await shareFile(uri);
    } catch (err) {
      setCsvError(toStaffError(err).code === 'forbidden' ? "You don't have export access." : "Couldn't export the audit log.");
    } finally {
      setCsvBusy(false);
    }
  }

  /** Load page one for the current filter (replaces the list). */
  const load = useCallback(
    async (action: string) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const page = await getAudit(token, action ? { action } : {});
        setEntries(page.entries);
        setCursor(page.nextCursor);
      } catch (err) {
        setError(toStaffError(err).code);
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  /** Append the next keyset page. */
  const loadMore = useCallback(async () => {
    if (!token || !cursor || loadingMore) return;
    setLoadingMore(true);
    // Clear a previous failure on retry (G9): otherwise a transient error
    // permanently replaces "Load more" with a stale failure line even after
    // a subsequent call succeeds.
    setError(null);
    try {
      const page = await getAudit(token, {
        cursor,
        ...(filter ? { action: filter } : {}),
      });
      setEntries((prev) => [...prev, ...page.entries]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(toStaffError(err).code);
    } finally {
      setLoadingMore(false);
    }
  }, [token, cursor, filter, loadingMore]);

  useEffect(() => {
    if (canViewAudit) void load('');
  }, [canViewAudit, load]);

  function pickFilter(action: string): void {
    setFilter(action);
    void load(action);
  }

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replaceStaff(STAFF_ROUTES.hub);
  }

  if (!canViewAudit) {
    return (
      <Screen>
        <BackRow title="Audit trail" onBack={goBack} />
        <Animated.View entering={enterUp(0)} style={styles.locked}>
          <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textFaint}>
            Only a super admin or main admin can view the audit trail.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <BackRow
        title="Audit trail"
        onBack={goBack}
        action={
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Export audit log as CSV"
            accessibilityState={{ disabled: csvBusy }}
            disabled={csvBusy}
            onPress={() => void exportAuditCsv()}
            style={styles.headerActionBtn}
          >
            {csvBusy ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Ionicons name="download-outline" size={20} color={colors.text} />
            )}
          </PressableScale>
        }
      />

      {csvError ? (
        <AppText variant="caption" color={colors.error} style={styles.csvErrorText}>
          {csvError}
        </AppText>
      ) : null}

      {/* Copy-path fallback: no expo-sharing dependency exists in this app,
          so the share sheet is RN's built-in Share; if it's dismissed or
          unavailable the on-device file path stays here as selectable text
          (the CSV itself was streamed straight to disk, never held in memory
          as one giant string, and never rendered here). */}
      {csvLinkOpen && csvLink ? (
        <View style={styles.csvLinkBlock}>
          <AppText variant="caption" color={colors.textDim}>
            Export saved on this device (long-press to copy the file path if the share sheet
            didn&apos;t open):
          </AppText>
          <Text selectable style={styles.selectableLink}>
            {csvLink}
          </Text>
          <Button label="Dismiss" variant="secondary" onPress={() => setCsvLinkOpen(false)} />
        </View>
      ) : null}

      <Animated.View entering={enterDown()} style={styles.filterRow}>
        {ACTION_FILTERS.map((f) => (
          <Chip
            key={f.key || 'all'}
            label={f.label}
            selected={filter === f.key}
            onPress={() => pickFilter(f.key)}
          />
        ))}
      </Animated.View>

      {loading && entries.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}

      {error && entries.length === 0 ? (
        <RetryLine
          label="Couldn't load the audit trail"
          onRetry={() => void load(filter)}
        />
      ) : null}

      {!loading && !error && entries.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.hint}>
          No audit entries for this filter.
        </AppText>
      ) : null}

      {entries.map((e, i) => (
        <Animated.View key={e.id} entering={enterUp(Math.min(i, 6))}>
          <View style={styles.entry}>
            <View style={styles.entryHead}>
              <Tag label={humanAction(e.action)} variant="dim" />
              <AppText variant="caption" color={colors.textFaint}>
                {relativeTime(e.createdAt)}
              </AppText>
            </View>
            <AppText variant="body" numberOfLines={1}>
              {e.actorEmail ?? 'System / deleted actor'}
            </AppText>
            <AppText variant="caption" numberOfLines={1}>
              {e.targetType}
              {e.targetId ? ` · ${e.targetId}` : ''}
            </AppText>
          </View>
        </Animated.View>
      ))}

      {error && entries.length > 0 ? (
        <RetryLine label="Couldn't load more" onRetry={() => void loadMore()} />
      ) : null}

      {cursor && !error ? (
        <Button
          label="Load more"
          variant="secondary"
          onPress={() => void loadMore()}
          loading={loadingMore}
          style={styles.loadMore}
        />
      ) : null}
    </Screen>
  );
}

/** Shared back row + revamp header (no native header — matches the app). */
function BackRow({
  title,
  onBack,
  action,
}: {
  title: string;
  onBack: () => void;
  action?: ReactNode;
}) {
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
      <ScreenHeader eyebrow="Admin console" title={title} style={styles.header} action={action} />
    </>
  );
}

/** Quiet inline retry line for a failed fetch. */
function RetryLine({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${label}. Tap to retry.`}
      onPress={onRetry}
      style={styles.retryLine}
    >
      <Ionicons name="refresh" size={15} color={colors.textDim} />
      <AppText variant="caption" color={colors.textDim}>
        {label} · tap to retry
      </AppText>
    </PressableScale>
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
  headerActionBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  csvErrorText: { marginBottom: spacing.sm },
  csvLinkBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  selectableLink: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  locked: {
    marginTop: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  hint: { marginTop: spacing.md },
  // Charcoal entry row (brief §11c): gaps between rows replace hairlines.
  entry: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: 4,
    marginBottom: spacing.sm,
  },
  entryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  retryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  loadMore: { marginTop: spacing.lg },
});
