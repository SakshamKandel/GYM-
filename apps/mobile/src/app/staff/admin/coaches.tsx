import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
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
  IconChip,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Sheet,
  Tag,
} from '../../../components/ui';
import {
  assignClient,
  cancelCoachRequest,
  endAssignment,
  getCoaches,
  getCoachRequestsOversight,
  getMemberDetail,
  getMembers,
  toStaffError,
  type CoachRow,
  type MemberRow,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { pushStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * P1-8 client contract (M2 owns features/staff/api.ts — coded against the
 * EXACT export names from its brief; the row shape below is this screen's
 * best-effort guess and may need reconciling at the integration gate):
 *   getCoachRequestsOversight(token) => Promise<CoachRequestOversightRow[]>
 *   cancelCoachRequest(id, token) => Promise<void>
 * Gated `moderation.manage` (W2's server brief) — independent of `coach.assign`,
 * so a content_admin who can't open the roster can still oversee the queue.
 */
interface CoachRequestOversightRow {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  coachId: string;
  coachDisplayName: string;
  ageDays: number;
  createdAt: string;
}

/**
 * Admin · Coaches — the coach roster with per-coach client management.
 *
 * The top level lists every coach (getCoaches) with their active-client count.
 * Tapping a coach opens a detail view where an admin can search the member
 * directory (getMembers) and, per result, either ASSIGN them to this coach or
 * END their assignment — whichever applies. Assignment linkage isn't on the
 * member list rows (only on member detail), so when a result is selected we
 * fetch getMemberDetail to learn the member's current coach and offer the
 * correct action. Every mutation refetches so counts stay accurate.
 *
 * Block language (REVAMP-BRIEF): back row → ScreenHeader (meta chips carry the
 * coach's status) → charcoal rows with Oswald client counts, no card borders.
 */

const ERR_TEXT: Record<StaffErrorCode, string> = {
  unauthorized: 'Your session expired. Sign in again.',
  forbidden: "You don't have access to this.",
  insufficient_rank: 'Only a higher admin can do that.',
  not_found: 'Not found.',
  invalid: "That didn't work.",
  cannot_target_self: "You can't change your own role.",
  cannot_revoke_self: "You can't revoke your own access.",
  full: "That coach's roster is at capacity.",
  conflict: 'That conflicts with the current state.',
  account_deletion_blocked: 'Account deletion is blocked by active or retained dependencies.',
  private_asset_cleanup_pending: 'Private asset cleanup is still pending.',
  account_deletion_conflict: 'The account changed while deletion was starting.',
  already_pending: 'There is already a pending request.',
  not_an_upgrade: "That isn't higher than the current tier.",
  confirm_required: 'This needs an explicit confirmation first.',
  already_refunded: 'That payment was already refunded.',
  not_approved: 'That payment is no longer approved.',
  non_refundable: 'That can no longer be refunded.',
  insufficient_balance: "That would take the coach's balance negative.",
  not_configured: 'This feature is not set up yet.',
  network: "Couldn't reach the server.",
  rate_limited: 'Too many requests — wait a moment and try again.',
};

function coachDisplay(c: CoachRow): string {
  return c.coachName?.trim() || c.displayName.trim() || c.email;
}

function memberName(m: { displayName: string; email: string }): string {
  return m.displayName.trim() || m.email;
}

// ── Quiet retry line ──────────────────────────────────────────
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

// ════════════════════════════════════════════════════════════════
// Coach detail — assign / unassign clients
// ════════════════════════════════════════════════════════════════

/** A search result with its resolved assignment state (loaded on expand). */
interface ResultState {
  loading: boolean;
  /** Assignment id when this member is CURRENTLY coached by THIS coach. */
  assignmentIdForThisCoach: string | null;
  /** Display name of the member's coach, when assigned to someone else. */
  otherCoachName: string | null;
  error: string | null;
}

function CoachDetail({
  coach,
  token,
  onBack,
  onMutated,
}: {
  coach: CoachRow;
  token: string;
  onBack: () => void;
  onMutated: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemberRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Per-member resolved assignment state, keyed by member id.
  const [states, setStates] = useState<Record<string, ResultState>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ending, setEnding] = useState<{ member: MemberRow; assignmentId: string } | null>(
    null,
  );
  // Read-only quick-view sheet (defect G3): the row used to push
  // `/staff/admin/members/[id]`, a route that has never existed → an
  // Unmatched-route screen. Assign/End are already inline on the row, so this
  // sheet only needs to surface identity + assignment state, not host
  // mutations (full member management lives in the Members console).
  const [viewing, setViewing] = useState<MemberRow | null>(null);

  // Monotonic request id (defect G8/#4): without it, a slower-to-resolve
  // search for an earlier query can land AFTER a newer query's results are
  // already rendered, silently reverting the visible list to results for a
  // query the admin no longer has in the search box.
  const searchReqSeq = useRef(0);

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      const reqId = ++searchReqSeq.current;
      if (!trimmed) {
        setResults([]);
        setSearchError(null);
        return;
      }
      setSearching(true);
      setSearchError(null);
      try {
        const data = await getMembers(token, trimmed);
        if (reqId !== searchReqSeq.current) return; // superseded by a newer query
        setResults(data.members);
      } catch (e) {
        if (reqId !== searchReqSeq.current) return;
        setSearchError(ERR_TEXT[toStaffError(e).code]);
      } finally {
        if (reqId === searchReqSeq.current) setSearching(false);
      }
    },
    [token],
  );

  // Light debounce so we don't fire on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => void runSearch(query), 300);
    return () => clearTimeout(handle);
  }, [query, runSearch]);

  // Resolve a member's current coach so we know whether to assign or end.
  const resolveState = useCallback(
    async (memberId: string) => {
      setStates((prev) => ({
        ...prev,
        [memberId]: {
          loading: true,
          assignmentIdForThisCoach: null,
          otherCoachName: null,
          error: null,
        },
      }));
      try {
        const detail = await getMemberDetail(memberId, token);
        const linked = detail.coach;
        setStates((prev) => ({
          ...prev,
          [memberId]: {
            loading: false,
            assignmentIdForThisCoach:
              linked && linked.coachId === coach.id ? linked.assignmentId : null,
            otherCoachName:
              linked && linked.coachId !== coach.id
                ? memberName(linked)
                : null,
            error: null,
          },
        }));
      } catch (e) {
        setStates((prev) => ({
          ...prev,
          [memberId]: {
            loading: false,
            assignmentIdForThisCoach: null,
            otherCoachName: null,
            error: ERR_TEXT[toStaffError(e).code],
          },
        }));
      }
    },
    [coach.id, token],
  );

  // Whenever the result set changes, resolve each row's assignment state.
  useEffect(() => {
    for (const m of results) {
      void resolveState(m.id);
    }
    // Drop stale states for members no longer in the list.
    setStates((prev) => {
      const next: Record<string, ResultState> = {};
      for (const m of results) if (prev[m.id]) next[m.id] = prev[m.id];
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, resolveState]);

  async function doAssign(member: MemberRow): Promise<void> {
    setBusyId(member.id);
    try {
      await assignClient(coach.id, member.id, token);
      await resolveState(member.id);
      onMutated();
    } catch (e) {
      setStates((prev) => ({
        ...prev,
        [member.id]: {
          ...(prev[member.id] ?? {
            loading: false,
            assignmentIdForThisCoach: null,
            otherCoachName: null,
          }),
          loading: false,
          error: ERR_TEXT[toStaffError(e).code],
        },
      }));
    } finally {
      setBusyId(null);
    }
  }

  async function doEnd(): Promise<void> {
    if (!ending) return;
    const target = ending;
    setEnding(null);
    setBusyId(target.member.id);
    try {
      await endAssignment(target.assignmentId, token);
      await resolveState(target.member.id);
      onMutated();
    } catch (e) {
      setStates((prev) => ({
        ...prev,
        [target.member.id]: {
          ...(prev[target.member.id] ?? {
            loading: false,
            assignmentIdForThisCoach: null,
            otherCoachName: null,
          }),
          loading: false,
          error: ERR_TEXT[toStaffError(e).code],
        },
      }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Screen scroll keyboardAware>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back to coaches"
          onPress={onBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>

      <ScreenHeader
        eyebrow={coach.email}
        title={coachDisplay(coach)}
        style={styles.header}
        meta={
          <>
            <Tag
              label={`${coach.activeClients} client${coach.activeClients === 1 ? '' : 's'}`}
              variant="dim"
            />
            {coach.acceptingClients === false ? (
              <Tag label="Not accepting" variant="outline" color={colors.warning} />
            ) : (
              <Tag label="Accepting" variant="outline" color={colors.success} />
            )}
            {coach.isActive === false ? (
              <Tag label="Inactive" variant="outline" color={colors.textDim} />
            ) : null}
          </>
        }
      />

      <SectionLabel>Manage clients</SectionLabel>
      <AppTextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search members by email"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
      />
      <AppText variant="caption" color={colors.textFaint} style={styles.hint}>
        Find a member to assign them to this coach — or end their current
        assignment.
      </AppText>

      {searchError ? (
        <View style={styles.retryWrap}>
          <RetryLine message={searchError} onRetry={() => void runSearch(query)} />
        </View>
      ) : null}

      {searching ? (
        <View style={styles.searchingRow}>
          <ActivityIndicator color={colors.textDim} />
        </View>
      ) : null}

      {!searching && query.trim() && results.length === 0 && !searchError ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.emptyLine}>
          No members match “{query.trim()}”.
        </AppText>
      ) : null}

      <View style={styles.list}>
        {results.map((m) => {
          const st = states[m.id];
          const isBusy = busyId === m.id;
          const isMine = !!st && st.assignmentIdForThisCoach !== null;
          return (
            <View key={m.id} style={styles.memberRow}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`View ${memberName(m)}`}
                onPress={() => setViewing(m)}
                style={styles.memberText}
              >
                <AppText variant="bodyBold" numberOfLines={1}>
                  {memberName(m)}
                </AppText>
                <AppText variant="caption" numberOfLines={1}>
                  {st?.loading
                    ? 'Checking…'
                    : isMine
                      ? 'Assigned to this coach'
                      : st?.otherCoachName
                        ? `Coach: ${st.otherCoachName}`
                        : m.email}
                </AppText>
                {st?.error ? (
                  <AppText variant="caption" color={colors.error} numberOfLines={1}>
                    {st.error}
                  </AppText>
                ) : null}
              </PressableScale>

              <View style={styles.rowRight}>
                <Tag label={m.tier} variant="dim" />
                {st?.loading ? (
                  <ActivityIndicator color={colors.textDim} style={styles.rowSpinner} />
                ) : isMine ? (
                  <Button
                    label="End"
                    variant="danger"
                    onPress={() =>
                      setEnding({
                        member: m,
                        assignmentId: st.assignmentIdForThisCoach as string,
                      })
                    }
                    disabled={isBusy}
                    loading={isBusy}
                    style={styles.rowBtn}
                  />
                ) : (
                  <Button
                    label="Assign"
                    variant="secondary"
                    onPress={() => void doAssign(m)}
                    disabled={isBusy || m.status === 'suspended'}
                    loading={isBusy}
                    style={styles.rowBtn}
                  />
                )}
              </View>
            </View>
          );
        })}
      </View>

      {!query.trim() ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.footNote}>
          Reassigning a member who already has a coach moves them to this coach
          automatically.
        </AppText>
      ) : null}

      <ConfirmDialog
        visible={ending !== null}
        title="End assignment?"
        message={
          ending
            ? `Remove ${memberName(ending.member)} from ${coachDisplay(coach)}'s client list?`
            : undefined
        }
        confirmLabel="End"
        cancelLabel="Cancel"
        danger
        onConfirm={() => void doEnd()}
        onCancel={() => setEnding(null)}
      />

      {/* ── Member quick-view (replaces the dead /staff/admin/members/[id] push) ── */}
      <Sheet
        visible={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing ? memberName(viewing) : 'Member'}
      >
        {viewing ? (
          <View style={styles.viewSheetBody}>
            <AppText variant="caption" numberOfLines={1}>
              {viewing.email}
            </AppText>
            <View style={styles.statusTags}>
              <Tag label={viewing.tier} variant="outline" />
              {viewing.status === 'suspended' ? (
                <Tag label="Suspended" variant="outline" color={colors.error} />
              ) : null}
            </View>
            <AppText variant="caption" color={colors.textDim}>
              {states[viewing.id]?.loading
                ? 'Checking coach assignment…'
                : states[viewing.id]?.assignmentIdForThisCoach
                  ? `Assigned to ${coachDisplay(coach)}.`
                  : states[viewing.id]?.otherCoachName
                    ? `Currently coached by ${states[viewing.id]?.otherCoachName}.`
                    : 'No coach currently assigned.'}
            </AppText>
            <AppText variant="caption" color={colors.textFaint} style={styles.viewSheetHint}>
              For tier changes, suspension or full profile detail, use the
              Members console.
            </AppText>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

// ════════════════════════════════════════════════════════════════
// P1-8: pending coach_requests oversight (moderation.manage)
// ════════════════════════════════════════════════════════════════

/** Short relative age ("3m", "2h", "5d") — mirrors the audit/support screens. */
function relativeAge(iso: string): string {
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
  return `${days}d`;
}

function PendingRequestsOversight({ token }: { token: string }) {
  const [rows, setRows] = useState<CoachRequestOversightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CoachRequestOversightRow | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await getCoachRequestsOversight(token));
    } catch (e) {
      setError(ERR_TEXT[toStaffError(e).code]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function doCancel(): Promise<void> {
    if (!cancelTarget) return;
    const target = cancelTarget;
    setCancelTarget(null);
    setCancelBusy(true);
    try {
      await cancelCoachRequest(target.id, token);
      await load();
    } catch (e) {
      setError(ERR_TEXT[toStaffError(e).code]);
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <Animated.View entering={enterUp(0)} style={styles.oversightBlock}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Pending mentorship requests${rows.length ? `, ${rows.length}` : ''}`}
        onPress={() => setExpanded((v) => !v)}
        style={styles.oversightHeader}
      >
        <SectionLabel>Pending mentorship requests</SectionLabel>
        <View style={styles.oversightHeaderRight}>
          {rows.length > 0 ? <Tag label={String(rows.length)} variant="dim" /> : null}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textDim}
          />
        </View>
      </PressableScale>

      {expanded ? (
        loading ? (
          <View style={styles.searchingRow}>
            <ActivityIndicator color={colors.textDim} />
          </View>
        ) : error ? (
          <RetryLine message={error} onRetry={() => void load()} />
        ) : rows.length === 0 ? (
          <AppText variant="caption" color={colors.textFaint} style={styles.emptyLine}>
            No pending requests.
          </AppText>
        ) : (
          <View style={styles.list}>
            {rows.map((r) => (
              <View key={r.id} style={styles.memberRow}>
                <View style={styles.memberText}>
                  <AppText variant="bodyBold" numberOfLines={1}>
                    {r.displayName || r.email}
                  </AppText>
                  <AppText variant="caption" numberOfLines={1}>
                    Requested {r.coachDisplayName} · {relativeAge(r.createdAt)} ago
                  </AppText>
                </View>
                <Button
                  label="Cancel"
                  variant="danger"
                  onPress={() => setCancelTarget(r)}
                  disabled={cancelBusy}
                  style={styles.rowBtn}
                />
              </View>
            ))}
          </View>
        )
      ) : null}

      <ConfirmDialog
        visible={cancelTarget !== null}
        title="Cancel this request?"
        message={
          cancelTarget
            ? `${cancelTarget.displayName || cancelTarget.email}'s pending request to ${cancelTarget.coachDisplayName} will be closed.`
            : undefined
        }
        confirmLabel="Cancel request"
        cancelLabel="Keep it"
        danger
        onConfirm={() => void doCancel()}
        onCancel={() => setCancelTarget(null)}
      />
    </Animated.View>
  );
}

// ════════════════════════════════════════════════════════════════
// Coach roster
// ════════════════════════════════════════════════════════════════

export default function AdminCoachesScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  // Per-screen permission gate (RBAC §1.4) — mirrors the peer admin screens
  // (promos/pricing/wallets/…). content_admin/support_admin are admitted into
  // the admin console but hold no `coach.assign`, so without this they'd render
  // the roster and immediately 403 on getCoaches. Fail closed to a locked view.
  const allowed = staffCan(staffPermissions, 'coach.assign');
  // P1-8: oversight of the pending mentorship-request queue is independent of
  // roster access — a content_admin holding only moderation.manage should
  // still be able to see and cancel stale requests.
  const canModerateRequests = staffCan(staffPermissions, 'moderation.manage');
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CoachRow | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setCoaches(await getCoaches(token));
    } catch (e) {
      setError(ERR_TEXT[toStaffError(e).code]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  // Keep the open coach's row (client count) fresh after a mutation.
  const refreshAndSync = useCallback(async () => {
    if (!token) return;
    try {
      const fresh = await getCoaches(token);
      setCoaches(fresh);
      setSelected((cur) => (cur ? (fresh.find((c) => c.id === cur.id) ?? cur) : cur));
    } catch {
      // Non-fatal: the detail view already reloaded its own row state.
    }
  }, [token]);

  // Fail-closed access gate — a role in the admin console without `coach.assign`
  // (content_admin / support_admin) gets the dedicated locked card the peer
  // screens show, not an ungated roster that 403s on the initial getCoaches.
  if (!allowed) {
    return (
      <Screen scroll>
        <Animated.View entering={enterDown()} style={styles.headerRow}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={onBackToConsole}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </PressableScale>
        </Animated.View>
        <ScreenHeader eyebrow="Admin console" title="Coaches" style={styles.header} />
        {canModerateRequests && token ? (
          <PendingRequestsOversight token={token} />
        ) : (
          <Animated.View entering={enterUp(0)} style={styles.locked}>
            <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
            <AppText variant="caption" center color={colors.textFaint}>
              You don&apos;t have access to coach management.
            </AppText>
          </Animated.View>
        )}
      </Screen>
    );
  }

  if (selected && token) {
    return (
      <CoachDetail
        coach={selected}
        token={token}
        onBack={() => setSelected(null)}
        onMutated={() => void refreshAndSync()}
      />
    );
  }

  return (
    <Screen scroll>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBackToConsole}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>

      <ScreenHeader eyebrow="Admin console" title="Coaches" style={styles.header} />

      {canModerateRequests && token ? <PendingRequestsOversight token={token} /> : null}

      {loading ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.retryWrap}>
          <RetryLine message={error} onRetry={() => void load()} />
        </View>
      ) : coaches.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.emptyLine}>
          No coaches yet. Promote a member to coach in Staff &amp; roles.
        </AppText>
      ) : (
        <View style={styles.list}>
          {coaches.map((c, i) => (
            <Animated.View key={c.id} entering={enterUp(i)}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Open ${coachDisplay(c)}`}
                onPress={() => setSelected(c)}
                style={styles.coachRow}
              >
                <IconChip icon="person" iconColor={colors.accent} />
                <View style={styles.coachText}>
                  <AppText variant="bodyBold" numberOfLines={1}>
                    {coachDisplay(c)}
                  </AppText>
                  <AppText variant="caption" numberOfLines={1}>
                    {c.email}
                  </AppText>
                </View>
                <View style={styles.coachMeta}>
                  <AppText variant="display" style={styles.clientCount}>
                    {c.activeClients}
                  </AppText>
                  <AppText variant="label">
                    {c.activeClients === 1 ? 'client' : 'clients'}
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
              </PressableScale>
            </Animated.View>
          ))}
        </View>
      )}
    </Screen>
  );
}

// Leaving the coaches list returns to wherever we came from (admin console).
function onBackToConsole(): void {
  if (router.canGoBack()) router.back();
  else pushStaff(STAFF_ROUTES.adminHome);
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
  hint: { marginTop: spacing.sm, paddingHorizontal: spacing.xs },
  oversightBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  oversightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: touch.min,
  },
  oversightHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  list: { gap: spacing.md },
  // Charcoal list rows (brief §11c): fill contrast, no hairline borders.
  coachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },
  coachText: { flex: 1, gap: 2 },
  coachMeta: { alignItems: 'center', minWidth: 48 },
  clientCount: { lineHeight: 40 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 64,
  },
  memberText: { flex: 1, gap: 2 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowSpinner: { marginHorizontal: spacing.sm },
  rowBtn: { paddingHorizontal: 16, minHeight: touch.min },
  searchingRow: { paddingVertical: spacing.lg, alignItems: 'center' },
  loadingBlock: { paddingVertical: spacing.xxl, alignItems: 'center' },
  retryWrap: { marginTop: spacing.md },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  emptyLine: { marginTop: spacing.xl, paddingHorizontal: spacing.xs },
  footNote: { marginTop: spacing.xl, paddingHorizontal: spacing.xs },
  locked: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  statusTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  viewSheetBody: { gap: spacing.md },
  viewSheetHint: { marginTop: spacing.sm },
});
