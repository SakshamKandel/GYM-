import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
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
  Sheet,
  Tag,
} from '../../../components/ui';
import {
  decideCoachApplication,
  getAdminCoachApplications,
  toStaffError,
  type ApplicationStatus,
  type CoachApplicationRow,
  type CoachTier,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { canReviewApplications, replaceStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Applications — the self-serve coach-application review queue
 * (SCALE-UP-PLAN §1.4 / §4.2).
 *
 * Status tabs (pending default) list the queue; tapping a row opens a detail
 * sheet with the full portfolio (bio, years, specialties, achievements,
 * certifications, avatar). Pending applications get an inline decision panel:
 * a coach-tier picker (defaults silver) for Approve, or a note field for
 * Reject, behind a confirm. Approved/rejected applications are read-only —
 * their recorded reviewNote (if any) is shown instead of the decision panel.
 * Gated to member_admin / super_admin / main_admin (the hub already filters
 * this row; this screen re-gates in case of a direct deep link).
 */

const STATUS_TABS: { key: ApplicationStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const COACH_TIERS: CoachTier[] = ['silver', 'gold', 'elite'];

const COACH_TIER_LABEL: Record<CoachTier, string> = {
  silver: 'Silver',
  gold: 'Gold',
  elite: 'Elite',
};

function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have access to this.";
  if (code === 'not_found') return 'That application is no longer available.';
  return "Couldn't load the queue.";
}

/** Short relative age ("3m", "2h", "5d") with an absolute fallback. */
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

export default function AdminApplicationsScreen() {
  const token = useAuth((s) => s.token);
  const staffRole = useAuth((s) => s.staffRole);
  const allowed = canReviewApplications(staffRole);

  const [status, setStatus] = useState<ApplicationStatus>('pending');
  const [rows, setRows] = useState<CoachApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<CoachApplicationRow | null>(null);
  const [pickedTier, setPickedTier] = useState<CoachTier>('silver');
  const [note, setNote] = useState('');
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);

  const load = useCallback(
    async (st: ApplicationStatus) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        setRows(await getAdminCoachApplications(token, st));
      } catch (e) {
        setError(errorLine(toStaffError(e).code));
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (allowed) void load(status);
  }, [allowed, status, load]);

  function pickTab(next: ApplicationStatus): void {
    setStatus(next);
  }

  function openDetail(row: CoachApplicationRow): void {
    setSelected(row);
    setPickedTier('silver');
    setNote('');
    setDecideError(null);
    setConfirmAction(null);
  }

  function closeDetail(): void {
    setSelected(null);
  }

  async function decide(action: 'approve' | 'reject'): Promise<void> {
    if (!token || !selected || deciding) return;
    setDeciding(true);
    setDecideError(null);
    try {
      await decideCoachApplication(
        selected.id,
        action,
        action === 'approve'
          ? { coachTier: pickedTier, ...(note.trim() ? { reviewNote: note.trim() } : {}) }
          : note.trim()
            ? { reviewNote: note.trim() }
            : undefined,
        token,
      );
      setConfirmAction(null);
      setSelected(null);
      await load(status);
    } catch (e) {
      // Close the confirm modal so the error (set below, rendered in the
      // Sheet behind it) is actually visible — otherwise it silently
      // reverts to "Approve"/"Reject" with zero feedback and the admin keeps
      // re-firing the same failing request.
      setConfirmAction(null);
      setDecideError(errorLine(toStaffError(e).code));
    } finally {
      setDeciding(false);
    }
  }

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replaceStaff(STAFF_ROUTES.adminHome);
  }

  if (!allowed) {
    return (
      <Screen>
        <BackRow onBack={goBack} />
        <Animated.View entering={enterUp(0)} style={styles.locked}>
          <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textFaint}>
            Only a member admin, main admin or super admin can review applications.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <BackRow onBack={goBack} />

      <Animated.View entering={enterDown()} style={styles.tabsRow}>
        {STATUS_TABS.map((t) => (
          <Chip key={t.key} label={t.label} selected={status === t.key} onPress={() => pickTab(t.key)} />
        ))}
      </Animated.View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.retryWrap}>
          <RetryLine message={error} onRetry={() => void load(status)} />
        </View>
      ) : rows.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.emptyLine}>
          No {status} applications.
        </AppText>
      ) : (
        <View style={styles.list}>
          {rows.map((r, i) => (
            <Animated.View key={r.id} entering={enterUp(Math.min(i, 6))}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Open application from ${r.displayName}`}
                onPress={() => openDetail(r)}
                style={styles.row}
              >
                {r.avatarUrl ? (
                  <Image source={{ uri: r.avatarUrl }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Ionicons name="person" size={20} color={colors.textDim} />
                  </View>
                )}
                <View style={styles.rowText}>
                  <AppText variant="bodyBold" numberOfLines={1}>
                    {r.displayName}
                  </AppText>
                  <AppText variant="caption" numberOfLines={1}>
                    {r.headline || r.account.email}
                  </AppText>
                </View>
                <AppText variant="caption" color={colors.textFaint}>
                  {relativeTime(r.createdAt)}
                </AppText>
                <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
              </PressableScale>
            </Animated.View>
          ))}
        </View>
      )}

      <Sheet visible={selected !== null} onClose={closeDetail} title={selected?.displayName ?? 'Application'}>
        {selected ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScroll}>
            <View style={styles.sheetHeadRow}>
              {selected.avatarUrl ? (
                <Image source={{ uri: selected.avatarUrl }} style={styles.avatarLg} contentFit="cover" />
              ) : (
                <View style={styles.avatarLgFallback}>
                  <Ionicons name="person" size={28} color={colors.textDim} />
                </View>
              )}
              <View style={styles.sheetHeadText}>
                <AppText variant="caption" numberOfLines={1}>
                  {selected.account.email}
                </AppText>
                {selected.headline ? (
                  <AppText variant="body" numberOfLines={2}>
                    {selected.headline}
                  </AppText>
                ) : null}
                <AppText variant="caption" color={colors.textFaint}>
                  {selected.yearsExperience} yr{selected.yearsExperience === 1 ? '' : 's'} experience
                </AppText>
              </View>
            </View>

            {selected.bio ? (
              <>
                <SectionLabel>Bio</SectionLabel>
                <AppText variant="body">{selected.bio}</AppText>
              </>
            ) : null}

            {selected.specialties.length > 0 ? (
              <>
                <SectionLabel>Specialties</SectionLabel>
                <View style={styles.chips}>
                  {selected.specialties.map((s) => (
                    <Tag key={s} label={s} variant="dim" />
                  ))}
                </View>
              </>
            ) : null}

            {selected.achievements.length > 0 ? (
              <>
                <SectionLabel>Achievements</SectionLabel>
                {selected.achievements.map((a, i) => (
                  <AppText key={`${i}-${a}`} variant="caption" style={styles.listLine}>
                    • {a}
                  </AppText>
                ))}
              </>
            ) : null}

            {selected.certifications.length > 0 ? (
              <>
                <SectionLabel>Certifications</SectionLabel>
                {selected.certifications.map((c, i) => (
                  <AppText key={`${i}-${c.title}`} variant="caption" style={styles.listLine}>
                    • {c.title}
                    {[c.issuer, c.year !== null ? String(c.year) : ''].filter(Boolean).length
                      ? ` (${[c.issuer, c.year !== null ? String(c.year) : ''].filter(Boolean).join(' · ')})`
                      : ''}
                  </AppText>
                ))}
              </>
            ) : null}

            {selected.status === 'pending' ? (
              <>
                <SectionLabel>Decision</SectionLabel>
                <AppText variant="caption" color={colors.textDim} style={styles.tierHint}>
                  Coach tier (used only if approved)
                </AppText>
                <View style={styles.chips}>
                  {COACH_TIERS.map((t) => (
                    <Chip
                      key={t}
                      label={COACH_TIER_LABEL[t]}
                      selected={pickedTier === t}
                      onPress={() => setPickedTier(t)}
                    />
                  ))}
                </View>
                <AppTextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="Review note (optional)"
                  multiline
                  style={styles.noteInput}
                />
                {decideError ? (
                  <AppText variant="caption" color={colors.error} style={styles.decideError}>
                    {decideError}
                  </AppText>
                ) : null}
                <View style={styles.decisionButtons}>
                  <Button
                    label="Reject"
                    variant="danger"
                    style={styles.decisionBtn}
                    onPress={() => setConfirmAction('reject')}
                    disabled={deciding}
                  />
                  <Button
                    label="Approve"
                    style={styles.decisionBtn}
                    onPress={() => setConfirmAction('approve')}
                    disabled={deciding}
                  />
                </View>
              </>
            ) : (
              <>
                <SectionLabel>Status</SectionLabel>
                <Tag
                  label={selected.status === 'approved' ? 'Approved' : 'Rejected'}
                  variant="outline"
                  color={selected.status === 'approved' ? colors.success : colors.error}
                />
                {selected.reviewNote ? (
                  <AppText variant="caption" color={colors.textDim} style={styles.tierHint}>
                    {selected.reviewNote}
                  </AppText>
                ) : null}
              </>
            )}
          </ScrollView>
        ) : null}
      </Sheet>

      <ConfirmDialog
        visible={confirmAction !== null}
        title={confirmAction === 'approve' ? 'Approve this application?' : 'Reject this application?'}
        message={
          confirmAction === 'approve'
            ? `${selected?.displayName ?? 'This applicant'} becomes a ${COACH_TIER_LABEL[pickedTier]} coach with their own promo code.`
            : 'The applicant can see this decision, but may re-apply later.'
        }
        confirmLabel={deciding ? 'Working…' : confirmAction === 'approve' ? 'Approve' : 'Reject'}
        cancelLabel="Cancel"
        danger={confirmAction === 'reject'}
        onConfirm={() => confirmAction && void decide(confirmAction)}
        onCancel={() => setConfirmAction(null)}
      />
    </Screen>
  );
}

/** Shared back row + revamp header (matches audit.tsx's pattern). */
function BackRow({ onBack }: { onBack: () => void }) {
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
      <ScreenHeader eyebrow="Admin console" title="Applications" style={styles.header} />
    </>
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
  tabsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  retryWrap: { marginTop: spacing.md },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  emptyLine: { marginTop: spacing.lg, paddingHorizontal: spacing.xs },
  list: { gap: spacing.sm },
  // Charcoal list row (brief §11c): fill contrast, no hairline borders.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 64,
  },
  avatar: { width: 44, height: 44, borderRadius: radius.full, backgroundColor: colors.surfaceRaised },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  sheetScroll: { paddingBottom: spacing.xxl, gap: spacing.sm },
  sheetHeadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  avatarLg: { width: 64, height: 64, borderRadius: radius.full, backgroundColor: colors.surfaceRaised },
  avatarLgFallback: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetHeadText: { flex: 1, gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  listLine: { marginTop: 2 },
  tierHint: { marginTop: spacing.xs, marginBottom: spacing.xs },
  noteInput: {
    marginTop: spacing.sm,
    minHeight: 72,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  decideError: { marginTop: spacing.sm },
  decisionButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  decisionBtn: { flex: 1 },
});
