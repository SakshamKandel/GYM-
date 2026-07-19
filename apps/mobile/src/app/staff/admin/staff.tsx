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
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Sheet,
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
import { replaceStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { ReauthSheet, useReauth } from '../../../features/staff/ReauthGate';
import { ROLE_LABEL } from '../../../features/staff/roles';
import { useAuth } from '../../../state/auth';

/**
 * Offboarding-impact preview (P0-3 / plan §3 gap-build #3): a coach revoke
 * triggers the C2 cascade (end active assignments, decline pending requests,
 * deactivate the coach profile, deactivate owned promo codes) — this is what
 * the confirm sheet shows BEFORE the admin commits. Fetched via
 * `revokeRole(accountId, token, { dryRun: true })`, which appends `?dryRun=1`
 * and hits the server's READ-ONLY preflight branch — it can never trigger the
 * real cascade, no matter when it's called (including the instant the admin
 * taps the revoke icon, before the typed-confirm sheet or the real Revoke
 * button).
 *
 * P1-14 / C-F: the dry-run counts grew `pendingTierRequests`,
 * `activeWorkoutPlans` and `activeDietPlans` alongside the offboarding
 * cascade itself deactivating owned promo codes — this preview used to drop
 * all three, understating the blast radius an admin sees before confirming.
 */
interface RevokeImpact {
  activeClients: number;
  pendingCoachRequests: number;
  pendingTierRequests: number;
  activeWorkoutPlans: number;
  activeDietPlans: number;
  walletBalances: { currency: string; amountMinor: number }[];
}

async function fetchRevokeImpact(accountId: string, token: string): Promise<RevokeImpact> {
  const { counts } = await revokeRole(accountId, token, { dryRun: true });
  return {
    activeClients: counts?.activeClients ?? 0,
    pendingCoachRequests: counts?.pendingRequests ?? 0,
    pendingTierRequests: counts?.pendingTierRequests ?? 0,
    activeWorkoutPlans: counts?.activeWorkoutPlans ?? 0,
    activeDietPlans: counts?.activeDietPlans ?? 0,
    walletBalances: counts?.walletBalances ?? [],
  };
}

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
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const myAccountId = useAuth((s) => s.user?.id ?? null);
  const canManageStaff = staffCan(staffPermissions, 'roles.grant');
  // Step-up (plan §3 #14): granting, revoking, or offboarding a staff account
  // are the console's most destructive actions — each is gated behind a fresh
  // password re-entry (5-min in-memory window shared across the console).
  const reauth = useReauth();

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
      setResults((await getMembers(token, query)).members);
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

  // ── Re-role-away-from-coach impact preview (P1-14 / P0-7 mobile half) ──
  // Granting a NEW role to an account that currently holds 'coach' triggers
  // the SAME C2 offboarding cascade as an explicit Revoke — before this fix
  // `doGrant()` had no impact check at all, so re-roling a coach through the
  // Grant-a-role search flow silently cascaded with zero warning. Reuses the
  // same dry-run + typed-confirm pattern as the roster's Revoke action.
  const [regrantTarget, setRegrantTarget] = useState<{ picked: MemberRow; role: StaffRole } | null>(
    null,
  );
  const [regrantTypedConfirm, setRegrantTypedConfirm] = useState('');
  const [regrantImpact, setRegrantImpact] = useState<RevokeImpact | null>(null);
  const [regrantImpactLoading, setRegrantImpactLoading] = useState(false);
  const [regrantImpactError, setRegrantImpactError] = useState<string | null>(null);
  const [regrantBusy, setRegrantBusy] = useState(false);

  const loadRegrantImpact = useCallback(
    async (accountId: string) => {
      if (!token) return;
      setRegrantImpactLoading(true);
      setRegrantImpactError(null);
      try {
        setRegrantImpact(await fetchRevokeImpact(accountId, token));
      } catch (err) {
        setRegrantImpactError(revokeFailLine(toStaffError(err).code));
      } finally {
        setRegrantImpactLoading(false);
      }
    },
    [token],
  );

  /** Entry point for the Grant button — re-roling AWAY from coach previews
   * the offboard cascade first; every other grant proceeds straight to the
   * (still reauth-gated) doGrant(). */
  function requestGrant(): void {
    if (!picked) return;
    if (picked.staffRole === 'coach' && role !== 'coach') {
      setRegrantTarget({ picked, role });
      setRegrantTypedConfirm('');
      setRegrantImpact(null);
      setRegrantImpactError(null);
      void loadRegrantImpact(picked.id);
      return;
    }
    reauth.guard(() => void doGrant());
  }

  function closeRegrant(): void {
    if (regrantBusy) return;
    setRegrantTarget(null);
    setRegrantTypedConfirm('');
    setRegrantImpact(null);
    setRegrantImpactError(null);
  }

  const regrantConfirmMatches =
    regrantTarget !== null &&
    regrantTypedConfirm.trim().toLowerCase() === regrantTarget.picked.email.toLowerCase();

  const doRegrant = useCallback(async () => {
    if (!token || !regrantTarget || !regrantConfirmMatches) return;
    const { picked: target, role: newRole } = regrantTarget;
    setRegrantBusy(true);
    try {
      await grantRole(target.id, newRole, token);
      setBanner(`${target.email} is now ${ROLE_LABEL[newRole]}.`);
      setQuery('');
      setResults([]);
      setPicked(null);
      setRegrantTarget(null);
      setRegrantTypedConfirm('');
      setRegrantImpact(null);
      await loadStaff();
    } catch (err) {
      setBanner(grantFailLine(toStaffError(err).code));
      setRegrantTarget(null);
      setRegrantTypedConfirm('');
      setRegrantImpact(null);
    } finally {
      setRegrantBusy(false);
    }
  }, [token, regrantTarget, regrantConfirmMatches, loadStaff]);

  // ── Revoke flow (P0-3: offboarding confirm — dry-run counts + typed confirm) ──
  const [revoking, setRevoking] = useState<StaffRow | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [typedConfirm, setTypedConfirm] = useState('');
  // Coach revokes trigger the C2 offboarding cascade (end active assignments,
  // decline pending requests, deactivate the coach profile). A revoking admin
  // needs to SEE that blast radius before confirming — fetched via the same
  // DELETE route in dry-run mode so the preview can never drift from what the
  // real cascade will do.
  const [revokeImpact, setRevokeImpact] = useState<RevokeImpact | null>(null);
  const [revokeImpactLoading, setRevokeImpactLoading] = useState(false);
  const [revokeImpactError, setRevokeImpactError] = useState<string | null>(null);

  const loadRevokeImpact = useCallback(
    async (accountId: string) => {
      if (!token) return;
      setRevokeImpactLoading(true);
      setRevokeImpactError(null);
      try {
        setRevokeImpact(await fetchRevokeImpact(accountId, token));
      } catch (err) {
        setRevokeImpactError(revokeFailLine(toStaffError(err).code));
      } finally {
        setRevokeImpactLoading(false);
      }
    },
    [token],
  );

  function openRevoke(s: StaffRow): void {
    setRevoking(s);
    setTypedConfirm('');
    setRevokeImpact(null);
    setRevokeImpactError(null);
    if (s.role === 'coach') void loadRevokeImpact(s.accountId);
  }

  function closeRevoke(): void {
    if (revokeBusy) return;
    setRevoking(null);
    setTypedConfirm('');
    setRevokeImpact(null);
    setRevokeImpactError(null);
  }

  const revokeConfirmMatches =
    revoking !== null && typedConfirm.trim().toLowerCase() === revoking.email.toLowerCase();

  const doRevoke = useCallback(async () => {
    if (!token || !revoking || !revokeConfirmMatches) return;
    const target = revoking;
    setRevokeBusy(true);
    try {
      await revokeRole(target.accountId, token);
      setBanner(`Revoked staff access for ${target.email}.`);
      setRevoking(null);
      setTypedConfirm('');
      setRevokeImpact(null);
      setRevokeImpactError(null);
      await loadStaff();
    } catch (err) {
      const code = toStaffError(err).code;
      setBanner(revokeFailLine(code));
      setRevoking(null);
      setTypedConfirm('');
      setRevokeImpact(null);
      setRevokeImpactError(null);
    } finally {
      setRevokeBusy(false);
    }
  }, [token, revoking, revokeConfirmMatches, loadStaff]);

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
            onPress={requestGrant}
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
                  onPress={() => openRevoke(s)}
                  style={styles.revokeBtn}
                >
                  <Ionicons name="close" size={18} color={colors.error} />
                </PressableScale>
              )}
            </View>
          </Animated.View>
        );
      })}

      {/* ── Offboarding confirm: dry-run counts + typed confirm (P0-3) ── */}
      <Sheet visible={revoking !== null} onClose={closeRevoke} title="Revoke staff access?">
        {revoking ? (
          <View style={styles.revokeSheetBody}>
            <AppText variant="body" color={colors.textDim}>
              {revoking.email} will lose all staff access and any live sessions
              end immediately.
            </AppText>

            {revoking.role === 'coach' ? (
              revokeImpactLoading ? (
                <View style={styles.center}>
                  <ActivityIndicator color={colors.accent} />
                </View>
              ) : revokeImpactError ? (
                <RetryLine
                  label={revokeImpactError}
                  onRetry={() => void loadRevokeImpact(revoking.accountId)}
                />
              ) : revokeImpact ? (
                <View style={styles.impactBox}>
                  <AppText variant="bodyBold" color={colors.warning}>
                    This will also:
                  </AppText>
                  <AppText variant="caption">
                    • End {revokeImpact.activeClients} active client
                    assignment{revokeImpact.activeClients === 1 ? '' : 's'}
                  </AppText>
                  <AppText variant="caption">
                    • Decline {revokeImpact.pendingCoachRequests} pending
                    client request
                    {revokeImpact.pendingCoachRequests === 1 ? '' : 's'}
                  </AppText>
                  {revokeImpact.pendingTierRequests > 0 ? (
                    <AppText variant="caption">
                      • Leave {revokeImpact.pendingTierRequests} pending
                      seniority-tier request
                      {revokeImpact.pendingTierRequests === 1 ? '' : 's'} undecided
                    </AppText>
                  ) : null}
                  {revokeImpact.activeWorkoutPlans > 0 ? (
                    <AppText variant="caption">
                      • Orphan {revokeImpact.activeWorkoutPlans} active
                      client workout plan
                      {revokeImpact.activeWorkoutPlans === 1 ? '' : 's'}
                    </AppText>
                  ) : null}
                  {revokeImpact.activeDietPlans > 0 ? (
                    <AppText variant="caption">
                      • Orphan {revokeImpact.activeDietPlans} active client
                      diet plan{revokeImpact.activeDietPlans === 1 ? '' : 's'}
                    </AppText>
                  ) : null}
                  <AppText variant="caption">• Deactivate their coach profile</AppText>
                  <AppText variant="caption">• Deactivate their promo code</AppText>
                  {revokeImpact.walletBalances.length > 0 ? (
                    revokeImpact.walletBalances.map((b) => (
                      <AppText
                        key={b.currency}
                        variant="caption"
                        color={colors.error}
                      >
                        • Outstanding wallet balance:{' '}
                        {(b.amountMinor / 100).toFixed(2)} {b.currency} — settle
                        this first, or the balance becomes untrackable once
                        revoked.
                      </AppText>
                    ))
                  ) : (
                    <AppText variant="caption" color={colors.textFaint}>
                      • No outstanding wallet balance.
                    </AppText>
                  )}
                </View>
              ) : null
            ) : null}

            <AppText variant="caption" color={colors.textDim} style={styles.typedHint}>
              Type {revoking.email} to confirm.
            </AppText>
            <AppTextInput
              value={typedConfirm}
              onChangeText={setTypedConfirm}
              placeholder={revoking.email}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Type the account's email to confirm"
            />

            <View style={styles.revokeButtons}>
              <Button
                label="Cancel"
                variant="secondary"
                style={styles.decisionBtn}
                onPress={closeRevoke}
                disabled={revokeBusy}
              />
              <Button
                label={revokeBusy ? 'Revoking…' : 'Revoke'}
                variant="danger"
                style={styles.decisionBtn}
                onPress={() => reauth.guard(() => void doRevoke())}
                disabled={revokeBusy || !revokeConfirmMatches}
                loading={revokeBusy}
              />
            </View>
          </View>
        ) : null}
      </Sheet>

      {/* ── Re-role away from coach: offboard-impact preview (P1-14) ──
          Granting a different role to a current coach triggers the SAME C2
          cascade as an explicit Revoke — this mirrors that sheet exactly so
          the admin sees the blast radius before it happens either way. */}
      <Sheet
        visible={regrantTarget !== null}
        onClose={closeRegrant}
        title={regrantTarget ? `Change role to ${ROLE_LABEL[regrantTarget.role]}?` : 'Change role?'}
      >
        {regrantTarget ? (
          <View style={styles.revokeSheetBody}>
            <AppText variant="body" color={colors.textDim}>
              {regrantTarget.picked.email} is currently a coach. Changing their role to{' '}
              {ROLE_LABEL[regrantTarget.role]} ends their coaching access immediately.
            </AppText>

            {regrantImpactLoading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : regrantImpactError ? (
              <RetryLine
                label={regrantImpactError}
                onRetry={() => void loadRegrantImpact(regrantTarget.picked.id)}
              />
            ) : regrantImpact ? (
              <View style={styles.impactBox}>
                <AppText variant="bodyBold" color={colors.warning}>
                  This will also:
                </AppText>
                <AppText variant="caption">
                  • End {regrantImpact.activeClients} active client
                  assignment{regrantImpact.activeClients === 1 ? '' : 's'}
                </AppText>
                <AppText variant="caption">
                  • Decline {regrantImpact.pendingCoachRequests} pending
                  client request{regrantImpact.pendingCoachRequests === 1 ? '' : 's'}
                </AppText>
                {regrantImpact.pendingTierRequests > 0 ? (
                  <AppText variant="caption">
                    • Leave {regrantImpact.pendingTierRequests} pending
                    seniority-tier request
                    {regrantImpact.pendingTierRequests === 1 ? '' : 's'} undecided
                  </AppText>
                ) : null}
                {regrantImpact.activeWorkoutPlans > 0 ? (
                  <AppText variant="caption">
                    • Orphan {regrantImpact.activeWorkoutPlans} active client
                    workout plan{regrantImpact.activeWorkoutPlans === 1 ? '' : 's'}
                  </AppText>
                ) : null}
                {regrantImpact.activeDietPlans > 0 ? (
                  <AppText variant="caption">
                    • Orphan {regrantImpact.activeDietPlans} active client
                    diet plan{regrantImpact.activeDietPlans === 1 ? '' : 's'}
                  </AppText>
                ) : null}
                <AppText variant="caption">• Deactivate their coach profile</AppText>
                <AppText variant="caption">• Deactivate their promo code</AppText>
                {regrantImpact.walletBalances.length > 0 ? (
                  regrantImpact.walletBalances.map((b) => (
                    <AppText key={b.currency} variant="caption" color={colors.error}>
                      • Outstanding wallet balance: {(b.amountMinor / 100).toFixed(2)}{' '}
                      {b.currency} — settle this first, or the balance becomes
                      untrackable once changed.
                    </AppText>
                  ))
                ) : (
                  <AppText variant="caption" color={colors.textFaint}>
                    • No outstanding wallet balance.
                  </AppText>
                )}
              </View>
            ) : null}

            <AppText variant="caption" color={colors.textDim} style={styles.typedHint}>
              Type {regrantTarget.picked.email} to confirm.
            </AppText>
            <AppTextInput
              value={regrantTypedConfirm}
              onChangeText={setRegrantTypedConfirm}
              placeholder={regrantTarget.picked.email}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Type the account's email to confirm"
            />

            <View style={styles.revokeButtons}>
              <Button
                label="Cancel"
                variant="secondary"
                style={styles.decisionBtn}
                onPress={closeRegrant}
                disabled={regrantBusy}
              />
              <Button
                label={regrantBusy ? 'Changing…' : 'Change role'}
                variant="danger"
                style={styles.decisionBtn}
                onPress={() => reauth.guard(() => void doRegrant())}
                disabled={regrantBusy || !regrantConfirmMatches}
                loading={regrantBusy}
              />
            </View>
          </View>
        ) : null}
      </Sheet>

      {/* Step-up password prompt for grant / revoke / offboard (plan §3 #14). */}
      <ReauthSheet controller={reauth} />
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
  revokeSheetBody: { gap: spacing.md },
  impactBox: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: 4,
  },
  typedHint: { marginTop: spacing.xs },
  revokeButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  decisionBtn: { flex: 1 },
});
