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
  ConfirmDialog,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  SectionLabel,
  Tag,
} from '../../../components/ui';
import {
  assignClient,
  endAssignment,
  getCoaches,
  getMemberDetail,
  getMembers,
  toStaffError,
  type CoachRow,
  type MemberRow,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { pushStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

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
 */

const ERR_TEXT: Record<StaffErrorCode, string> = {
  unauthorized: 'Your session expired. Sign in again.',
  forbidden: "You don't have access to this.",
  not_found: 'Not found.',
  invalid: "That didn't work.",
  conflict: 'That conflicts with the current state.',
  not_configured: 'This feature is not set up yet.',
  network: "Couldn't reach the server.",
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

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setResults([]);
        setSearchError(null);
        return;
      }
      setSearching(true);
      setSearchError(null);
      try {
        setResults(await getMembers(token, trimmed));
      } catch (e) {
        setSearchError(ERR_TEXT[toStaffError(e).code]);
      } finally {
        setSearching(false);
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
        <View style={styles.headerText}>
          <AppText variant="heading" numberOfLines={1}>
            {coachDisplay(coach)}
          </AppText>
          <AppText variant="caption" numberOfLines={1}>
            {coach.email}
          </AppText>
        </View>
      </Animated.View>

      <Animated.View entering={enterUp(0)} style={styles.metaRow}>
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
      </Animated.View>

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
                accessibilityLabel={`Open ${memberName(m)}`}
                onPress={() => pushStaff(STAFF_ROUTES.adminMember(m.id))}
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
    </Screen>
  );
}

// ════════════════════════════════════════════════════════════════
// Coach roster
// ════════════════════════════════════════════════════════════════

export default function AdminCoachesScreen() {
  const token = useAuth((s) => s.token);
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
    void load();
  }, [load]);

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
        <AppText variant="heading">Coaches</AppText>
      </Animated.View>

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
                <View style={styles.avatar}>
                  <Ionicons name="person" size={20} color={colors.accent} />
                </View>
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
  headerText: { flex: 1, gap: 2 },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  hint: { marginTop: spacing.sm, paddingHorizontal: spacing.xs },
  list: { gap: spacing.md },
  coachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.accentFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachText: { flex: 1, gap: 2 },
  coachMeta: { alignItems: 'center', minWidth: 48 },
  clientCount: { lineHeight: 40 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
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
});
