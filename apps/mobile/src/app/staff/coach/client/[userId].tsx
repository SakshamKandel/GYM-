import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Stepper,
  Tag,
} from '../../../../components/ui';
import {
  addClientMilestone,
  deleteMilestone,
  endCoaching,
  getClientMilestones,
  setCoachTier,
  toStaffError,
  type ClientMilestone,
  type StaffErrorCode,
  type Tier,
} from '../../../../features/staff/api';
import { AssignedWorkoutsSection } from '../../../../features/staff/AssignedWorkoutsSection';
import { DietPlanSection } from '../../../../features/staff/DietPlanSection';
import {
  defaultCustomDateParts,
  DURATION_OPTIONS,
  expiresAtFor,
  expiryLabel,
  isoFromDateParts,
  tierAllowsExpiry,
  type DurationChoice,
} from '../../../../features/staff/duration';
import { pushStaff, STAFF_ROUTES } from '../../../../features/staff/nav';
import { successHaptic } from '../../../../lib/haptics';
import { useAuth } from '../../../../state/auth';

/**
 * Coach · Client subscription — Greece sets or extends the tier + expiry of ONE
 * of her active clients.
 *
 * The coach-scoped endpoint (/api/coach/subscriptions) is ownership-checked
 * server-side (an active assignment to the caller), so this screen only offers
 * the client reached from that coach's own thread; a 'forbidden' from the
 * server surfaces as a quiet error if the assignment lapsed mid-session.
 *
 * Controls, kept deliberately simple (the owner's "no clutter" rule):
 *  - Tier chips: Starter / Silver / Gold / Elite.
 *  - Duration chips: 30 days / 90 days / 1 year / Permanent / Custom date.
 *    'starter' can't carry an expiry (it's the permanent free floor), so the
 *    duration row collapses to "Permanent" when Starter is picked.
 *  - Custom date uses three steppers (no keyboard, no new dep) — on-brand with
 *    the logger's anti-keyboard steppers.
 *  - Optional audited reason.
 *
 * The window is computed client-side into an ISO `expiresAt` and sent as the
 * dated payload. The current stored expiry is NOT exposed by any coach endpoint,
 * so this screen sets a FRESH window rather than pretending to edit an unknown
 * one; the effective tier passed from the thread is shown as context.
 *
 * Mentorship additions:
 *  - Milestones: the client's coach-logged wins (delete via ✕ + confirm) and a
 *    simple log form (title + optional note, dated today).
 *  - End coaching: the danger action at the very bottom — ends the caller's
 *    OWN assignment (the client keeps their logs; the thread closes) and
 *    returns to the previous screen.
 */

const TIER_ORDER: Tier[] = ['starter', 'silver', 'gold', 'elite'];

const TIER_LABEL: Record<Tier, string> = {
  starter: 'Starter',
  silver: 'Silver',
  gold: 'Gold',
  elite: 'Elite',
};

const TIER_COLOR: Record<Tier, string> = {
  starter: colors.textDim,
  silver: colors.blue,
  gold: colors.warning,
  elite: colors.accent,
};

const isTier = (v: string | undefined): v is Tier =>
  v === 'starter' || v === 'silver' || v === 'gold' || v === 'elite';

function errorLine(code: StaffErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired — sign in again.';
    case 'forbidden':
      return 'This client is no longer assigned to you.';
    case 'not_found':
      return "This client's account no longer exists.";
    case 'invalid':
      return 'That change was rejected. Check the details and retry.';
    default:
      return "Couldn't reach the server. Check your connection and retry.";
  }
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Clamp a day to the number of days in the given month/year. */
function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

/** Local calendar date as 'YYYY-MM-DD' — the wire format for achievedAt. */
function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 'YYYY-MM-DD' (or a full ISO stamp) → "12 Mar 2026". */
function formatDay(iso: string): string {
  const parts = iso.slice(0, 10).split('-');
  const y = Number.parseInt(parts[0] ?? '', 10);
  const m = Number.parseInt(parts[1] ?? '', 10);
  const d = Number.parseInt(parts[2] ?? '', 10);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return iso;
  return `${d} ${MONTHS[m - 1] ?? m} ${y}`;
}

export default function CoachClientScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  // A1: coach-initiated tier grants are a critical permission gate — the
  // server enforces it (client.tier_grant, absent from the coach preset by
  // default), but the control must never even be tappable here so a coach
  // never learns the flow exists only to hit a 403 at the end of it.
  const canGrantTier = staffCan(staffPermissions, 'client.tier_grant');
  const params = useLocalSearchParams<{ userId: string; name?: string; tier?: string }>();
  const userId = params.userId;
  const clientName = params.name?.trim() || 'Client';
  const currentTier: Tier | null = isTier(params.tier) ? params.tier : null;

  // Selection state. Default the tier to the client's current effective tier so
  // "extend" is one tap; default the window to 90 days (the common renewal).
  const [tier, setTier] = useState<Tier>(currentTier ?? 'silver');
  const [duration, setDuration] = useState<DurationChoice>('days90');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Custom date parts — default ~90 days out so the pickers start sensibly.
  // Lazy initializers read the clock once at mount (never during render).
  const [year, setYear] = useState(() => defaultCustomDateParts().year);
  const [month, setMonth] = useState(() => defaultCustomDateParts().month);
  const [day, setDay] = useState(() => defaultCustomDateParts().day);

  // ── Milestones ────────────────────────────────────────────────
  const [milestones, setMilestones] = useState<ClientMilestone[]>([]);
  const [milestonesLoading, setMilestonesLoading] = useState(true);
  const [milestonesError, setMilestonesError] = useState<string | null>(null);
  const [milestoneTitle, setMilestoneTitle] = useState('');
  const [milestoneNote, setMilestoneNote] = useState('');
  const [addingMilestone, setAddingMilestone] = useState(false);
  const [milestoneAddError, setMilestoneAddError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClientMilestone | null>(null);
  const [deletingMilestone, setDeletingMilestone] = useState(false);

  // ── End coaching ──────────────────────────────────────────────
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);

  const allowsExpiry = tierAllowsExpiry(tier);
  const usingCustom = allowsExpiry && duration === 'custom';

  // Clamp the day whenever month/year change so Feb 30 etc. can't be picked.
  const maxDay = daysInMonth(year, month);
  const safeDay = Math.min(day, maxDay);

  // Resolve the picked window to an ISO expiry (or null = permanent).
  const resolvedExpiresAt = useMemo((): string | null => {
    if (!allowsExpiry) return null; // starter → permanent
    const option = DURATION_OPTIONS.find((o) => o.key === duration);
    if (!option) return null;
    if (duration === 'custom') return isoFromDateParts(year, month, safeDay);
    const iso = expiresAtFor(option);
    return iso ?? null;
  }, [allowsExpiry, duration, year, month, safeDay]);

  const previewLine = allowsExpiry ? expiryLabel(resolvedExpiresAt) : 'Permanent (free tier)';

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else pushStaff(STAFF_ROUTES.coachInbox);
  }, []);

  const apply = useCallback(async () => {
    if (!token || !userId || saving || !canGrantTier) return;
    setSaving(true);
    setError(null);
    try {
      await setCoachTier(
        userId,
        tier,
        reason.trim() || undefined,
        // starter clears any expiry; otherwise send the resolved window
        // (null = permanent). Both fields use the "set" semantics here.
        { expiresAt: allowsExpiry ? resolvedExpiresAt : null },
        token,
      );
      successHaptic();
      setDone(
        `${clientName} is now ${TIER_LABEL[tier]}${
          allowsExpiry ? ` · ${expiryLabel(resolvedExpiresAt)}` : ' · permanent'
        }.`,
      );
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
    } finally {
      setSaving(false);
    }
  }, [token, userId, saving, canGrantTier, tier, reason, allowsExpiry, resolvedExpiresAt, clientName]);

  // ── Milestones — load on mount, log, delete ──────────────────

  const loadMilestones = useCallback(async () => {
    if (!token || !userId) {
      setMilestonesLoading(false);
      return;
    }
    setMilestonesLoading(true);
    setMilestonesError(null);
    try {
      setMilestones(await getClientMilestones(userId, token));
    } catch (err) {
      setMilestonesError(errorLine(toStaffError(err).code));
    } finally {
      setMilestonesLoading(false);
    }
  }, [token, userId]);

  useEffect(() => {
    void loadMilestones();
  }, [loadMilestones]);

  const addMilestone = useCallback(async () => {
    const title = milestoneTitle.trim();
    if (!token || !userId || !title || addingMilestone) return;
    setAddingMilestone(true);
    setMilestoneAddError(null);
    try {
      const note = milestoneNote.trim();
      const created = await addClientMilestone(
        userId,
        { title, ...(note ? { note } : {}), achievedAt: todayIso() },
        token,
      );
      successHaptic();
      // Server lists newest achievedAt first — a today-dated add goes on top.
      setMilestones((prev) => [created, ...prev]);
      setMilestoneTitle('');
      setMilestoneNote('');
    } catch (err) {
      setMilestoneAddError(errorLine(toStaffError(err).code));
    } finally {
      setAddingMilestone(false);
    }
  }, [token, userId, milestoneTitle, milestoneNote, addingMilestone]);

  const confirmDeleteMilestone = useCallback(async () => {
    if (!token || !deleteTarget || deletingMilestone) return;
    setDeletingMilestone(true);
    try {
      await deleteMilestone(deleteTarget.id, token);
      setMilestones((prev) => prev.filter((m) => m.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteTarget(null);
      setMilestonesError(errorLine(toStaffError(err).code));
    } finally {
      setDeletingMilestone(false);
    }
  }, [token, deleteTarget, deletingMilestone]);

  // ── End coaching (release the client from MY roster) ─────────

  const endNow = useCallback(async () => {
    if (!token || !userId || ending) return;
    setEnding(true);
    setEndError(null);
    try {
      await endCoaching(userId, token);
      setConfirmEnd(false);
      goBack();
    } catch (err) {
      setConfirmEnd(false);
      setEndError(errorLine(toStaffError(err).code));
    } finally {
      setEnding(false);
    }
  }, [token, userId, ending, goBack]);

  return (
    <>
      <Screen scroll keyboardAware>
        <Animated.View entering={enterDown()} style={styles.backRow}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={goBack}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </PressableScale>
        </Animated.View>

        <ScreenHeader eyebrow={clientName} title="Subscription" style={styles.header} />

        {/* Current tier — the screen's ONE cream counterpoint block; the tier
            rides a near-black pill (never colored/red text on cream). */}
        {currentTier ? (
          <Animated.View entering={enterUp(0)} style={styles.currentCard}>
            <AppText variant="label" color={colors.creamDim}>
              Current tier
            </AppText>
            <View style={styles.currentRow}>
              <Tag label={TIER_LABEL[currentTier]} variant="onBlock" />
              <AppText variant="caption" color={colors.creamDim}>
                Effective now
              </AppText>
            </View>
          </Animated.View>
        ) : null}

        {canGrantTier ? (
          <>
            <SectionLabel>Set tier</SectionLabel>
            <View style={styles.chipGrid}>
              {TIER_ORDER.map((t) => {
                const on = tier === t;
                return (
                  <PressableScale
                    key={t}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={TIER_LABEL[t]}
                    onPress={() => setTier(t)}
                    style={[
                      styles.tierPill,
                      on && { borderColor: TIER_COLOR[t], backgroundColor: colors.surfaceRaised },
                    ]}
                  >
                    <View style={[styles.tierDot, { backgroundColor: TIER_COLOR[t] }]} />
                    <AppText variant="bodyBold" color={on ? colors.text : colors.textDim} tabular={false}>
                      {TIER_LABEL[t]}
                    </AppText>
                  </PressableScale>
                );
              })}
            </View>

            <SectionLabel>Duration</SectionLabel>
            {allowsExpiry ? (
              <>
                <View style={styles.chipGrid}>
                  {DURATION_OPTIONS.map((opt) => {
                    const on = duration === opt.key;
                    return (
                      <PressableScale
                        key={opt.key}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={opt.label}
                        onPress={() => setDuration(opt.key)}
                        style={[styles.durationPill, on && styles.durationPillOn]}
                      >
                        <AppText
                          variant="body"
                          color={on ? colors.text : colors.textDim}
                          tabular={false}
                        >
                          {opt.label}
                        </AppText>
                      </PressableScale>
                    );
                  })}
                </View>

                {usingCustom ? (
                  <View style={styles.customCard}>
                    <AppText variant="label">Pick an expiry date</AppText>
                    <View style={styles.stepperRow}>
                      <Stepper
                        label="Year"
                        value={year}
                        onChange={setYear}
                        step={1}
                        min={new Date().getFullYear()}
                        max={new Date().getFullYear() + 5}
                      />
                      <Stepper
                        label="Month"
                        value={month}
                        onChange={setMonth}
                        step={1}
                        min={1}
                        max={12}
                        format={(v) => MONTHS[Math.min(Math.max(v, 1), 12) - 1] ?? String(v)}
                      />
                      <Stepper
                        label="Day"
                        value={safeDay}
                        onChange={setDay}
                        step={1}
                        min={1}
                        max={maxDay}
                      />
                    </View>
                  </View>
                ) : null}
              </>
            ) : (
              <View style={styles.permanentNote}>
                <Ionicons name="infinite-outline" size={18} color={colors.textDim} />
                <AppText variant="caption" color={colors.textDim} style={styles.permanentText}>
                  Starter is the free tier — it never expires, so no duration is needed.
                </AppText>
              </View>
            )}

            <View style={styles.previewRow}>
              <Ionicons
                name={allowsExpiry ? 'calendar-outline' : 'infinite-outline'}
                size={16}
                color={colors.accent}
              />
              <AppText variant="body" color={colors.text}>
                {previewLine}
              </AppText>
            </View>

            <SectionLabel>Reason (optional, audited)</SectionLabel>
            <AppTextInput
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. 3-month coaching package"
              maxLength={500}
              multiline
              style={styles.reasonInput}
              accessibilityLabel="Reason"
            />

            {error ? (
              <AppText variant="caption" color={colors.error} style={styles.errorLine}>
                {error}
              </AppText>
            ) : null}

            <Button
              label={saving ? 'Saving…' : 'Apply subscription'}
              onPress={() => void apply()}
              loading={saving}
              disabled={saving}
              style={styles.applyBtn}
            />
          </>
        ) : (
          <>
            <SectionLabel>Subscription</SectionLabel>
            <View style={styles.permanentNote}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.textDim} />
              <AppText variant="caption" color={colors.textDim} style={styles.permanentText}>
                You don&apos;t have permission to change this client&apos;s tier. Ask an admin.
              </AppText>
            </View>
          </>
        )}

        {/* ── Milestones — the client's coach-logged wins. ── */}
        <SectionLabel>Milestones</SectionLabel>
        {milestonesLoading ? (
          <View style={styles.milestoneQuiet}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : milestonesError ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Retry loading milestones"
            onPress={() => void loadMilestones()}
            style={styles.milestoneQuiet}
          >
            <AppText variant="caption" color={colors.textDim}>
              {milestonesError} · tap to retry
            </AppText>
          </PressableScale>
        ) : milestones.length === 0 ? (
          <AppText variant="caption" color={colors.textDim}>
            No milestones yet — log the first below.
          </AppText>
        ) : (
          <View style={styles.milestoneList}>
            {milestones.map((m) => (
              <View key={m.id} style={styles.milestoneRow}>
                <View style={styles.milestoneText}>
                  <AppText variant="bodyBold" numberOfLines={2}>
                    {m.title}
                  </AppText>
                  {m.note ? (
                    <AppText variant="caption" numberOfLines={3}>
                      {m.note}
                    </AppText>
                  ) : null}
                  <AppText variant="label" color={colors.textFaint}>
                    {formatDay(m.achievedAt)}
                  </AppText>
                </View>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Delete milestone: ${m.title}`}
                  onPress={() => setDeleteTarget(m)}
                  style={styles.milestoneRemove}
                >
                  <Ionicons name="close" size={18} color={colors.textDim} />
                </PressableScale>
              </View>
            ))}
          </View>
        )}

        <SectionLabel>Log milestone</SectionLabel>
        <View style={styles.milestoneForm}>
          <AppTextInput
            value={milestoneTitle}
            onChangeText={setMilestoneTitle}
            placeholder="e.g. First 100 kg squat"
            maxLength={120}
            returnKeyType="done"
            accessibilityLabel="Milestone title"
          />
          <AppTextInput
            value={milestoneNote}
            onChangeText={setMilestoneNote}
            placeholder="Note (optional)"
            maxLength={500}
            multiline
            style={styles.milestoneNoteInput}
            accessibilityLabel="Milestone note (optional)"
          />
          <AppText variant="caption" color={colors.textFaint}>
            Dated today · {formatDay(todayIso())}
          </AppText>
          {milestoneAddError ? (
            <AppText variant="caption" color={colors.error}>
              {milestoneAddError}
            </AppText>
          ) : null}
          <Button
            label={addingMilestone ? 'Logging…' : 'Log milestone'}
            variant="secondary"
            onPress={() => void addMilestone()}
            loading={addingMilestone}
            disabled={!milestoneTitle.trim()}
          />
        </View>

        {/* ── Coach-assigned programs (SCALE-UP-PLAN §4.3 / §5.2). ── */}
        <AssignedWorkoutsSection userId={userId} token={token} />
        <DietPlanSection userId={userId} token={token} />

        {/* ── End coaching — the one destructive action, at the very bottom. ── */}
        {endError ? (
          <AppText variant="caption" color={colors.error} style={styles.errorLine}>
            {endError}
          </AppText>
        ) : null}
        <Button
          label={ending ? 'Ending…' : 'End coaching'}
          variant="danger"
          onPress={() => setConfirmEnd(true)}
          loading={ending}
          style={styles.endBtn}
        />
      </Screen>

      {/* Success confirmation — dismiss returns to the thread. */}
      <ConfirmDialog
        visible={done !== null}
        title="Subscription updated"
        message={done ?? undefined}
        confirmLabel="Done"
        hideCancel
        onConfirm={() => {
          setDone(null);
          goBack();
        }}
        onCancel={() => setDone(null)}
      />

      {/* Milestone delete confirmation. */}
      <ConfirmDialog
        visible={deleteTarget !== null}
        title="Delete milestone?"
        message={
          deleteTarget
            ? `“${deleteTarget.title}” will be removed from ${clientName}'s record.`
            : undefined
        }
        confirmLabel={deletingMilestone ? 'Deleting…' : 'Delete'}
        cancelLabel="Keep"
        danger
        onConfirm={() => void confirmDeleteMilestone()}
        onCancel={() => {
          if (!deletingMilestone) setDeleteTarget(null);
        }}
      />

      {/* End-coaching confirmation. */}
      <ConfirmDialog
        visible={confirmEnd}
        title="End coaching"
        message={`End coaching with ${clientName}? They keep their logs; the chat thread closes for you.`}
        confirmLabel={ending ? 'Ending…' : 'End coaching'}
        cancelLabel="Keep coaching"
        danger
        onConfirm={() => void endNow()}
        onCancel={() => {
          if (!ending) setConfirmEnd(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backRow: { marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.gutter },
  // Cream counterpoint block — borderless, chunky radius, black/cream-dim ink.
  currentCard: {
    backgroundColor: colors.blockCream,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.sm,
  },
  currentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  // Interactive pills keep their strokes — the no-border law is for cards.
  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.full,
    paddingHorizontal: 16,
    height: touch.min,
  },
  tierDot: { width: 8, height: 8, borderRadius: radius.full },
  durationPill: {
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.full,
    paddingHorizontal: 18,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationPillOn: { borderColor: colors.text, backgroundColor: colors.surfaceRaised },
  // Borderless charcoal tiles — separation by fill contrast, never strokes.
  customCard: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  stepperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  permanentNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: touch.min,
  },
  permanentText: { flex: 1 },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  reasonInput: {
    minHeight: 64,
    paddingTop: 16,
    textAlignVertical: 'top',
  },
  errorLine: { marginTop: spacing.md },
  applyBtn: { marginTop: spacing.xl },
  // Milestones — borderless charcoal rows with a trailing ✕, list gap by fill.
  milestoneQuiet: {
    minHeight: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  milestoneList: { gap: spacing.sm },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    minHeight: touch.min,
  },
  milestoneText: { flex: 1, gap: 3 },
  milestoneRemove: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  milestoneForm: { gap: spacing.sm },
  milestoneNoteInput: {
    minHeight: 64,
    paddingTop: 16,
    textAlignVertical: 'top',
  },
  endBtn: { marginTop: spacing.xl, marginBottom: spacing.lg },
});
import { staffCan } from '../../../../features/staff/nav';
