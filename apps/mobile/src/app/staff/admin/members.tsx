import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  ScreenHeader,
  SectionLabel,
  Sheet,
  Tag,
} from '../../../components/ui';
import { canManageRole, effectiveTier } from '@gym/shared';
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
import { pushStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { roleLabel } from '../../../features/staff/roles';
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
 *
 * Block language (REVAMP-BRIEF): back row → ScreenHeader → search → charcoal
 * member rows (no borders, fill-contrast separation); sheet options are raised
 * rows with gaps instead of hairlines. Utilitarian density — no color block.
 */

const TIER_ORDER: Tier[] = ['starter', 'silver', 'gold', 'elite'];

const TIER_LABEL: Record<Tier, string> = {
  starter: 'Starter',
  silver: 'Silver',
  gold: 'Gold',
  elite: 'Elite',
};

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Read `tierExpiresAt` off a member row/detail object defensively — the
 * client schema in features/staff/api.ts gains this field additively (RBAC
 * design contract §4.7); structural typing means this reads it the moment
 * that field lands without any further change here, and degrades to "no
 * expiry" (permanent) beforehand.
 */
function readTierExpiresAt(x: { tierExpiresAt?: unknown }): string | null {
  return typeof x.tierExpiresAt === 'string' ? x.tierExpiresAt : null;
}

/** A paid tier whose dated window has already passed (defect D3). */
function isLapsed(tier: Tier, tierExpiresAt: string | null): boolean {
  return tier !== 'starter' && effectiveTier(tier, tierExpiresAt, new Date()) === 'starter';
}

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
  const lapsed = isLapsed(member.tier, readTierExpiresAt(member));
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
          {lapsed ? (
            <Tag label="Lapsed" variant="outline" color={colors.warning} />
          ) : null}
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
  const staffRole = useAuth((s) => s.staffRole);
  const staffPermissions = useAuth((s) => s.staffPermissions);

  // ── List state ───────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
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
  // G13: the suspend/reactivate action writes an audited log row server-side
  // (updateMember's patch type already carries `reason?: string`) but this
  // screen never collected one, so every such entry landed with an empty
  // reason — defeating the auditability the action is meant to provide.
  const [statusReason, setStatusReason] = useState('');
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Monotonic request id so a slow earlier fetch can't overwrite a newer query.
  const listReqSeq = useRef(0);
  // Same pattern for the detail sheet (defect G4): without it, a slow detail
  // fetch for member A can resolve AFTER member B's sheet has already opened,
  // silently swapping detail (and therefore mutation targets) onto the wrong
  // account while the sheet TITLE (driven by openRow) still reads "B".
  const detailReqSeq = useRef(0);

  // ── List fetch (debounced by query) — always page one, replaces the list ──
  const loadList = useCallback(
    async (q: string) => {
      if (!token) return;
      const reqId = ++listReqSeq.current;
      setLoading(true);
      setError(null);
      try {
        const page = await getMembers(token, q);
        if (reqId !== listReqSeq.current) return;
        setMembers(page.members);
        setCursor(page.nextCursor);
      } catch (err) {
        if (reqId !== listReqSeq.current) return;
        setError(errorLine(toStaffError(err).code));
      } finally {
        if (reqId === listReqSeq.current) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    const handle = setTimeout(() => void loadList(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, loadList]);

  // Append the next keyset page (H3 fix — the directory used to top out at
  // the first page silently, with no way to reach members past it).
  const loadMoreList = useCallback(async () => {
    if (!token || !cursor || loadingMore) return;
    const reqId = ++listReqSeq.current;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await getMembers(token, query, cursor);
      if (reqId !== listReqSeq.current) return;
      setMembers((prev) => [...prev, ...page.members]);
      setCursor(page.nextCursor);
    } catch (err) {
      if (reqId !== listReqSeq.current) return;
      setError(errorLine(toStaffError(err).code));
    } finally {
      if (reqId === listReqSeq.current) setLoadingMore(false);
    }
  }, [token, query, cursor, loadingMore]);

  // ── Detail fetch (when a row opens) ──────────────────────────
  const loadDetail = useCallback(
    async (id: string) => {
      if (!token) return;
      const reqId = ++detailReqSeq.current;
      setDetailLoading(true);
      setDetailError(null);
      try {
        const data = await getMemberDetail(id, token);
        // A newer loadDetail (a different row opened, or a refresh) fired
        // while this one was in flight — drop this stale response instead of
        // clobbering the currently-open sheet with the wrong account (G4).
        if (reqId !== detailReqSeq.current) return;
        setDetail(data);
      } catch (err) {
        if (reqId !== detailReqSeq.current) return;
        setDetailError(errorLine(toStaffError(err).code));
      } finally {
        if (reqId === detailReqSeq.current) setDetailLoading(false);
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
    const reason = statusReason.trim();
    setSaving(true);
    try {
      await updateMember(detail.member.id, { status: next, ...(reason ? { reason } : {}) }, token);
      setStatusReason('');
      await refresh(detail.member.id);
    } catch (err) {
      setMutationError(errorLine(toStaffError(err).code));
    } finally {
      setSaving(false);
    }
  }, [token, detail, refresh, statusReason]);

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

  // A staff-holding member may only be suspended/reactivated by a caller who
  // outranks their role (server: 403 insufficient_rank). Tier changes and
  // coach assignment are NOT rank-checked.
  const targetStaffRole = detail?.member.staffRole ?? null;
  const statusLocked =
    targetStaffRole !== null &&
    (staffRole === null || !canManageRole(staffRole, targetStaffRole));

  // Per-action permission gating (RBAC §1.4). The screen is reached with
  // `members.read`, but the three privileged controls each require their own
  // key — a support_admin (members.read only) must not be shown Change tier
  // (subscription.override), Assign coach (coach.assign) or Suspend
  // (members.suspend) as available actions. Server enforces too; this stops the
  // client from presenting forbidden actions that only 403 on tap.
  const canChangeTier = staffCan(staffPermissions, 'subscription.override');
  const canAssignCoach = staffCan(staffPermissions, 'coach.assign');
  const canSuspend = staffCan(staffPermissions, 'members.suspend');
  const canAnyAction = canChangeTier || canAssignCoach || canSuspend;

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
      </Animated.View>

      <ScreenHeader eyebrow="Admin console" title="Members" style={styles.header} />

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

      {loading && members.length === 0 ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error && members.length === 0 ? (
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

      {/* A failed "Load more" keeps the already-loaded rows on screen — only
          the initial-load failure (above) replaces the whole list. */}
      {error && members.length > 0 ? (
        <View style={styles.loadMoreErrorRow}>
          <AppText variant="caption" center color={colors.textDim}>
            {error}
          </AppText>
        </View>
      ) : null}

      {cursor && members.length > 0 ? (
        <Button
          label="Load more"
          variant="secondary"
          onPress={() => void loadMoreList()}
          loading={loadingMore}
          style={styles.loadMoreBtn}
        />
      ) : null}

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
              {isLapsed(detail.member.tier, readTierExpiresAt(detail.member)) ? (
                <Tag label="Lapsed" variant="outline" color={colors.warning} />
              ) : null}
              <Tag
                label={suspended ? 'Suspended' : 'Active'}
                variant="outline"
                color={suspended ? colors.error : colors.success}
              />
              {targetStaffRole !== null ? (
                <Tag label={roleLabel(targetStaffRole)} variant="dim" />
              ) : null}
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

            {/* Actions — each control is additionally gated on its own
                permission key (not just `members.read`), so a role that can
                view members but not mutate them (e.g. support_admin) never
                sees a forbidden action presented as available. */}
            <View style={styles.actions}>
              {canChangeTier ? (
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
              ) : null}

              {canAssignCoach ? (
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
              ) : null}

              {canSuspend ? (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={suspended ? 'Reactivate member' : 'Suspend member'}
                  accessibilityState={{ disabled: saving || statusLocked }}
                  disabled={saving || statusLocked}
                  onPress={() => {
                    setStatusReason('');
                    setStatusConfirm(true);
                  }}
                  style={[styles.action, (saving || statusLocked) && styles.actionDisabled]}
                >
                  <Ionicons
                    name={
                      statusLocked
                        ? 'lock-closed'
                        : suspended
                          ? 'play-circle-outline'
                          : 'pause-circle-outline'
                    }
                    size={18}
                    color={
                      statusLocked
                        ? colors.textDim
                        : suspended
                          ? colors.success
                          : colors.error
                    }
                  />
                  <AppText
                    variant="body"
                    color={
                      statusLocked
                        ? colors.textDim
                        : suspended
                          ? colors.success
                          : colors.error
                    }
                  >
                    {suspended ? 'Reactivate' : 'Suspend'}
                  </AppText>
                </PressableScale>
              ) : null}

              {canSuspend && statusLocked ? (
                <AppText variant="caption" color={colors.textFaint}>
                  Staff account — managed by a higher admin.
                </AppText>
              ) : null}

              {!canAnyAction ? (
                <AppText variant="caption" color={colors.textFaint}>
                  You have view-only access to this member.
                </AppText>
              ) : null}
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

      {/* ── Suspend / reactivate confirm ──
          G13: a plain yes/no ConfirmDialog can't collect a reason, so this
          uses a Sheet instead — the server-audited action (updateMember's
          `reason?: string`) now actually gets one. */}
      <Sheet
        visible={statusConfirm}
        onClose={() => setStatusConfirm(false)}
        title={suspended ? 'Reactivate member?' : 'Suspend member?'}
      >
        <View style={styles.sheetBody}>
          <AppText variant="body" color={colors.textDim}>
            {suspended
              ? 'They will regain access to their account immediately.'
              : 'They will lose access until reactivated.'}
          </AppText>
          <AppTextInput
            value={statusReason}
            onChangeText={setStatusReason}
            placeholder="Reason (optional, audited)"
            multiline
            maxLength={300}
            style={styles.reasonInput}
          />
          <View style={styles.decisionButtons}>
            <Button
              label="Cancel"
              variant="secondary"
              style={styles.decisionBtn}
              onPress={() => setStatusConfirm(false)}
            />
            <Button
              label={suspended ? 'Reactivate' : 'Suspend'}
              variant="danger"
              style={styles.decisionBtn}
              onPress={() => void toggleStatus()}
            />
          </View>
        </View>
      </Sheet>

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
    case 'insufficient_rank':
      return 'Only a higher admin can change this staff account.';
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
  header: { marginBottom: spacing.gutter },
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
  loadMoreErrorRow: { paddingTop: spacing.sm, paddingBottom: spacing.xs },
  loadMoreBtn: { marginTop: spacing.sm },
  // Charcoal list row (brief §11c): fill contrast, no hairline borders.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
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
  reasonInput: {
    minHeight: 72,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  decisionButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  decisionBtn: { flex: 1 },
  statusTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
  // Raised option rows with gaps replace hairline separators (brief §11c).
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: touch.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  coachOptionText: { flex: 1, gap: 2, minWidth: 0, paddingRight: spacing.md },
});
