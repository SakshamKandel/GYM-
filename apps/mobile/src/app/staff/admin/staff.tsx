import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Chip,
  ConfirmDialog,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Tag,
} from '../../../components/ui';
import { assignableRolesFor, canManageRole } from '@gym/shared';
import {
  getMembers,
  getStaff,
  grantRole,
  revokeRole,
  type MemberRow,
  type StaffErrorCode,
  type StaffRole,
  type StaffRow,
  toStaffError,
} from '../../../features/staff/api';
import { isTopAdmin, replaceStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { ROLE_LABEL } from '../../../features/staff/roles';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Staff & roles (super_admin + main_admin).
 *
 * Lists every staff account (getStaff), lets the caller grant a role to any
 * account found via a member search (grantRole), and revoke an existing staff
 * member's access (revokeRole) behind a confirm. Mutations refetch the roster.
 *
 * Rank-aware: the grant chips come from assignableRolesFor(callerRole) (a
 * main_admin hands out sub-roles only), rows the caller cannot manage carry a
 * lock tag and no actions, and the caller's own row is labeled "You" with no
 * actions — mirroring the server's cannot_target_self / insufficient_rank
 * guards so a tap can never end in a surprise 403. Gated: sub-roles see a
 * locked notice, never the data.
 *
 * Block language (REVAMP-BRIEF): back row → ScreenHeader → charcoal result and
 * roster rows separated by gaps (no borders, no hairline dividers); role chips
 * stay pills; the revoke action reads in red.
 */

/** Friendly line for a failed grant/role change. */
function grantFailLine(code: StaffErrorCode): string {
  switch (code) {
    case 'insufficient_rank':
      return 'Only a super admin can manage that role.';
    case 'cannot_target_self':
      return "You can't change your own role.";
    case 'unauthorized':
      return 'Your session expired. Sign in again.';
    case 'forbidden':
      return "You don't have permission to grant roles.";
    case 'not_found':
      return 'That account no longer exists.';
    case 'invalid':
      return "The server didn't accept that role.";
    default:
      return "Couldn't reach the server. Try again.";
  }
}

/** Friendly line for a failed revoke. */
function revokeFailLine(code: StaffErrorCode): string {
  switch (code) {
    case 'cannot_revoke_self':
    case 'conflict':
      return "You can't revoke your own access.";
    case 'insufficient_rank':
      return 'Only a super admin can revoke that role.';
    case 'unauthorized':
      return 'Your session expired. Sign in again.';
    case 'forbidden':
      return "You don't have permission to revoke roles.";
    case 'not_found':
      return 'That account is no longer staff.';
    default:
      return "Couldn't reach the server. Try again.";
  }
}

export default function StaffAndRolesScreen() {
  const token = useAuth((s) => s.token);
  const staffRole = useAuth((s) => s.staffRole);
  const myAccountId = useAuth((s) => s.user?.id ?? null);
  const canManageStaff = isTopAdmin(staffRole);

  /** Roles the CALLER may hand out — highest rank first (canonical order). */
  // useMemo (not a plain expression): the React Compiler refuses to optimise
  // the component when this call result feeds JSX unmemoised.
  const grantableRoles: StaffRole[] = useMemo(
    () => (staffRole ? assignableRolesFor(staffRole) : []),
    [staffRole],
  );

  /** May the caller manage (change/revoke) a row holding `role`? */
  function canManage(role: StaffRole): boolean {
    return staffRole !== null && canManageRole(staffRole, role);
  }

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
      setRosterError(toStaffError(err).code);
    } finally {
      setRosterLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (canManageStaff) void loadStaff();
  }, [canManageStaff, loadStaff]);

  // ── Grant flow ────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemberRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [picked, setPicked] = useState<MemberRow | null>(null);
  const [role, setRole] = useState<StaffRole>('coach');
  const [granting, setGranting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const search = useCallback(async () => {
    if (!token || !query.trim()) return;
    setSearching(true);
    setSearchError(null);
    setPicked(null);
    try {
      setResults(await getMembers(token, query));
    } catch (err) {
      setSearchError(toStaffError(err).code);
    } finally {
      setSearching(false);
    }
  }, [token, query]);

  const doGrant = useCallback(async () => {
    if (!token || !picked) return;
    setGranting(true);
    setBanner(null);
    try {
      await grantRole(picked.id, role, token);
      setBanner(`${picked.email} is now ${ROLE_LABEL[role]}.`);
      setQuery('');
      setResults([]);
      setPicked(null);
      await loadStaff();
    } catch (err) {
      setBanner(grantFailLine(toStaffError(err).code));
    } finally {
      setGranting(false);
    }
  }, [token, picked, role, loadStaff]);

  // ── Revoke flow ───────────────────────────────────────────
  const [revoking, setRevoking] = useState<StaffRow | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);

  const doRevoke = useCallback(async () => {
    if (!token || !revoking) return;
    setRevokeBusy(true);
    try {
      await revokeRole(revoking.accountId, token);
      setBanner(`Revoked staff access for ${revoking.email}.`);
      setRevoking(null);
      await loadStaff();
    } catch (err) {
      const code = toStaffError(err).code;
      setBanner(revokeFailLine(code));
      setRevoking(null);
    } finally {
      setRevokeBusy(false);
    }
  }, [token, revoking, loadStaff]);

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replaceStaff(STAFF_ROUTES.hub);
  }

  // ── Gate ──────────────────────────────────────────────────
  if (!canManageStaff) {
    return (
      <Screen>
        <BackRow title="Staff & roles" onBack={goBack} />
        <Animated.View entering={enterUp(0)} style={styles.locked}>
          <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textFaint}>
            Only a super admin or main admin can manage staff and roles.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen scroll keyboardAware>
      <BackRow title="Staff & roles" onBack={goBack} />

      {banner ? (
        <Animated.View entering={enterUp(0)} style={styles.banner}>
          <AppText variant="caption" color={colors.text}>
            {banner}
          </AppText>
        </Animated.View>
      ) : null}

      {/* ── Grant a role ── */}
      <SectionLabel>Grant a role</SectionLabel>
      <View style={styles.searchRow}>
        <AppTextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Find an account by email"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          returnKeyType="search"
          onSubmitEditing={() => void search()}
          style={styles.searchInput}
        />
        <Button
          label="Search"
          variant="secondary"
          onPress={() => void search()}
          loading={searching}
          disabled={!query.trim()}
          style={styles.searchBtn}
        />
      </View>

      {searchError ? (
        <RetryLine label="Couldn't search" onRetry={() => void search()} />
      ) : null}

      {!searchError && !searching && query.trim() && results.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.hint}>
          No accounts match that email.
        </AppText>
      ) : null}

      {results.map((m) => {
        const isPicked = picked?.id === m.id;
        const isSelf = m.id === myAccountId;
        // Mirror the server guards: no self-targeting, no touching a staff
        // row the caller does not outrank.
        const blocked = isSelf || (m.staffRole !== null && !canManage(m.staffRole));
        return (
          <PressableScale
            key={m.id}
            accessibilityRole="button"
            accessibilityState={{ selected: isPicked, disabled: blocked }}
            disabled={blocked}
            onPress={() => setPicked(isPicked ? null : m)}
            style={[
              styles.resultRow,
              isPicked && styles.resultRowPicked,
              blocked && styles.rowBlocked,
            ]}
          >
            <View style={styles.resultText}>
              <AppText variant="bodyBold" numberOfLines={1}>
                {m.displayName || m.email}
              </AppText>
              <AppText variant="caption" numberOfLines={1}>
                {m.email}
              </AppText>
              {isSelf ? (
                <View style={styles.staffTags}>
                  <Tag label="You" variant="outline" color={colors.textDim} />
                </View>
              ) : m.staffRole !== null ? (
                <View style={styles.staffTags}>
                  <Tag label={ROLE_LABEL[m.staffRole]} variant="dim" />
                  {blocked ? (
                    <Tag
                      label="Managed by super admin"
                      variant="outline"
                      color={colors.textFaint}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
            <Ionicons
              name={
                blocked
                  ? 'lock-closed'
                  : isPicked
                    ? 'checkmark-circle'
                    : 'ellipse-outline'
              }
              size={blocked ? 18 : 22}
              color={isPicked ? colors.accent : colors.textFaint}
            />
          </PressableScale>
        );
      })}

      {picked ? (
        <Animated.View entering={enterUp(0)} style={styles.grantPanel}>
          <AppText variant="caption" color={colors.textDim}>
            Role for {picked.email}
          </AppText>
          <View style={styles.roleChips}>
            {grantableRoles.map((r) => (
              <Chip
                key={r}
                label={ROLE_LABEL[r]}
                selected={role === r}
                onPress={() => setRole(r)}
              />
            ))}
          </View>
          <Button
            label={`Grant ${ROLE_LABEL[role]}`}
            onPress={() => void doGrant()}
            loading={granting}
          />
        </Animated.View>
      ) : null}

      {/* ── Current staff ── */}
      <SectionLabel>Current staff</SectionLabel>

      {rosterLoading && !staff ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}

      {rosterError && !staff ? (
        <RetryLine label="Couldn't load staff" onRetry={() => void loadStaff()} />
      ) : null}

      {staff && staff.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.hint}>
          No staff accounts yet.
        </AppText>
      ) : null}

      {staff?.map((s, i) => {
        const isSelf = s.accountId === myAccountId;
        const locked = !isSelf && !canManage(s.role);
        return (
          <Animated.View key={s.accountId} entering={enterUp(Math.min(i, 6))}>
            <View style={styles.staffRow}>
              <View style={styles.staffText}>
                <AppText variant="bodyBold" numberOfLines={1}>
                  {s.displayName || s.email}
                </AppText>
                <AppText variant="caption" numberOfLines={1}>
                  {s.email}
                </AppText>
                <View style={styles.staffTags}>
                  <Tag label={ROLE_LABEL[s.role]} variant="dim" />
                  {isSelf ? (
                    <Tag label="You" variant="outline" color={colors.textDim} />
                  ) : null}
                  {locked ? (
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
              {isSelf || locked ? (
                <View style={styles.lockSlot}>
                  {locked ? (
                    <Ionicons name="lock-closed" size={16} color={colors.textFaint} />
                  ) : null}
                </View>
              ) : (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Revoke ${s.email}`}
                  onPress={() => setRevoking(s)}
                  style={styles.revokeBtn}
                >
                  <Ionicons name="close" size={18} color={colors.error} />
                </PressableScale>
              )}
            </View>
          </Animated.View>
        );
      })}

      <ConfirmDialog
        visible={revoking !== null}
        danger
        title="Revoke staff access?"
        message={
          revoking
            ? `${revoking.email} will lose all staff access and any live sessions end immediately.`
            : undefined
        }
        confirmLabel={revokeBusy ? 'Revoking…' : 'Revoke'}
        cancelLabel="Cancel"
        onConfirm={() => void doRevoke()}
        onCancel={() => (revokeBusy ? undefined : setRevoking(null))}
      />
    </Screen>
  );
}

/** Shared back row + revamp header (no native header — matches the app). */
function BackRow({ title, onBack }: { title: string; onBack: () => void }) {
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
      <ScreenHeader eyebrow="Admin console" title={title} style={styles.header} />
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
  searchRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
  searchInput: { flex: 1 },
  searchBtn: { paddingHorizontal: 18 },
  hint: { marginTop: spacing.md },
  // Charcoal result row (brief §11c): no border; picked = raised fill.
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
    marginTop: spacing.sm,
  },
  resultRowPicked: { backgroundColor: colors.surfaceRaised },
  rowBlocked: { opacity: 0.55 },
  resultText: { flex: 1, gap: 2 },
  grantPanel: {
    marginTop: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  roleChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  // Roster rows: charcoal cards with gaps — replaces the old hairline dividers.
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
  staffText: { flex: 1, gap: 4 },
  staffTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: 2,
  },
  lockSlot: {
    width: touch.min,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  revokeBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
});
