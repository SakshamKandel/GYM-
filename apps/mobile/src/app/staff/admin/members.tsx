import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Share, StyleSheet, Text, View } from 'react-native';
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
  forceSignOutMember,
  exportCsvToFile,
  gdprAnonymizeMember,
  generateResetLink,
  getCoaches,
  getMemberDetail,
  getMembers,
  toStaffError,
  updateMember,
  updateMemberIdentity,
  type CoachRow,
  type MemberDetail,
  type MemberRow,
  type MemberStatus,
  type Tier,
} from '../../../features/staff/api';
import { pushStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { ReauthSheet, useReauth } from '../../../features/staff/ReauthGate';
import { roleLabel } from '../../../features/staff/roles';
import { useAuth } from '../../../state/auth';

/**
 * P1-7 client contract (M2 owns features/staff/api.ts — coded against the
 * EXACT export names from its brief; shapes are this screen's best-effort
 * guess at the idiomatic server contract and may need reconciling at the
 * integration gate if M2 lands a different shape):
 *   generateResetLink(memberId, token) => Promise<{ resetUrl: string; expiresAt: string }>
 *   forceSignOutMember(memberId, token) => Promise<void>
 *   updateMemberIdentity(memberId, { email?, displayName? }, token) => Promise<MemberAccount>
 *   gdprAnonymizeMember(memberId, token) => Promise<void> — the "typed confirm"
 *     is a CLIENT-side gate (type the member's email) before the button
 *     enables; nothing beyond the id crosses the wire.
 *   exportCsvToFile(kind, token) => Promise<string> — downloads the CSV
 *     straight to a local file (native-side streaming; never buffered into
 *     one JS string) and returns its `file://` URI, shared via the OS share
 *     sheet (RN's built-in Share — no expo-sharing dependency exists in this
 *     app; the on-device path is the copy-path fallback when the share sheet
 *     is unavailable/dismissed).
 */

/** Best-effort share; on failure (dismissed / unsupported) the caller keeps
 * the link visible as selectable text so the admin can copy it by hand. */
async function shareLink(message: string): Promise<void> {
  try {
    await Share.share({ message });
  } catch {
    // Share sheet dismissed or unavailable — nothing further to do; the
    // link stays on screen as the copy-link fallback.
  }
}

/** Like shareLink, but for a local file URI — passed via `url` so iOS
 * attaches the actual file instead of sharing it as a text message. */
async function shareFile(uri: string): Promise<void> {
  try {
    await Share.share({ url: uri });
  } catch {
    // Share sheet dismissed or unavailable — the file stays on-device; its
    // path stays on screen as the copy-path fallback.
  }
}

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
  // Step-up (plan §3 #14): reset-link minting, force sign-out, identity edit,
  // and GDPR anonymize are account-takeover / irreversible-data actions —
  // same step-up gate as staff.tsx's role grant/revoke and subscriptions.tsx's
  // tier override, just newly wired here (defect: these P1-7 actions used to
  // fire on a bare confirm with no fresh password re-entry).
  const reauth = useReauth();

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

  // ── P1-7: member lifecycle tools (reset link / force sign-out / edit
  // identity / GDPR anonymize) — all gated on `members.manage_credentials`. ──
  const [resetLinkOpen, setResetLinkOpen] = useState(false);
  const [resetLinkLoading, setResetLinkLoading] = useState(false);
  const [resetLinkResult, setResetLinkResult] = useState<{
    resetUrl: string;
    expiresAt: string;
  } | null>(null);
  const [resetLinkError, setResetLinkError] = useState<string | null>(null);

  const [signOutConfirm, setSignOutConfirm] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutNotice, setSignOutNotice] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editEmail, setEditEmail] = useState('');
  const [editName, setEditName] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [gdprOpen, setGdprOpen] = useState(false);
  const [gdprConfirmText, setGdprConfirmText] = useState('');
  const [gdprSaving, setGdprSaving] = useState(false);
  const [gdprError, setGdprError] = useState<string | null>(null);
  const [gdprDone, setGdprDone] = useState(false);

  // P1-10: CSV export of the member directory, shared via the OS share sheet.
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  // Fallback when the native share sheet is dismissed/unavailable — RN's
  // Share.share() resolves normally on dismissal (it doesn't throw), so
  // without this the exported link would be silently lost. Mirrors the
  // csvLink block in audit.tsx/wallets.tsx/payments.tsx.
  const [csvLink, setCsvLink] = useState<string | null>(null);

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
    setAssignOverrideFor(null);
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
    setAssignOverrideFor(null);
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

  // assignClient `force` (plan §7 "assignClient force"): the server 409s
  // {error:'full'} when the picked coach is at their roster capacity. Rather
  // than dead-end on a generic error, arm a one-shot override for THAT exact
  // coach — tapping the same coach again resends with force:true. Any other
  // pick, or reopening the picker fresh, clears the arm so a stale override
  // can never silently apply to a different coach.
  const [assignOverrideFor, setAssignOverrideFor] = useState<string | null>(null);

  const assignCoach = useCallback(
    async (coach: CoachRow) => {
      if (!token || !detail) return;
      const force = assignOverrideFor === coach.id;
      setCoachPickerOpen(false);
      setSaving(true);
      try {
        await assignClient(coach.id, detail.member.id, token, force);
        setAssignOverrideFor(null);
        await refresh(detail.member.id);
      } catch (err) {
        const code = toStaffError(err).code;
        if (code === 'full' && !force) {
          // Leave the picker reachable so the admin can tap the same coach
          // again to force it — re-fetching isn't needed, `coaches` is fresh.
          setAssignOverrideFor(coach.id);
          setCoachPickerOpen(true);
          setMutationError(
            'That coach is at their client capacity. Tap them again to assign anyway.',
          );
        } else {
          setAssignOverrideFor(null);
          setMutationError(errorLine(code));
        }
      } finally {
        setSaving(false);
      }
    },
    [token, detail, refresh, assignOverrideFor],
  );

  // ── P1-7 handlers ─────────────────────────────────────────────
  function openResetLink(): void {
    setResetLinkOpen(true);
    setResetLinkResult(null);
    setResetLinkError(null);
    void (async () => {
      if (!token || !detail) return;
      setResetLinkLoading(true);
      try {
        const result = await generateResetLink(detail.member.id, token);
        setResetLinkResult(result);
      } catch (err) {
        setResetLinkError(errorLine(toStaffError(err).code));
      } finally {
        setResetLinkLoading(false);
      }
    })();
  }

  async function doForceSignOut(): Promise<void> {
    setSignOutConfirm(false);
    if (!token || !detail) return;
    setSignOutBusy(true);
    setSignOutNotice(null);
    try {
      await forceSignOutMember(detail.member.id, token);
      setSignOutNotice('Signed out on every device.');
    } catch (err) {
      setMutationError(errorLine(toStaffError(err).code));
    } finally {
      setSignOutBusy(false);
    }
  }

  function openEdit(): void {
    if (!detail) return;
    setEditEmail(detail.member.email);
    setEditName(detail.member.displayName);
    setEditError(null);
    setEditOpen(true);
  }

  async function saveEdit(): Promise<void> {
    if (!token || !detail) return;
    const email = editEmail.trim();
    const displayName = editName.trim();
    if (!email || !displayName) {
      setEditError('Email and name cannot be empty.');
      return;
    }
    const patch: { email?: string; displayName?: string } = {};
    if (email !== detail.member.email) patch.email = email;
    if (displayName !== detail.member.displayName) patch.displayName = displayName;
    if (Object.keys(patch).length === 0) {
      setEditOpen(false);
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await updateMemberIdentity(detail.member.id, patch, token);
      setEditOpen(false);
      await refresh(detail.member.id);
    } catch (err) {
      setEditError(errorLine(toStaffError(err).code));
    } finally {
      setEditSaving(false);
    }
  }

  function openGdpr(): void {
    setGdprConfirmText('');
    setGdprError(null);
    setGdprDone(false);
    setGdprOpen(true);
  }

  const gdprConfirmMatches =
    detail !== null && gdprConfirmText.trim().toLowerCase() === detail.member.email.toLowerCase();

  async function doGdprAnonymize(): Promise<void> {
    if (!token || !detail || !gdprConfirmMatches) return;
    setGdprSaving(true);
    setGdprError(null);
    try {
      await gdprAnonymizeMember(detail.member.id, token);
      setGdprDone(true);
      // The account no longer resolves to a normal member row after
      // anonymization — close out and refresh the LIST rather than the
      // (now-gone) detail sheet.
      setTimeout(() => {
        setGdprOpen(false);
        closeSheet();
        void loadList(query);
      }, 900);
    } catch (err) {
      setGdprError(errorLine(toStaffError(err).code));
    } finally {
      setGdprSaving(false);
    }
  }

  async function exportMembersCsv(): Promise<void> {
    if (!token || csvBusy) return;
    setCsvBusy(true);
    setCsvError(null);
    try {
      const uri = await exportCsvToFile('members', token);
      setCsvLink(uri);
      await shareFile(uri);
    } catch (err) {
      setCsvError(errorLine(toStaffError(err).code));
    } finally {
      setCsvBusy(false);
    }
  }

  const suspended = detail?.member.status === 'suspended';

  // A staff-holding member's tier AND suspend/reactivate status may only be
  // changed by a caller who outranks their role (server: PATCH
  // /api/admin/members/[id] runs requireOutranks for BOTH the `tier` and
  // `status` fields — P1-13: this screen used to gate only Suspend on
  // statusLocked, so tapping "Change tier" against a protected staff row was
  // a guaranteed 403-trap). Coach assignment is NOT rank-checked.
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
  // P1-7: reset link / force sign-out / identity edit / GDPR anonymize.
  const canManageCredentials = staffCan(staffPermissions, 'members.manage_credentials');
  const canAnyAction = canChangeTier || canAssignCoach || canSuspend || canManageCredentials;
  // P1-10: CSV export of the directory — same read gate as the list itself.
  const canExportCsv = staffCan(staffPermissions, 'members.read');

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

      <ScreenHeader
        eyebrow="Admin console"
        title="Members"
        style={styles.header}
        action={
          canExportCsv ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Export members as CSV"
              accessibilityState={{ disabled: csvBusy }}
              disabled={csvBusy}
              onPress={() => void exportMembersCsv()}
              style={styles.headerActionBtn}
            >
              {csvBusy ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Ionicons name="download-outline" size={20} color={colors.text} />
              )}
            </PressableScale>
          ) : undefined
        }
      />

      {csvError ? (
        <AppText variant="caption" color={colors.error} style={styles.csvErrorText}>
          {csvError}
        </AppText>
      ) : null}

      {csvLink ? (
        <View style={styles.csvLinkBlock}>
          <AppText variant="caption" color={colors.textDim}>
            Export saved on this device (long-press to copy the file path if the share sheet
            didn&apos;t open):
          </AppText>
          <Text selectable style={styles.selectableLink}>
            {csvLink}
          </Text>
          <Button label="Dismiss" variant="secondary" onPress={() => setCsvLink(null)} />
        </View>
      ) : null}

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
                  accessibilityState={{ disabled: saving || statusLocked }}
                  disabled={saving || statusLocked}
                  onPress={() => setTierPickerOpen(true)}
                  style={[styles.action, (saving || statusLocked) && styles.actionDisabled]}
                >
                  <Ionicons
                    name={statusLocked ? 'lock-closed' : 'pricetag-outline'}
                    size={18}
                    color={statusLocked ? colors.textDim : colors.text}
                  />
                  <AppText variant="body" color={statusLocked ? colors.textDim : colors.text}>
                    Change tier
                  </AppText>
                  {statusLocked ? null : (
                    <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
                  )}
                </PressableScale>
              ) : null}

              {canChangeTier && statusLocked ? (
                <AppText variant="caption" color={colors.textFaint}>
                  Staff account — managed by a higher admin.
                </AppText>
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

              {/* P1-7: member lifecycle tools — all gated members.manage_credentials. */}
              {canManageCredentials ? (
                <>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="Generate a password reset link"
                    disabled={saving || statusLocked}
                    onPress={() => reauth.guard(openResetLink)}
                    style={[styles.action, (saving || statusLocked) && styles.actionDisabled]}
                  >
                    <Ionicons name="key-outline" size={18} color={colors.text} />
                    <AppText variant="body" color={colors.text}>
                      Generate reset link
                    </AppText>
                    <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
                  </PressableScale>

                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="Force sign-out on every device"
                    disabled={saving || signOutBusy || statusLocked}
                    onPress={() => {
                      setSignOutNotice(null);
                      setSignOutConfirm(true);
                    }}
                    style={[
                      styles.action,
                      (saving || signOutBusy || statusLocked) && styles.actionDisabled,
                    ]}
                  >
                    <Ionicons name="log-out-outline" size={18} color={colors.text} />
                    <AppText variant="body" color={colors.text}>
                      Force sign-out everywhere
                    </AppText>
                    {signOutBusy ? (
                      <ActivityIndicator size="small" color={colors.textDim} />
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
                    )}
                  </PressableScale>

                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="Edit email and name"
                    disabled={saving || statusLocked}
                    onPress={openEdit}
                    style={[styles.action, (saving || statusLocked) && styles.actionDisabled]}
                  >
                    <Ionicons name="create-outline" size={18} color={colors.text} />
                    <AppText variant="body" color={colors.text}>
                      Edit email &amp; name
                    </AppText>
                    <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
                  </PressableScale>

                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="Anonymize this member (GDPR)"
                    disabled={saving || statusLocked}
                    onPress={openGdpr}
                    style={[styles.action, (saving || statusLocked) && styles.actionDisabled]}
                  >
                    <Ionicons name="trash-bin-outline" size={18} color={colors.error} />
                    <AppText variant="body" color={colors.error}>
                      Anonymize (GDPR)
                    </AppText>
                    <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
                  </PressableScale>

                  {signOutNotice ? (
                    <AppText variant="caption" color={colors.success}>
                      {signOutNotice}
                    </AppText>
                  ) : null}
                  {canManageCredentials && statusLocked ? (
                    <AppText variant="caption" color={colors.textFaint}>
                      Staff account — credentials tools are locked here too.
                    </AppText>
                  ) : null}
                </>
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

      {/* ── Force sign-out confirm ── */}
      <ConfirmDialog
        visible={signOutConfirm}
        title="Sign out everywhere?"
        message="Every device this member is signed into loses access immediately. Their account isn't suspended — they can sign back in right away."
        confirmLabel="Sign out"
        cancelLabel="Cancel"
        danger
        onConfirm={() => reauth.guard(() => void doForceSignOut())}
        onCancel={() => setSignOutConfirm(false)}
      />

      {/* ── Password reset link (P1-7) ── */}
      <Sheet visible={resetLinkOpen} onClose={() => setResetLinkOpen(false)} title="Reset link">
        <View style={styles.sheetBody}>
          {resetLinkLoading ? (
            <View style={styles.sheetCentre}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : resetLinkError ? (
            <>
              <AppText variant="caption" color={colors.textDim}>
                {resetLinkError}
              </AppText>
              <Button
                label="Retry"
                variant="secondary"
                onPress={() => reauth.guard(openResetLink)}
              />
            </>
          ) : resetLinkResult ? (
            <>
              <AppText variant="caption" color={colors.textDim}>
                Send this one-time link to the member — no email is sent
                automatically. It expires{' '}
                {new Date(resetLinkResult.expiresAt).toLocaleString()}.
              </AppText>
              {/* Plain, selectable RN Text (not AppText) so the admin can
                  long-press to copy as a fallback when the share sheet is
                  unavailable/dismissed. */}
              <Text selectable style={styles.selectableLink}>
                {resetLinkResult.resetUrl}
              </Text>
              <Button
                label="Share link"
                onPress={() => void shareLink(resetLinkResult.resetUrl)}
              />
            </>
          ) : null}
        </View>
      </Sheet>

      {/* ── Edit email / name (P1-7) ── */}
      <Sheet visible={editOpen} onClose={() => setEditOpen(false)} title="Edit member">
        <View style={styles.sheetBody}>
          <AppText variant="label">Email</AppText>
          <AppTextInput
            value={editEmail}
            onChangeText={setEditEmail}
            placeholder="Email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            editable={!editSaving}
          />
          <AppText variant="label">Display name</AppText>
          <AppTextInput
            value={editName}
            onChangeText={setEditName}
            placeholder="Display name"
            maxLength={120}
            editable={!editSaving}
          />
          {editError ? (
            <AppText variant="caption" color={colors.error}>
              {editError}
            </AppText>
          ) : null}
          <View style={styles.decisionButtons}>
            <Button
              label="Cancel"
              variant="secondary"
              style={styles.decisionBtn}
              disabled={editSaving}
              onPress={() => setEditOpen(false)}
            />
            <Button
              label="Save"
              style={styles.decisionBtn}
              loading={editSaving}
              disabled={editSaving || !editEmail.trim() || !editName.trim()}
              onPress={() => reauth.guard(() => void saveEdit())}
            />
          </View>
        </View>
      </Sheet>

      {/* ── GDPR anonymize (P1-7) — typed confirm: the admin must type the
          member's exact email before the button enables. ── */}
      <Sheet visible={gdprOpen} onClose={() => setGdprOpen(false)} title="Anonymize member">
        <View style={styles.sheetBody}>
          {gdprDone ? (
            <AppText variant="body" color={colors.success}>
              This member's personal data has been anonymized.
            </AppText>
          ) : (
            <>
              <AppText variant="body" color={colors.textDim}>
                This permanently scrubs {detail?.member.email ?? 'this member'}&apos;s
                personal data (GDPR right-to-erasure). It cannot be undone. Type
                their email address to confirm.
              </AppText>
              <AppTextInput
                value={gdprConfirmText}
                onChangeText={setGdprConfirmText}
                placeholder={detail?.member.email ?? 'member@example.com'}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                editable={!gdprSaving}
              />
              {gdprError ? (
                <AppText variant="caption" color={colors.error}>
                  {gdprError}
                </AppText>
              ) : null}
              <View style={styles.decisionButtons}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  style={styles.decisionBtn}
                  disabled={gdprSaving}
                  onPress={() => setGdprOpen(false)}
                />
                <Button
                  label="Anonymize"
                  variant="danger"
                  style={styles.decisionBtn}
                  loading={gdprSaving}
                  disabled={gdprSaving || !gdprConfirmMatches}
                  onPress={() => reauth.guard(() => void doGdprAnonymize())}
                />
              </View>
            </>
          )}
        </View>
      </Sheet>

      {/* Step-up password prompt for reset link / force sign-out / edit / GDPR
          anonymize (plan §3 #14). */}
      <ReauthSheet controller={reauth} />
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
    case 'full':
      return "That coach is at their client capacity.";
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
