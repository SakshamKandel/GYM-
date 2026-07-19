import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch, type as typeTokens } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  ConfirmDialog,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Tag,
} from '../../../components/ui';
import { ALL_PERMISSIONS, canManageRole, type Permission } from '@gym/shared';
import {
  clearPermissionOverride,
  getStaff,
  getStaffPermissions,
  setPermissionOverride,
  type StaffErrorCode,
  type StaffPermissionRow,
  type StaffPermissions,
  type StaffRole,
  type StaffRow,
  toStaffError,
} from '../../../features/staff/api';
import { replaceStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { ReauthSheet, useReauth } from '../../../features/staff/ReauthGate';
import { ROLE_LABEL } from '../../../features/staff/roles';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Permissions — per-account permission-override editor
 * (`permissions.override`; super_admin + main_admin only).
 *
 * Mirrors the web `StaffManager` PermissionsModal semantics EXACTLY (the source
 * of truth for this surface):
 *  - Effective set is composed as `preset + grants − denials`; every key shows
 *    its provenance (preset On/Off, the explicit override, and the resulting
 *    effective state) so what the console shows can never drift from what the
 *    API enforces.
 *  - Each change is ONE single-key PUT that returns the fresh, fully-merged
 *    payload — the panel adopts it wholesale, never optimistically.
 *  - super_admin / main_admin targets are the C-A safety floor: overrides are
 *    ignored server-side and the editor renders read-only (`payload.locked`).
 *  - super_admin rows are never a target at all (mirrors the web, which hides
 *    its Permissions button for them); partner accounts are excluded from the
 *    roster (a partner may only ever hold its two delivery permissions, and the
 *    server refuses any other override against it).
 *  - The caller can only inspect/adjust accounts they OUT-RANK (canManageRole),
 *    mirroring the route's requireOutranks; their own row is non-selectable
 *    (the route rejects self-targeting).
 *
 * Every mutation is doubly gated on the CLIENT — a branded ConfirmDialog naming
 * the exact change, then the shared password step-up (ReauthGate, 5-min window).
 * Neither is the real guard: the route independently re-checks the permission,
 * rank, self-target and the super/main floor, and audits every change
 * (`permissions.override`) — the friction here just stops a fat-finger.
 */

/**
 * Human copy per permission key, keyed by the exact @gym/shared literal — a
 * verbatim mirror of the web `PERMISSION_META` map so both consoles describe a
 * capability identically. Display only; the effective/override truth always
 * comes from the server payload. `satisfies Record<Permission, …>` keeps this
 * exhaustive — a newly added permission breaks the type until copy is supplied.
 */
const PERMISSION_META = {
  'members.read': { label: 'Read members', desc: 'View the member directory.' },
  'members.suspend': {
    label: 'Suspend members',
    desc: 'Suspend or reactivate member accounts.',
  },
  'coach.assign': { label: 'Assign coaches', desc: 'Assign a coach to a member.' },
  'subscription.override': {
    label: 'Override subscription',
    desc: "Change a member's subscription tier.",
  },
  'audit.read': { label: 'Read audit log', desc: 'View the admin audit trail.' },
  'roles.grant': {
    label: 'Manage staff roles',
    desc: 'Grant, change, or revoke staff roles.',
  },
  'support.thread.read': {
    label: 'Read support threads',
    desc: 'List and read member support tickets.',
  },
  'support.thread.reply': {
    label: 'Reply to support',
    desc: 'Reply into a support thread.',
  },
  'coach.application.review': {
    label: 'Review coach applications',
    desc: 'Approve/reject applications and tier requests.',
  },
  'payments.review': {
    label: 'Review payments',
    desc: 'Approve, reject, or refund payment requests.',
  },
  'promo.manage': { label: 'Manage promo codes', desc: 'Create and toggle promo codes.' },
  'pricing.manage': { label: 'Manage pricing', desc: 'Edit regional tier prices.' },
  'wallet.manage': {
    label: 'Manage wallets',
    desc: 'View wallets, record adjustments and payouts.',
  },
  'content.manage': {
    label: 'Manage content',
    desc: 'Org-wide plan-video CRUD (any row).',
  },
  'content.video.own': {
    label: 'Manage own videos',
    desc: 'CRUD only videos this coach created.',
  },
  'coach.message.user': {
    label: 'Message clients',
    desc: "Reply into an assigned client's thread.",
  },
  'coach.user.read': {
    label: 'Read clients',
    desc: "Read assigned clients' threads and profile.",
  },
  'coach.wallet.read': {
    label: 'Read own wallet',
    desc: 'A coach reading their own wallet balance.',
  },
  'client.tier_grant': {
    label: 'Grant client tiers',
    desc: 'Coach-initiated client tier grants (off by default).',
  },
  'broadcast.send': {
    label: 'Send broadcasts',
    desc: 'Send announcements and push broadcasts.',
  },
  'members.manage_credentials': {
    label: 'Manage credentials',
    desc: 'Password reset, force sign-out, identity fixes.',
  },
  'payouts.review': {
    label: 'Review payouts',
    desc: 'Approve, reject, or mark coach payouts paid.',
  },
  'analytics.read': {
    label: 'Read analytics',
    desc: 'View revenue, churn, and coach-performance analytics.',
  },
  'permissions.override': {
    label: 'Manage permissions',
    desc: 'Grant or strip per-account permission overrides.',
  },
  'moderation.manage': {
    label: 'Moderate content',
    desc: 'Custom foods, progress photos, milestones.',
  },
  'catalog.manage': {
    label: 'Manage catalog',
    desc: 'CRUD the exercises and plans catalog.',
  },
  'gamification.manage': {
    label: 'Manage gamification',
    desc: 'XP corrections, badge audit/revoke, challenge moderation.',
  },
  'meals.own': {
    label: 'Manage own meals',
    desc: "Partner-only: CRUD this restaurant's own menu and fulfill its orders.",
  },
  'orders.fulfill': {
    label: 'Fulfill orders',
    desc: 'Partner-only: advance a meal order through its delivery states.',
  },
  'partners.manage': {
    label: 'Manage meal partners',
    desc: 'Create, edit, and deactivate restaurant partner accounts.',
  },
  'orders.review': {
    label: 'Review meal orders',
    desc: "Oversight and override across every partner's orders.",
  },
  'gyms.manage': {
    label: 'Manage gyms',
    desc: 'CRUD the nearby-gyms directory and its photos.',
  },
} satisfies Record<Permission, { label: string; desc: string }>;

/** Friendly line for a failed permissions GET/PUT — branches on the API code. */
function permFailLine(code: StaffErrorCode): string {
  switch (code) {
    case 'forbidden':
      // The route returns 403 `cannot_modify_super_admin` for a super/main
      // target and 403 `partner_override_forbidden` for a partner target; both
      // land here as the generic forbidden code.
      return "That account's permissions can't be overridden.";
    case 'insufficient_rank':
      return 'Only a super admin can manage this account.';
    case 'cannot_target_self':
      return "You can't change your own permissions.";
    case 'invalid':
      return 'That permission is not recognised.';
    case 'not_found':
      return 'That account is no longer staff.';
    case 'unauthorized':
      return 'Your session expired. Sign in again.';
    case 'rate_limited':
      return 'Too many attempts — wait a minute and try again.';
    default:
      return "Couldn't reach the server. Try again.";
  }
}

/** A three-way override mode derived from a row's explicit override. */
type Mode = 'default' | 'allow' | 'deny';

function modeOf(row: StaffPermissionRow): Mode {
  return row.override === 'allow' ? 'allow' : row.override === 'deny' ? 'deny' : 'default';
}

/** The pending change awaiting ConfirmDialog + step-up before it's written. */
interface PendingChange {
  perm: Permission;
  /** true = grant, false = deny, null = clear (revert to preset). */
  allow: boolean | null;
  label: string;
}

export default function PermissionsScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const staffRole = useAuth((s) => s.staffRole);
  const myAccountId = useAuth((s) => s.user?.id ?? null);
  const canOverride = staffCan(staffPermissions, 'permissions.override');
  // Step-up: an override write is a security-sensitive action — gate every one
  // behind a fresh password re-entry (5-min in-memory window shared console-wide).
  const reauth = useReauth();

  /** May the caller inspect/adjust a row holding `role`? Mirrors requireOutranks. */
  const canManage = useCallback(
    (role: StaffRole): boolean => staffRole !== null && canManageRole(staffRole, role),
    [staffRole],
  );

  // ── Roster ────────────────────────────────────────────────
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);

  const loadStaff = useCallback(async () => {
    if (!token) return;
    setRosterLoading(true);
    setRosterError(null);
    try {
      setStaff(await getStaff(token));
    } catch (err) {
      setRosterError(permFailLine(toStaffError(err).code));
    } finally {
      setRosterLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (canOverride) void loadStaff();
  }, [canOverride, loadStaff]);

  // Partners are never override targets (server refuses any non-delivery key on
  // them); show only the accounts this surface can actually act on or view.
  const roster = useMemo(
    () => (staff ?? []).filter((s) => s.role !== 'partner'),
    [staff],
  );

  // ── Selected account (master → detail) ────────────────────
  const [selected, setSelected] = useState<StaffRow | null>(null);
  const [payload, setPayload] = useState<StaffPermissions | null>(null);
  const [permLoading, setPermLoading] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<Permission | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);

  const selectedId = selected?.accountId ?? null;

  const loadPermissions = useCallback(
    async (accountId: string) => {
      if (!token) return;
      setPermLoading(true);
      setPermError(null);
      try {
        setPayload(await getStaffPermissions(accountId, token));
      } catch (err) {
        setPermError(permFailLine(toStaffError(err).code));
        setPayload(null);
      } finally {
        setPermLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (selectedId) void loadPermissions(selectedId);
  }, [selectedId, loadPermissions]);

  function openAccount(row: StaffRow): void {
    setSelected(row);
    setPayload(null);
    setPermError(null);
    setBanner(null);
    setBusyKey(null);
  }

  function backToRoster(): void {
    setSelected(null);
    setPayload(null);
    setPermError(null);
    setBanner(null);
    setBusyKey(null);
    setPending(null);
  }

  /** A tap on a segment that differs from the current mode → confirm first. */
  function requestChange(row: StaffPermissionRow, next: Mode): void {
    if (modeOf(row) === next) return; // no-op tap on the active segment
    // `row.key` is a validated permission string off the wire (the route only
    // ever returns ALL_PERMISSIONS keys); the zod schema widens it to string.
    const perm = row.key as Permission;
    const label =
      (PERMISSION_META as Record<string, { label: string; desc: string }>)[row.key]?.label ??
      row.key;
    const allow = next === 'allow' ? true : next === 'deny' ? false : null;
    setPending({ perm, allow, label });
  }

  const writeChange = useCallback(
    async (change: PendingChange) => {
      if (!token || !selectedId) return;
      setBusyKey(change.perm);
      setPermError(null);
      setBanner(null);
      try {
        const fresh =
          change.allow === null
            ? await clearPermissionOverride(selectedId, change.perm, token)
            : await setPermissionOverride(selectedId, change.perm, change.allow, token);
        // Adopt the fully-merged payload wholesale — the panel can never
        // disagree with what enforcement will do.
        setPayload(fresh);
        setBanner(
          change.allow === null
            ? `Reset "${change.label}" to the role default.`
            : change.allow
              ? `Granted "${change.label}".`
              : `Denied "${change.label}".`,
        );
      } catch (err) {
        setPermError(permFailLine(toStaffError(err).code));
      } finally {
        setBusyKey(null);
      }
    },
    [token, selectedId],
  );

  function confirmPending(): void {
    const change = pending;
    setPending(null);
    if (change) reauth.guard(() => void writeChange(change));
  }

  function goBack(): void {
    if (selected) {
      backToRoster();
      return;
    }
    if (router.canGoBack()) router.back();
    else replaceStaff(STAFF_ROUTES.hub);
  }

  // ── Gate ──────────────────────────────────────────────────
  if (!canOverride) {
    return (
      <Screen>
        <BackRow onBack={goBack} />
        <Animated.View entering={enterUp(0)} style={styles.locked}>
          <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textFaint}>
            Only a super admin or main admin can manage per-account permissions.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  const overrideCount = payload?.permissions.filter((p) => p.override != null).length ?? 0;
  const pendingRoleLabel = selected ? ROLE_LABEL[selected.role] : '';

  return (
    <Screen scroll>
      <BackRow onBack={goBack} />
      <ScreenHeader eyebrow="Admin console" title="Permissions" style={styles.header} />

      {banner ? (
        <Animated.View entering={enterUp(0)} style={styles.banner}>
          <AppText variant="caption" color={colors.text}>
            {banner}
          </AppText>
        </Animated.View>
      ) : null}

      {selected ? (
        // ── Detail: one account's effective permissions ──────
        <>
          <View style={styles.detailHead}>
            <AppText variant="bodyBold" numberOfLines={1}>
              {selected.coachName || selected.displayName || selected.email}
            </AppText>
            <AppText variant="caption" numberOfLines={1}>
              {selected.email}
            </AppText>
            <View style={styles.detailTags}>
              <Tag label={ROLE_LABEL[selected.role]} variant="dim" />
              {overrideCount > 0 ? (
                <Tag
                  label={`${overrideCount} override${overrideCount === 1 ? '' : 's'}`}
                  variant="filled"
                  color={colors.accent}
                />
              ) : null}
            </View>
            <AppText variant="caption" color={colors.textDim} style={styles.formula}>
              Effective = preset + grants − denials. Every change is recorded in
              the audit log.
            </AppText>
          </View>

          {permLoading && !payload ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : null}

          {permError && !payload ? (
            <RetryLine
              label={permError}
              onRetry={() => selectedId && void loadPermissions(selectedId)}
            />
          ) : null}

          {payload?.locked ? (
            <View style={styles.lockNotice}>
              <Ionicons name="shield-checkmark" size={18} color={colors.textDim} />
              <AppText variant="caption" color={colors.textDim} style={styles.lockNoticeText}>
                A {pendingRoleLabel.toLowerCase()} holds every permission and cannot
                be overridden.
              </AppText>
            </View>
          ) : null}

          {payload
            ? payload.permissions.map((row, i) => (
                <Animated.View key={row.key} entering={enterUp(Math.min(i, 8))}>
                  <PermissionRow
                    row={row}
                    disabled={payload.locked || (busyKey != null && busyKey !== row.key)}
                    busy={busyKey === row.key}
                    onChange={(next) => requestChange(row, next)}
                  />
                </Animated.View>
              ))
            : null}

          {permError && payload ? (
            <AppText variant="caption" color={colors.error} style={styles.inlineError}>
              {permError}
            </AppText>
          ) : null}
        </>
      ) : (
        // ── Master: pick a staff account ─────────────────────
        <>
          <SectionLabel>Staff accounts</SectionLabel>

          {rosterLoading && !staff ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : null}

          {rosterError && !staff ? (
            <RetryLine label={rosterError} onRetry={() => void loadStaff()} />
          ) : null}

          {staff && roster.length === 0 ? (
            <AppText variant="caption" color={colors.textFaint} style={styles.hint}>
              No staff accounts to manage.
            </AppText>
          ) : null}

          {roster.map((s, i) => {
            const isSelf = s.accountId === myAccountId;
            // Mirror the web: a super_admin is never a target, self can't be
            // targeted, and a row the caller does not outrank is locked.
            const blocked = isSelf || s.role === 'super_admin' || !canManage(s.role);
            return (
              <Animated.View key={s.accountId} entering={enterUp(Math.min(i, 8))}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Permissions for ${s.email}`}
                  accessibilityState={{ disabled: blocked }}
                  disabled={blocked}
                  onPress={() => openAccount(s)}
                  style={[styles.staffRow, blocked && styles.rowBlocked]}
                >
                  <View style={styles.staffText}>
                    <AppText variant="bodyBold" numberOfLines={1}>
                      {s.coachName || s.displayName || s.email}
                    </AppText>
                    <AppText variant="caption" numberOfLines={1}>
                      {s.email}
                    </AppText>
                    <View style={styles.detailTags}>
                      <Tag label={ROLE_LABEL[s.role]} variant="dim" />
                      {isSelf ? (
                        <Tag label="You" variant="outline" color={colors.textDim} />
                      ) : null}
                      {!isSelf && blocked ? (
                        <Tag
                          label="Managed by super admin"
                          variant="outline"
                          color={colors.textFaint}
                        />
                      ) : null}
                      {s.status === 'suspended' ? (
                        <Tag label="Suspended" variant="outline" color={colors.warning} />
                      ) : null}
                    </View>
                  </View>
                  <Ionicons
                    name={blocked ? 'lock-closed' : 'chevron-forward'}
                    size={blocked ? 16 : 20}
                    color={colors.textFaint}
                  />
                </PressableScale>
              </Animated.View>
            );
          })}
        </>
      )}

      {/* Per-change confirm — names the exact change before the step-up. */}
      <ConfirmDialog
        visible={pending !== null}
        title={
          pending == null
            ? ''
            : pending.allow === null
              ? 'Reset to default?'
              : pending.allow
                ? 'Grant permission?'
                : 'Deny permission?'
        }
        message={
          pending == null || selected == null
            ? undefined
            : pending.allow === null
              ? `Revert "${pending.label}" to the ${pendingRoleLabel} default for ${selected.email}.`
              : pending.allow
                ? `Grant "${pending.label}" to ${selected.email}, beyond their ${pendingRoleLabel} role.`
                : `Deny "${pending.label}" for ${selected.email}, stripping it from their ${pendingRoleLabel} role.`
        }
        confirmLabel={
          pending?.allow === null ? 'Reset' : pending?.allow ? 'Grant' : 'Deny'
        }
        cancelLabel="Cancel"
        danger={pending?.allow === false}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      />

      {/* Step-up password prompt for every override write. */}
      <ReauthSheet controller={reauth} />
    </Screen>
  );
}

/**
 * One permission line: label + description, an effective On/Off badge, the
 * preset provenance, and a Default / Grant / Deny segmented control. Matches
 * the web `PermissionControl` layout and semantics.
 */
function PermissionRow({
  row,
  disabled,
  busy,
  onChange,
}: {
  row: StaffPermissionRow;
  disabled: boolean;
  busy: boolean;
  onChange: (next: Mode) => void;
}) {
  // Fall back to the raw key so a permission this build predates still renders.
  const meta = (PERMISSION_META as Record<string, { label: string; desc: string }>)[row.key];
  const mode = modeOf(row);
  return (
    <View style={[styles.permRow, row.override != null && styles.permRowOverridden]}>
      <View style={styles.permText}>
        <View style={styles.permTitleRow}>
          <AppText variant="bodyBold" numberOfLines={1} style={styles.permLabel}>
            {meta?.label ?? row.key}
          </AppText>
          {row.effective ? (
            <Tag label="On" variant="filled" color={colors.success} />
          ) : (
            <Tag label="Off" variant="dim" />
          )}
        </View>
        <AppText variant="caption" color={colors.textDim}>
          {meta?.desc ?? row.key} · preset {row.preset ? 'grants' : 'denies'} this
        </AppText>
      </View>
      <View
        style={styles.seg}
        accessibilityRole="radiogroup"
        accessibilityLabel={`${meta?.label ?? row.key} override`}
      >
        <SegBtn
          label="Default"
          active={mode === 'default'}
          activeBg={colors.surfaceRaised}
          activeText={colors.text}
          disabled={disabled}
          busy={busy}
          onPress={() => onChange('default')}
        />
        <SegBtn
          label="Grant"
          active={mode === 'allow'}
          activeBg={colors.success}
          activeText={colors.onBlock}
          disabled={disabled}
          busy={busy}
          onPress={() => onChange('allow')}
        />
        <SegBtn
          label="Deny"
          active={mode === 'deny'}
          activeBg={colors.error}
          activeText={colors.onBlock}
          disabled={disabled}
          busy={busy}
          onPress={() => onChange('deny')}
        />
      </View>
    </View>
  );
}

/** One segment of the Default / Grant / Deny control. ≥48dp tap target. */
function SegBtn({
  label,
  active,
  activeBg,
  activeText,
  disabled,
  busy,
  onPress,
}: {
  label: string;
  active: boolean;
  activeBg: string;
  activeText: string;
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: disabled || busy }}
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={[
        styles.segBtn,
        { backgroundColor: active ? activeBg : 'transparent' },
        (disabled || busy) && styles.segBtnDisabled,
      ]}
    >
      <AppText
        style={styles.segText}
        color={active ? activeText : colors.textDim}
        tabular={false}
        numberOfLines={1}
      >
        {label}
      </AppText>
    </PressableScale>
  );
}

/** Shared back row (no native header — matches the rest of the console). */
function BackRow({ onBack }: { onBack: () => void }) {
  return (
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
  locked: {
    marginTop: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  banner: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  hint: { marginTop: spacing.md },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  // Roster rows: charcoal cards with gaps (block language — no hairlines).
  staffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
    marginBottom: spacing.sm,
  },
  rowBlocked: { opacity: 0.55 },
  staffText: { flex: 1, gap: 4 },
  detailHead: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: 4,
    marginBottom: spacing.md,
  },
  detailTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: 2,
  },
  formula: { marginTop: spacing.sm },
  lockNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  lockNoticeText: { flex: 1 },
  // Permission row: charcoal card, override highlighted with a raised fill.
  permRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  permRowOverridden: { backgroundColor: colors.surfaceRaised },
  permText: { gap: 4 },
  permTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  permLabel: { flexShrink: 1 },
  seg: {
    flexDirection: 'row',
    borderRadius: radius.full,
    backgroundColor: colors.bg,
    padding: 3,
    gap: 3,
  },
  segBtn: {
    flex: 1,
    minHeight: touch.min,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  segBtnDisabled: { opacity: 0.55 },
  segText: {
    fontFamily: typeTokens.bodyMedium,
    fontSize: 13,
    letterSpacing: 0.5,
  },
  retryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  inlineError: { marginTop: spacing.xs },
});
