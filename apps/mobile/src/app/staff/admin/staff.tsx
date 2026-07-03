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
  Chip,
  ConfirmDialog,
  Divider,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  SectionLabel,
  Tag,
} from '../../../components/ui';
import {
  getMembers,
  getStaff,
  grantRole,
  revokeRole,
  type MemberRow,
  type StaffRole,
  type StaffRow,
  toStaffError,
} from '../../../features/staff/api';
import { replaceStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Staff & roles (super_admin only).
 *
 * Lists every staff account (getStaff), lets a super_admin grant a role to any
 * account found via a member search (grantRole), and revoke an existing staff
 * member's access (revokeRole) behind a confirm. Mutations refetch the roster.
 * Gated: a non-super_admin sees a locked notice, never the data.
 */

const ROLE_LABEL: Record<StaffRole, string> = {
  super_admin: 'Super admin',
  member_admin: 'Member admin',
  nutrition_admin: 'Nutrition admin',
  content_admin: 'Content admin',
  support_admin: 'Support admin',
  coach: 'Coach',
};

/** The roles a super_admin can hand out from this screen. */
const GRANTABLE_ROLES: StaffRole[] = [
  'coach',
  'support_admin',
  'content_admin',
  'nutrition_admin',
  'member_admin',
  'super_admin',
];

export default function StaffAndRolesScreen() {
  const token = useAuth((s) => s.token);
  const staffRole = useAuth((s) => s.staffRole);
  const isSuperAdmin = staffRole === 'super_admin';

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
    if (isSuperAdmin) void loadStaff();
  }, [isSuperAdmin, loadStaff]);

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
      setBanner(`Couldn't grant role (${toStaffError(err).code}).`);
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
      setBanner(
        code === 'conflict'
          ? "You can't revoke your own access."
          : `Couldn't revoke access (${code}).`,
      );
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
  if (!isSuperAdmin) {
    return (
      <Screen>
        <BackRow title="Staff & roles" onBack={goBack} />
        <Animated.View entering={enterUp(0)} style={styles.locked}>
          <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textFaint}>
            Only a super admin can manage staff and roles.
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
        return (
          <PressableScale
            key={m.id}
            accessibilityRole="button"
            accessibilityState={{ selected: isPicked }}
            onPress={() => setPicked(isPicked ? null : m)}
            style={[styles.resultRow, isPicked && styles.resultRowPicked]}
          >
            <View style={styles.resultText}>
              <AppText variant="bodyBold" numberOfLines={1}>
                {m.displayName || m.email}
              </AppText>
              <AppText variant="caption" numberOfLines={1}>
                {m.email}
              </AppText>
            </View>
            <Ionicons
              name={isPicked ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
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
            {GRANTABLE_ROLES.map((r) => (
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

      {staff?.map((s, i) => (
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
                {s.status === 'suspended' ? (
                  <Tag label="Suspended" variant="outline" color={colors.warning} />
                ) : null}
              </View>
            </View>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Revoke ${s.email}`}
              onPress={() => setRevoking(s)}
              style={styles.revokeBtn}
            >
              <Ionicons name="close" size={18} color={colors.error} />
            </PressableScale>
          </View>
          {i < (staff.length - 1) ? <Divider /> : null}
        </Animated.View>
      ))}

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

/** Shared back row (no header — matches the rest of the app). */
function BackRow({ title, onBack }: { title: string; onBack: () => void }) {
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
      <AppText variant="heading">{title}</AppText>
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
  locked: {
    marginTop: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  banner: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  searchRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
  searchInput: { flex: 1 },
  searchBtn: { paddingHorizontal: 18 },
  hint: { marginTop: spacing.md },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  resultRowPicked: { borderColor: colors.accent },
  resultText: { flex: 1, gap: 2 },
  grantPanel: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  roleChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  staffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  staffText: { flex: 1, gap: 4 },
  staffTags: { flexDirection: 'row', gap: spacing.sm, marginTop: 2 },
  revokeBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
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
