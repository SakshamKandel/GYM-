import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  ConfirmDialog,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  SectionLabel,
  Sheet,
  Tag,
} from '../../../components/ui';
import {
  assignClient,
  getCoaches,
  getMemberDetail,
  getMembers,
  toStaffError,
  updateMember,
  type CoachRow,
  type MemberDetail,
  type MemberRow,
  type MemberStatus,
  type Tier,
} from '../../../features/staff/api';
import { pushStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Members — the searchable member directory.
 *
 * The list is server-filtered by an email substring (getMembers(q), debounced).
 * Tapping a member opens a detail sheet that loads the full record and hosts the
 * three privileged actions: change tier, suspend/reactivate (both via
 * updateMember), and assign a coach (getCoaches + assignClient). Every mutation
 * refetches the sheet AND the list so the two never disagree. Loading is a quiet
 * spinner; failures surface as a single retry line or a branded dialog.
 */

const TIER_ORDER: Tier[] = ['starter', 'silver', 'gold', 'elite'];

const TIER_LABEL: Record<Tier, string> = {
  starter: 'Starter',
  silver: 'Silver',
  gold: 'Gold',
  elite: 'Elite',
};

const SEARCH_DEBOUNCE_MS = 300;

// ── One member list row ──────────────────────────────────────────

function MemberRowCard({
  member,
  index,
  onPress,
}: {
  member: MemberRow;
  index: number;
  onPress: () => void;
}) {
  const suspended = member.status === 'suspended';
  return (
    <Animated.View entering={enterUp(index)}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${member.displayName || member.email}`}
        onPress={onPress}
        style={styles.row}
      >
        <View style={styles.rowText}>
          <AppText variant="bodyBold" numberOfLines={1}>
            {member.displayName || member.email}
          </AppText>
          <AppText variant="caption" numberOfLines={1}>
            {member.email}
          </AppText>
        </View>
        <View style={styles.rowTags}>
          <Tag label={TIER_LABEL[member.tier]} variant="outline" />
          {suspended ? (
            <Tag label="Suspended" variant="outline" color={colors.error} />
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
      </PressableScale>
    </Animated.View>
  );
}

export default function AdminMembersScreen() {
  const token = useAuth((s) => s.token);

  // ── List state ───────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Detail sheet state ───────────────────────────────────────
  // The member whose sheet is open (list row we tapped) — drives visibility.
  const [openRow, setOpenRow] = useState<MemberRow | null>(null);
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Secondary pickers (open above the detail sheet).
  const [tierPickerOpen, setTierPickerOpen] = useState(false);
  const [coachPickerOpen, setCoachPickerOpen] = useState(false);
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [coachesLoading, setCoachesLoading] = useState(false);

  // Suspend/reactivate confirm + generic mutation error dialog.
  const [statusConfirm, setStatusConfirm] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  // ── List fetch (debounced by query) ──────────────────────────
  const loadList = useCallback(
    async (q: string) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        setMembers(await getMembers(token, q));
      } catch (err) {
        setError(errorLine(toStaffError(err).code));
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    const handle = setTimeout(() => void loadList(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, loadList]);

  // ── Detail fetch (when a row opens) ──────────────────────────
  const loadDetail = useCallback(
    async (id: string) => {
      if (!token) return;
      setDetailLoading(true);
      setDetailError(null);
      try {
        setDetail(await getMemberDetail(id, token));
      } catch (err) {
        setDetailError(errorLine(toStaffError(err).code));
      } finally {
        setDetailLoading(false);
      }
    },
    [token],
  );

  function openMember(member: MemberRow): void {
    setOpenRow(member);
    setDetail(null);
    setDetailError(null);
    void loadDetail(member.id);
  }

  function closeSheet(): void {
    setOpenRow(null);
    setDetail(null);
    setTierPickerOpen(false);
    setCoachPickerOpen(false);
  }

  // ── Mutations (all refetch the detail + list on success) ─────
  const refresh = useCallback(
    async (id: string) => {
      await Promise.all([loadDetail(id), loadList(query)]);
    },
    [loadDetail, loadList, query],
  );

  const changeTier = useCallback(
    async (tier: Tier) => {
      setTierPickerOpen(false);
      if (!token || !detail || tier === detail.member.tier) return;
      setSaving(true);
      try {
        await updateMember(detail.member.id, { tier }, token);
        await refresh(detail.member.id);
      } catch (err) {
        setMutationError(errorLine(toStaffError(err).code));
      } finally {
        setSaving(false);
      }
    },
    [token, detail, refresh],
  );

  const toggleStatus = useCallback(async () => {
    setStatusConfirm(false);
    if (!token || !detail) return;
    const next: MemberStatus =
      detail.member.status === 'active' ? 'suspended' : 'active';
    setSaving(true);
    try {
      await updateMember(detail.member.id, { status: next }, token);
      await refresh(detail.member.id);
    } catch (err) {
      setMutationError(errorLine(toStaffError(err).code));
    } finally {
      setSaving(false);
    }
  }, [token, detail, refresh]);

  const openCoachPicker = useCallback(async () => {
    setCoachPickerOpen(true);
    if (!token) return;
    setCoachesLoading(true);
    try {
      setCoaches(await getCoaches(token));
    } catch (err) {
      setMutationError(errorLine(toStaffError(err).code));
      setCoachPickerOpen(false);
    } finally {
      setCoachesLoading(false);
    }
  }, [token]);

  const assignCoach = useCallback(
    async (coach: CoachRow) => {
      setCoachPickerOpen(false);
      if (!token || !detail) return;
      setSaving(true);
      try {
        await assignClient(coach.id, detail.member.id, token);
        await refresh(detail.member.id);
      } catch (err) {
        setMutationError(errorLine(toStaffError(err).code));
      } finally {
        setSaving(false);
      }
    },
    [token, detail, refresh],
  );

  const suspended = detail?.member.status === 'suspended';

  return (
    <Screen scroll keyboardAware>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back to admin console"
          onPress={() => pushStaff(STAFF_ROUTES.adminHome)}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
        <AppText variant="heading">Members</AppText>
      </Animated.View>

      <Animated.View entering={enterUp(0)} style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.textDim} style={styles.searchIcon} />
        <AppTextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name or email"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.searchInput}
        />
        {query.length > 0 ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => setQuery('')}
            style={styles.clearBtn}
          >
            <Ionicons name="close-circle" size={18} color={colors.textDim} />
          </PressableScale>
        ) : null}
      </Animated.View>

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centre}>
          <AppText variant="caption" center color={colors.textDim}>
            {error}
          </AppText>
          <Button label="Retry" variant="secondary" onPress={() => void loadList(query)} />
        </View>
      ) : members.length === 0 ? (
        <View style={styles.centre}>
          <AppText variant="caption" center color={colors.textFaint}>
            {query.trim()
              ? 'No members match that search.'
              : 'No members yet.'}
          </AppText>
        </View>
      ) : (
        members.map((member, i) => (
          <MemberRowCard
            key={member.id}
            member={member}
            index={i}
            onPress={() => openMember(member)}
          />
        ))
      )}

      {/* ── Member detail sheet ── */}
      <Sheet
        visible={openRow !== null}
        onClose={closeSheet}
        title={openRow?.displayName || openRow?.email || 'Member'}
      >
        {detailLoading && !detail ? (
          <View style={styles.sheetCentre}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : detailError && !detail ? (
          <View style={styles.sheetCentre}>
            <AppText variant="caption" center color={colors.textDim}>
              {detailError}
            </AppText>
            <Button
              label="Retry"
              variant="secondary"
              onPress={() => openRow && void loadDetail(openRow.id)}
            />
          </View>
        ) : detail ? (
          <View style={styles.sheetBody}>
            <AppText variant="caption" numberOfLines={1}>
              {detail.member.email}
            </AppText>

            <View style={styles.statusTags}>
              <Tag label={TIER_LABEL[detail.member.tier]} variant="outline" />
              <Tag
                label={suspended ? 'Suspended' : 'Active'}
                variant="outline"
                color={suspended ? colors.error : colors.success}
              />
            </View>

            {/* Coach line */}
            <View style={styles.coachLine}>
              <Ionicons name="barbell-outline" size={16} color={colors.textDim} />
              <AppText variant="caption" style={styles.coachLineText} numberOfLines={1}>
                {detail.coach
                  ? `Coach · ${detail.coach.displayName || detail.coach.email}`
                  : 'No coach assigned'}
              </AppText>
            </View>

            {/* Actions */}
            <View style={styles.actions}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Change tier"
                disabled={saving}
                onPress={() => setTierPickerOpen(true)}
                style={[styles.action, saving && styles.actionDisabled]}
              >
                <Ionicons name="pricetag-outline" size={18} color={colors.text} />
                <AppText variant="body" color={colors.text}>
                  Change tier
                </AppText>
                <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
              </PressableScale>

              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={detail.coach ? 'Reassign coach' : 'Assign coach'}
                disabled={saving}
                onPress={() => void openCoachPicker()}
                style={[styles.action, saving && styles.actionDisabled]}
              >
                <Ionicons name="person-add-outline" size={18} color={colors.text} />
                <AppText variant="body" color={colors.text}>
                  {detail.coach ? 'Reassign coach' : 'Assign coach'}
                </AppText>
                <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
              </PressableScale>

              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={suspended ? 'Reactivate member' : 'Suspend member'}
                disabled={saving}
                onPress={() => setStatusConfirm(true)}
                style={[styles.action, saving && styles.actionDisabled]}
              >
                <Ionicons
                  name={suspended ? 'play-circle-outline' : 'pause-circle-outline'}
                  size={18}
                  color={suspended ? colors.success : colors.error}
                />
                <AppText
                  variant="body"
                  color={suspended ? colors.success : colors.error}
                >
                  {suspended ? 'Reactivate' : 'Suspend'}
                </AppText>
              </PressableScale>
            </View>

            {saving ? (
              <View style={styles.savingRow}>
                <ActivityIndicator size="small" color={colors.textDim} />
                <AppText variant="caption" color={colors.textDim}>
                  Saving…
                </AppText>
              </View>
            ) : null}
          </View>
        ) : null}
      </Sheet>

      {/* ── Tier picker (above the detail sheet) ── */}
      <Sheet
        visible={tierPickerOpen}
        onClose={() => setTierPickerOpen(false)}
        title="Set tier"
      >
        {TIER_ORDER.map((tier) => {
          const current = tier === detail?.member.tier;
          return (
            <PressableScale
              key={tier}
              accessibilityRole="button"
              accessibilityState={{ selected: current }}
              accessibilityLabel={TIER_LABEL[tier]}
              onPress={() => void changeTier(tier)}
              style={styles.pickerOption}
            >
              <AppText variant="body" color={current ? colors.text : colors.textDim}>
                {TIER_LABEL[tier]}
              </AppText>
              {current ? (
                <Ionicons name="checkmark" size={20} color={colors.accent} />
              ) : null}
            </PressableScale>
          );
        })}
      </Sheet>

      {/* ── Coach picker ── */}
      <Sheet
        visible={coachPickerOpen}
        onClose={() => setCoachPickerOpen(false)}
        title="Assign a coach"
      >
        {coachesLoading ? (
          <View style={styles.sheetCentre}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : coaches.length === 0 ? (
          <View style={styles.sheetCentre}>
            <AppText variant="caption" center color={colors.textFaint}>
              No coaches available to assign.
            </AppText>
          </View>
        ) : (
          <>
            <SectionLabel>Coaches</SectionLabel>
            {coaches.map((coach) => {
              const current = detail?.coach?.coachId === coach.id;
              return (
                <PressableScale
                  key={coach.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: current }}
                  accessibilityLabel={coach.coachName || coach.displayName || coach.email}
                  onPress={() => void assignCoach(coach)}
                  style={styles.pickerOption}
                >
                  <View style={styles.coachOptionText}>
                    <AppText
                      variant="body"
                      color={current ? colors.text : colors.textDim}
                      numberOfLines={1}
                    >
                      {coach.coachName || coach.displayName || coach.email}
                    </AppText>
                    <AppText variant="caption" color={colors.textFaint} numberOfLines={1}>
                      {coach.activeClients} active{' '}
                      {coach.activeClients === 1 ? 'client' : 'clients'}
                    </AppText>
                  </View>
                  {current ? (
                    <Ionicons name="checkmark" size={20} color={colors.accent} />
                  ) : null}
                </PressableScale>
              );
            })}
          </>
        )}
      </Sheet>

      {/* ── Suspend / reactivate confirm ── */}
      <ConfirmDialog
        visible={statusConfirm}
        title={suspended ? 'Reactivate member?' : 'Suspend member?'}
        message={
          suspended
            ? 'They will regain access to their account immediately.'
            : 'They will lose access until reactivated.'
        }
        confirmLabel={suspended ? 'Reactivate' : 'Suspend'}
        cancelLabel="Cancel"
        danger={!suspended}
        onConfirm={() => void toggleStatus()}
        onCancel={() => setStatusConfirm(false)}
      />

      {/* ── Mutation error ── */}
      <ConfirmDialog
        visible={mutationError !== null}
        title="Couldn't save"
        message={mutationError ?? undefined}
        confirmLabel="OK"
        hideCancel
        onConfirm={() => setMutationError(null)}
        onCancel={() => setMutationError(null)}
      />
    </Screen>
  );
}

/** Map a StaffApiError code to a short, human line. */
function errorLine(code: string): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired. Sign in again to continue.';
    case 'forbidden':
      return "You don't have permission for that.";
    case 'not_found':
      return 'That member no longer exists.';
    case 'invalid':
      return 'That change was rejected. Try again.';
    case 'conflict':
      return 'That change conflicts with the current state.';
    default:
      return "Couldn't reach the server. Check your connection and retry.";
  }
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
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  searchIcon: {
    position: 'absolute',
    left: 18,
    zIndex: 1,
  },
  searchInput: {
    flex: 1,
    paddingLeft: 46,
    paddingRight: 46,
  },
  clearBtn: {
    position: 'absolute',
    right: 14,
    height: touch.min,
    width: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centre: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    gap: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  rowText: { flex: 1, gap: 2, minWidth: 0 },
  rowTags: { flexDirection: 'row', gap: spacing.xs, flexShrink: 0 },
  // ── Sheet ──
  sheetCentre: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    gap: spacing.lg,
  },
  sheetBody: { gap: spacing.md },
  statusTags: { flexDirection: 'row', gap: spacing.sm },
  coachLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  coachLineText: { flex: 1 },
  actions: { gap: spacing.sm, marginTop: spacing.xs },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: touch.primary,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  actionDisabled: { opacity: 0.4 },
  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: touch.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  coachOptionText: { flex: 1, gap: 2, minWidth: 0, paddingRight: spacing.md },
});
