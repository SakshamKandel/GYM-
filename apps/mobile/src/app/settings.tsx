import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';
import * as LocalAuthentication from 'expo-local-authentication';
import { BADGE_CATALOG, hasEntitlement, type BadgeDef, type FontScale, type Tier } from '@gym/shared';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  ConfirmDialog,
  IconChip,
  PressableScale,
  Screen,
  ScreenHeader,
  enterDown,
  enterFade,
  enterUp,
  layoutSpring,
} from '../components/ui';
import { BadgeMedal } from '../components/ui/badges/BadgeMedal';
import { shareTrainingData } from '../lib/export';
import { successHaptic, tapHaptic, warnHaptic } from '../lib/haptics';
import {
  scheduleCheckInReminder,
  scheduleMorningNudge,
  scheduleWorkoutReminders,
} from '../lib/notifications';
import { deleteAccount, logoutAll, toApiError } from '../lib/api/client';
import { resetStackTo } from '../lib/nav';
import { patchWeeklyTarget, toGamificationError } from '../lib/api/gamification';
import { getPublicLeaderboard, setPublicBoardHidden } from '../lib/api/social';
import { getRepo } from '../lib/repo';
import { SEED_PLANS } from '../lib/seed/plans';
import { MembershipCard } from '../features/subscription/components/MembershipCard';
import { useEffectiveTier } from '../lib/tier';
import { useAuth } from '../state/auth';
import { publicBoardHiddenFor, useGamificationDisplay } from '../state/gamification';
import { useProfile } from '../state/profile';
import { useReminders } from '../state/reminders';
import { useSecurity } from '../state/security';
import { ProfileGamification } from '../features/gamification/components/ProfileGamification';
import { useGamificationBadges } from '../features/gamification/store';
import { getSupportUnread } from '../features/support/api';
import { useWeeklyStreak } from '../features/streak/hooks';
import { pushPath } from '../features/auth/nav';
import { pushStaff, STAFF_ROUTES } from '../features/staff/nav';
import { biometricsAvailable } from '../features/security/AppLock';
import {
  BIRTH_YEAR,
  HEIGHT_CM,
  recalcTargets,
  SEX_OPTIONS,
} from '../features/onboarding/logic';

/**
 * /settings — block-language settings (REVAMP-BRIEF): back pill + huge
 * SETTINGS header, a charcoal account block (avatar + editable name + tier
 * chip), then borderless charcoal section blocks where spacing — never a
 * hairline — separates rows, and a black danger-zone block whose delete
 * action is a red text button.
 */

const FONT_SCALE_OPTIONS: { value: FontScale; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
  { value: 'xlarge', label: 'XL' },
];

const TIER_LABEL: Record<Tier, string> = {
  starter: 'Starter',
  silver: 'Silver',
  gold: 'Gold',
  elite: 'Elite',
};

function accountDeletionFailureMessage(error: ReturnType<typeof toApiError>): string {
  if (error.code === 'unauthorized') {
    return 'Your session has expired — sign in again to delete your account.';
  }
  if (error.code === 'confirmation_required') {
    return 'Type DELETE exactly to confirm.';
  }
  if (error.code === 'private_asset_cleanup_pending') {
    return "We couldn't finish removing your private progress photos. Nothing else was deleted — try again.";
  }
  if (error.code === 'account_deletion_conflict') {
    return 'Your account changed while deletion was starting. Nothing was deleted — review your active services and try again.';
  }
  if (error.code === 'account_deletion_blocked') {
    const blockerCodes = new Set(
      error.deletionImpact?.blockers.map((blocker) => blocker.code) ?? [],
    );
    if (
      blockerCodes.has('live_meal_orders') ||
      blockerCodes.has('open_meal_subscriptions')
    ) {
      return 'Finish or cancel every active meal order and recurring meal plan before deleting your account.';
    }
    if (
      blockerCodes.has('pending_meal_payment_requests') ||
      blockerCodes.has('pending_membership_payment_requests')
    ) {
      return 'Wait for pending meal or membership payment reviews to finish before deleting your account.';
    }
    if (
      blockerCodes.has('staff_offboarding_required') ||
      blockerCodes.has('partner_offboarding_required') ||
      blockerCodes.has('coach_offboarding_required')
    ) {
      return 'An administrator must first offboard your staff, coach, or meal-partner access. Nothing was deleted.';
    }
    if (blockerCodes.has('legacy_identity_ambiguous')) {
      return 'We found more than one legacy profile for this email. Contact support so we can verify and erase the right data safely.';
    }
    if (
      blockerCodes.has('retained_commerce_history') ||
      blockerCodes.has('retained_financial_history')
    ) {
      return 'Your account has order, payment, discount, or payout records that self-service deletion cannot erase safely. Contact support for verified anonymization; nothing was deleted.';
    }
  }
  return "Couldn't reach the server. Nothing was deleted — check your connection and try again.";
}

/**
 * Day picker order, Monday-first for a natural reading order. Each entry maps a
 * single-letter chip to the expo-notifications weekday number (1=Sun … 7=Sat).
 */
const WEEKDAY_CHIPS: { weekday: number; letter: string; name: string }[] = [
  { weekday: 2, letter: 'M', name: 'Monday' },
  { weekday: 3, letter: 'T', name: 'Tuesday' },
  { weekday: 4, letter: 'W', name: 'Wednesday' },
  { weekday: 5, letter: 'T', name: 'Thursday' },
  { weekday: 6, letter: 'F', name: 'Friday' },
  { weekday: 7, letter: 'S', name: 'Saturday' },
  { weekday: 1, letter: 'S', name: 'Sunday' },
];

/** Compact pill chip — same language as ui/Chip, sized for inline row controls. */
function MiniChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={[styles.miniChip, selected && styles.miniChipSelected]}
    >
      <AppText
        style={styles.miniChipText}
        color={selected ? colors.onBlock : colors.textDim}
        tabular={false}
      >
        {label}
      </AppText>
    </PressableScale>
  );
}

/** Small round day toggle for the workout-reminder picker (M T W T F S S). */
function DayChip({
  letter,
  name,
  selected,
  onPress,
}: {
  letter: string;
  name: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={name}
      onPress={onPress}
      hitSlop={8}
      style={[styles.dayChip, selected && styles.dayChipSelected]}
    >
      <AppText
        style={styles.dayChipText}
        color={selected ? colors.onBlock : colors.textDim}
        tabular={false}
      >
        {letter}
      </AppText>
    </PressableScale>
  );
}

/** Inline ± stepper (36dp buttons, long-press repeat) — ui/Stepper is too wide
 * for a 56dp settings row, so this mirrors its behavior at row scale. */
function MiniStepper({
  value,
  display,
  onChange,
  step,
  min,
  max,
  label,
  valueStyle,
}: {
  value: number;
  display?: string;
  onChange: (next: number) => void;
  step: number;
  min: number;
  max: number;
  label: string;
  /** Optional override for the value cell width (e.g. narrow clock digits). */
  valueStyle?: StyleProp<TextStyle>;
}) {
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveValue = useRef(value);
  liveValue.current = value;

  function apply(delta: number): void {
    let next = liveValue.current + delta;
    if (next < min) next = min;
    if (next > max) next = max;
    if (next !== liveValue.current) {
      onChange(next);
      liveValue.current = next;
    }
  }

  function startRepeat(delta: number): void {
    stopRepeat();
    repeatTimer.current = setInterval(() => apply(delta), 130);
  }

  function stopRepeat(): void {
    if (repeatTimer.current) {
      clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
  }

  // Clear any live long-press repeat if the stepper unmounts before onPressOut
  // (e.g. Android back button, or the reminder row collapsing) — otherwise the
  // interval keeps firing apply() on unmounted state forever.
  useEffect(() => stopRepeat, []);

  return (
    <View style={styles.miniStepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        onPress={() => apply(-step)}
        onLongPress={() => startRepeat(-step)}
        onPressOut={stopRepeat}
        hitSlop={6}
        style={({ pressed }) => [styles.miniStepBtn, pressed && styles.miniStepBtnPressed]}
      >
        <AppText style={styles.miniStepSign} tabular={false}>
          −
        </AppText>
      </Pressable>
      <AppText
        style={[styles.miniStepValue, valueStyle]}
        tabular
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {display ?? String(value)}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        onPress={() => apply(step)}
        onLongPress={() => startRepeat(step)}
        onPressOut={stopRepeat}
        hitSlop={6}
        style={({ pressed }) => [styles.miniStepBtn, pressed && styles.miniStepBtnPressed]}
      >
        <AppText style={styles.miniStepSign} tabular={false}>
          +
        </AppText>
      </Pressable>
    </View>
  );
}

/** Tiny stat cell for the daily-targets strip. */
function TargetCell({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.targetCell}>
      <AppText
        style={styles.targetValue}
        tabular
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {value}
      </AppText>
      <AppText
        style={[styles.targetLabel, { color }]}
        tabular={false}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {label}
      </AppText>
    </View>
  );
}

/**
 * Final delete-account gate — mirrors ConfirmDialog's card exactly (same
 * scrim, card, and button row), plus a typed "DELETE" arm switch so a stray
 * double-tap can never erase an account. ConfirmDialog itself stays a pure
 * yes/no popup; this variant owns its text field and inline error line.
 */
function DeleteAccountDialog({
  visible,
  email,
  value,
  onChangeValue,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  email: string;
  value: string;
  onChangeValue: (next: string) => void;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const armed = value.trim() === 'DELETE';

  // Same physical warning ConfirmDialog gives every destructive prompt.
  useEffect(() => {
    if (visible) warnHaptic();
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
      <Animated.View entering={enterFade()} style={styles.dialogFill}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.dialogFill}
        >
          <Pressable
            style={styles.dialogBackdrop}
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            {/* Stop backdrop presses from falling through the card. */}
            <Pressable
              accessibilityViewIsModal
              onPress={() => undefined}
              style={styles.dialogCard}
            >
              <AppText variant="title">Last step</AppText>
              <AppText variant="body" color={colors.textDim}>
                {`This permanently deletes ${email} and eligible synced data. Type DELETE to confirm. The server will stop without deleting anything if active services or retained billing records need offboarding.`}
              </AppText>
              <AppTextInput
                value={value}
                onChangeText={onChangeValue}
                placeholder="DELETE"
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!busy}
                returnKeyType="done"
                accessibilityLabel="Type DELETE to confirm"
              />
              {error !== null ? (
                <AppText variant="caption" color={colors.error}>
                  {error}
                </AppText>
              ) : null}
              <View style={styles.dialogButtons}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  style={styles.dialogBtn}
                  disabled={busy}
                  onPress={onCancel}
                />
                <Button
                  label={busy ? 'Deleting…' : 'Delete forever'}
                  variant="danger"
                  style={styles.dialogBtn}
                  disabled={!armed}
                  loading={busy}
                  onPress={onConfirm}
                />
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}

export default function SettingsScreen() {
  const displayName = useProfile((s) => s.displayName);
  const sex = useProfile((s) => s.sex);
  const birthYear = useProfile((s) => s.birthYear);
  const heightCm = useProfile((s) => s.heightCm);
  const startWeightKg = useProfile((s) => s.startWeightKg);
  const unitPref = useProfile((s) => s.unitPref);
  const goalType = useProfile((s) => s.goalType);
  const activityLevel = useProfile((s) => s.activityLevel);
  const fontScale = useProfile((s) => s.fontScale);
  const targets = useProfile((s) => s.targets);
  const planId = useProfile((s) => s.planId);
  // Effective tier (server-first) — Elite just swaps the Support row's copy
  // ("Priority support"); every tier may open the row (SCALE-UP-PLAN §4.4).
  const tier = useEffectiveTier();
  const [supportUnread, setSupportUnread] = useState(0);
  const daysPerWeek = useProfile((s) => s.daysPerWeek);
  const update = useProfile((s) => s.update);

  const authStatus = useAuth((s) => s.status);
  const authUser = useAuth((s) => s.user);
  const authToken = useAuth((s) => s.token);
  const staffRole = useAuth((s) => s.staffRole);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const signOut = useAuth((s) => s.signOut);
  // Server-authoritative tier for the identity shield — never useProfile.tier
  // (local upgrade-only mirror, known to drift above the server's value).
  const serverTier = useAuth((s) => s.user?.tier ?? 'starter');

  // Support unread badge — a plain focus fetch (SCALE-UP-PLAN §4.4),
  // independent of any other feature's poll; getSupportUnread never throws
  // (resolves to 0 on failure) so this can never break the settings screen.
  useFocusEffect(
    useCallback(() => {
      if (authStatus !== 'signedIn' || authToken === null) {
        setSupportUnread(0);
        return;
      }
      void getSupportUnread(authToken).then(setSupportUnread);
    }, [authStatus, authToken]),
  );

  const hideGamification = useGamificationDisplay((s) => s.hideGamification);
  const setHideGamification = useGamificationDisplay((s) => s.setHideGamification);
  // Account-scoped read: a mirror persisted by a previous account on this
  // device must never render as THIS account's visibility (default = shown).
  const publicBoardHidden = useGamificationDisplay((s) => publicBoardHiddenFor(s, authUser?.id));
  const setPublicBoardHiddenLocal = useGamificationDisplay((s) => s.setPublicBoardHidden);
  // Set once the user touches the toggle this visit — an in-flight focus
  // hydration must not clobber their optimistic flip with a stale read.
  const publicBoardTouchedRef = useRef(false);
  const gamification = useWeeklyStreak();
  const earnedBadgeCount = useGamificationBadges((s) => s.badges.length);
  const earnedBadges = useGamificationBadges((s) => s.badges);

  // The three most recently earned badges as mini medals on the Badges row
  // (server returns newest-first; challenge extras fall back to a synthetic
  // crew/award def since they have no catalog entry).
  const recentBadges = useMemo<Array<{ def: BadgeDef; status: 'logged' | 'verified' }>>(
    () =>
      earnedBadges.slice(0, 3).map((b) => {
        const def = BADGE_CATALOG.find((c) => c.id === b.badgeId) ?? {
          id: b.badgeId,
          family: 'crew' as const,
          name: 'Challenge',
          description: '',
          icon: 'award' as const,
          sort: 900,
        };
        return { def, status: b.status };
      }),
    [earnedBadges],
  );

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [latestKg, setLatestKg] = useState<number | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

  // ── Account controls (signed-in only) ────────────────────────
  const [confirmingLogoutAll, setConfirmingLogoutAll] = useState(false);
  const [logoutAllBusy, setLogoutAllBusy] = useState(false);
  const [logoutAllError, setLogoutAllError] = useState<string | null>(null);
  // Two-step delete: yes/no popup first, then the typed-DELETE gate.
  const [deleteStep, setDeleteStep] = useState<'idle' | 'confirm' | 'type'>('idle');
  const [deleteText, setDeleteText] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const biometricLock = useSecurity((s) => s.biometricLock);
  const setBiometricLock = useSecurity((s) => s.setBiometricLock);
  const [confirmingBioOff, setConfirmingBioOff] = useState(false);
  const [bioInfo, setBioInfo] = useState<string | null>(null);
  const [bioBusy, setBioBusy] = useState(false);

  // ── Reminders (all local, recurring) ─────────────────────────
  const workoutRemindersOn = useReminders((s) => s.workoutRemindersOn);
  const reminderWeekdays = useReminders((s) => s.weekdays);
  const reminderHour = useReminders((s) => s.hour);
  const reminderMinute = useReminders((s) => s.minute);
  const morningNudgeOn = useReminders((s) => s.morningNudgeOn);
  const checkInReminderOn = useReminders((s) => s.checkInReminderOn);
  const setWorkoutRemindersOn = useReminders((s) => s.setWorkoutRemindersOn);
  const toggleWeekday = useReminders((s) => s.toggleWeekday);
  const setReminderTime = useReminders((s) => s.setTime);
  const setMorningNudgeOn = useReminders((s) => s.setMorningNudgeOn);
  const setCheckInReminderOn = useReminders((s) => s.setCheckInReminderOn);

  /** Toggle the whole workout-reminder schedule on/off. */
  function onWorkoutRemindersToggle(next: boolean): void {
    setWorkoutRemindersOn(next);
    // Scheduler asks for permission on first enable and clears on disable.
    void scheduleWorkoutReminders(next ? reminderWeekdays : [], reminderHour, reminderMinute);
  }

  /** Add/remove a training day, then re-sync the schedule (if enabled). */
  function onToggleWeekday(weekday: number): void {
    const next = reminderWeekdays.includes(weekday)
      ? reminderWeekdays.filter((d) => d !== weekday)
      : [...reminderWeekdays, weekday].sort((a, b) => a - b);
    toggleWeekday(weekday);
    if (workoutRemindersOn) {
      void scheduleWorkoutReminders(next, reminderHour, reminderMinute);
    }
  }

  /** Change the reminder time, then re-sync the schedule (if enabled). */
  function onReminderTimeChange(hour: number, minute: number): void {
    setReminderTime(hour, minute);
    if (workoutRemindersOn) {
      void scheduleWorkoutReminders(reminderWeekdays, hour, minute);
    }
  }

  /** Toggle the daily morning nudge (fixed 8:00). */
  function onMorningNudgeToggle(next: boolean): void {
    setMorningNudgeOn(next);
    void scheduleMorningNudge(next, 8, 0);
  }

  /** Toggle the weekly Sunday check-in reminder. */
  function onCheckInToggle(next: boolean): void {
    setCheckInReminderOn(next);
    void scheduleCheckInReminder(next);
  }

  /**
   * Weekly session target — writes the local profile immediately (offline-
   * first, and the same field the streak/analytics math already reads), then
   * best-effort mirrors it server-side so shield/streak computation there
   * uses the same number. A failed PATCH just means the server catches up on
   * the next successful call — the local value is never rolled back for it.
   */
  function onWeeklyTargetChange(next: number): void {
    update({ daysPerWeek: next });
    if (authStatus === 'signedIn' && authToken) {
      patchWeeklyTarget(authToken, next).catch((err) => {
        toGamificationError(err); // swallow — local value already stands
      });
    }
  }

  /**
   * "Show me on the public leaderboard" — flips the LOCAL mirror immediately
   * (same optimistic pattern as the weekly target above), then best-effort
   * PATCHes the server-side accounts.publicBoardHidden flag. Unlike the
   * weekly target, the SERVER owns this privacy flag — a failed PATCH reverts
   * the local flip with a warn haptic instead of letting the toggle lie.
   */
  function onPublicBoardToggle(show: boolean): void {
    // The row only renders when signed in, but guard anyway — the mirror is
    // account-scoped and must never be stamped without an account id.
    if (authStatus !== 'signedIn' || !authToken || !authUser) return;
    const accountId = authUser.id;
    const hidden = !show;
    publicBoardTouchedRef.current = true;
    setPublicBoardHiddenLocal(accountId, hidden);
    setPublicBoardHidden(authToken, hidden).catch(() => {
      warnHaptic();
      setPublicBoardHiddenLocal(accountId, !hidden);
    });
  }

  /** Build the 12-month JSON export and hand it to the OS share sheet. */
  async function onExport(): Promise<void> {
    if (exporting) return;
    setExporting(true);
    try {
      const shared = await shareTrainingData();
      // The OS sheet is the visual feedback — a haptic is all we add.
      if (shared) successHaptic();
    } catch {
      setExportError(
        "The share sheet didn't open. Your data is safe on this phone — give it another try in a moment.",
      );
    } finally {
      setExporting(false);
    }
  }

  /** Toggle the fingerprint lock — verify once before enabling. */
  async function onBiometricToggle(next: boolean): Promise<void> {
    if (bioBusy) return;
    if (!next) {
      setConfirmingBioOff(true); // custom yes/no popup
      return;
    }
    setBioBusy(true);
    try {
      const availability = await biometricsAvailable();
      if (availability === 'no_hardware') {
        setBioInfo("This phone doesn't support fingerprint or face unlock.");
        return;
      }
      if (availability === 'not_enrolled') {
        setBioInfo(
          'No fingerprint is set up on this phone yet. Add one in your phone settings first, then come back.',
        );
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Confirm fingerprint to enable app lock',
      });
      if (result.success) {
        setBiometricLock(true);
        successHaptic();
      } else {
        warnHaptic();
      }
    } finally {
      setBioBusy(false);
    }
  }

  // Latest logged body weight (refreshes on focus so a new weigh-in counts).
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void (async () => {
        const repo = await getRepo();
        const weights = await repo.getWeights(1);
        if (!mounted) return;
        const last = weights.length > 0 ? weights[weights.length - 1] : undefined;
        setLatestKg(last ? last.kg : null);
      })();
      return () => {
        mounted = false;
      };
    }, []),
  );

  // Re-validate the session on focus (silently signs out on 401).
  useFocusEffect(
    useCallback(() => {
      void useAuth.getState().refresh();
    }, []),
  );

  // Keep the "N earned" badges count fresh — cheap, idempotent, swallows errors.
  useFocusEffect(
    useCallback(() => {
      if (authStatus === 'signedIn') void useGamificationBadges.getState().hydrate();
    }, [authStatus]),
  );

  // Reconcile the public-board opt-out mirror from the server on focus. The
  // persisted mirror can go stale across account switches on this device or
  // a toggle flipped on ANOTHER device — the server owns this privacy flag,
  // so the toggle must never lie about actual visibility. Best-effort:
  // offline keeps the account-scoped local value (default = shown).
  useFocusEffect(
    useCallback(() => {
      const auth = useAuth.getState();
      if (auth.status !== 'signedIn' || auth.token === null || auth.user === null) return;
      const accountId = auth.user.id;
      void getPublicLeaderboard(auth.token)
        .then((res) => {
          // A toggle mid-flight is fresher than this read; a session change
          // mid-flight means the response belongs to the previous account.
          if (publicBoardTouchedRef.current) return;
          const current = useAuth.getState();
          if (current.status !== 'signedIn' || current.user?.id !== accountId) return;
          setPublicBoardHiddenLocal(accountId, res.me.hidden);
        })
        .catch(() => {
          // Offline or server hiccup — the server still enforces the real flag.
        });
      // authStatus dep: a sign-in while this screen is mounted refires the
      // reconcile for the new session (getState() reads the fresh values).
    }, [authStatus, setPublicBoardHiddenLocal]),
  );

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function commitName(): void {
    const trimmed = nameDraft.trim();
    if (trimmed) update({ displayName: trimmed });
    setEditingName(false);
  }

  async function onSignOut(): Promise<void> {
    if (signingOut) return;
    setSigningOut(true);
    await signOut(); // never throws; clears locally even offline
    setSigningOut(false);
    setConfirmingSignOut(false);
    successHaptic();
  }

  /**
   * "Sign out everywhere" — the server MUST confirm every session is revoked
   * before we clear locally, otherwise the button would lie about the other
   * devices. On failure the popup closes and a readable line appears under
   * the row; on success we run the normal local sign-out cleanup.
   */
  async function onLogoutAllConfirm(): Promise<void> {
    if (logoutAllBusy) return;
    const token = authToken;
    if (token === null) {
      setConfirmingLogoutAll(false);
      return;
    }
    setLogoutAllBusy(true);
    setLogoutAllError(null);
    try {
      await logoutAll(token);
    } catch (err) {
      setLogoutAllBusy(false);
      setConfirmingLogoutAll(false);
      setLogoutAllError(
        toApiError(err).code === 'unauthorized'
          ? 'This session has already expired — sign in again, then retry.'
          : "Couldn't reach the server — your other devices are still signed in. Try again in a moment.",
      );
      warnHaptic();
      return;
    }
    await signOut(); // never throws; clears local account state
    setLogoutAllBusy(false);
    setConfirmingLogoutAll(false);
    successHaptic();
  }

  /**
   * Final delete-account step — only reachable after the yes/no popup AND
   * typing DELETE. The server must confirm the hard-delete before any local
   * cleanup; a failure keeps the dialog open (text intact) with an inline
   * error so the user can retry without re-arming.
   */
  async function onDeleteConfirm(): Promise<void> {
    if (deleteBusy || deleteText.trim() !== 'DELETE') return;
    const token = authToken;
    if (token === null) {
      setDeleteStep('idle');
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteAccount(token, deleteText);
    } catch (err) {
      setDeleteBusy(false);
      setDeleteError(accountDeletionFailureMessage(toApiError(err)));
      warnHaptic();
      return;
    }
    // Account is gone server-side; run the normal local sign-out cleanup
    // (state set BEFORE navigation so nothing lands on an unmounted screen).
    setDeleteBusy(false);
    setDeleteStep('idle');
    setDeleteText('');
    await signOut({ purgeLocalAccountData: true }); // server deletion also purges this account's device rows
    // Whole-stack reset: back from the front door must not reopen the
    // deleted account's dashboard sitting underneath.
    resetStackTo('/welcome');
  }

  const recalcKg = latestKg ?? startWeightKg;
  const canRecalculate =
    sex !== null &&
    birthYear !== null &&
    heightCm !== null &&
    goalType !== null &&
    activityLevel !== null &&
    recalcKg !== null;

  function onRecalculate(): void {
    const next = recalcTargets({
      sex,
      birthYear,
      heightCm,
      goal: goalType,
      activity: activityLevel,
      kg: recalcKg,
    });
    if (next) {
      update({ targets: next });
      successHaptic();
    } else {
      warnHaptic();
    }
  }

  const signedIn = authStatus === 'signedIn' && authUser !== null;
  const nameInitial = (displayName.trim().charAt(0) || 'A').toUpperCase();
  const currentPlan = SEED_PLANS.find((p) => p.id === planId);

  return (
    <Screen scroll keyboardAware>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={goBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>
      <ScreenHeader title="Settings" eyebrow="Profile & preferences" />

      {/* ── Membership card — the tier as a premium metal card face. Tapping
          opens the subscription screen (upgrade / manage). ── */}
      <Animated.View entering={enterUp(0)} style={styles.membershipCardWrap}>
        <MembershipCard
          tier={serverTier}
          holderName={displayName || authUser?.displayName || ''}
          memberId={authUser?.id ?? null}
          signedIn={signedIn}
          onPress={() => pushPath('/subscribe')}
        />
      </Animated.View>

      {/* ── Account card — charcoal block: avatar, editable name, tier chip ── */}
      <Animated.View entering={enterUp(0)} style={styles.accountSection}>
        <View style={styles.accountCard}>
          <View style={styles.accountHeader}>
            <View style={styles.avatar}>
              <AppText style={styles.avatarInitial} tabular={false}>
                {nameInitial}
              </AppText>
            </View>
            <View style={styles.accountInfo}>
              {editingName ? (
                <AppTextInput
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  autoFocus
                  placeholder="Athlete"
                  style={styles.nameInput}
                  returnKeyType="done"
                  onSubmitEditing={commitName}
                  onBlur={commitName}
                  maxLength={24}
                  accessibilityLabel="Your name"
                />
              ) : (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Edit name"
                  onPress={() => {
                    setNameDraft(displayName);
                    setEditingName(true);
                  }}
                  hitSlop={8}
                  style={styles.nameRow}
                >
                  <AppText variant="bodyBold" numberOfLines={1} style={styles.nameText}>
                    {displayName || 'Athlete'}
                  </AppText>
                  <Ionicons name="pencil" size={16} color={colors.textDim} />
                </PressableScale>
              )}
              <AppText variant="caption" numberOfLines={1}>
                {signedIn && authUser ? authUser.email : 'Local only — sign in to sync'}
              </AppText>
            </View>
            <View style={styles.tierChip}>
              <AppText variant="label" color={colors.text}>
                {TIER_LABEL[serverTier]}
              </AppText>
            </View>
          </View>
          {serverTier !== 'elite' ? (
            <Button
              label="Upgrade"
              variant={signedIn && serverTier === 'starter' ? 'primary' : 'secondary'}
              onPress={() => pushPath('/subscribe')}
              accessibilityLabel="Upgrade your plan"
            />
          ) : null}
        </View>
        {signedIn ? (
          <ProfileGamification hidden={hideGamification} profile={gamification?.profile ?? null} />
        ) : null}
        {signedIn && !hideGamification ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Open badges"
            onPress={() => pushPath('/badges')}
            style={styles.badgesRow}
          >
            <Ionicons name="ribbon-outline" size={20} color={colors.textDim} />
            <AppText variant="body" style={styles.badgesRowText}>
              Badges
            </AppText>
            {/* Latest three earned badges as mini medals — a quiet trophy
                shelf on the profile card, newest first. */}
            {recentBadges.length > 0 ? (
              <View style={styles.badgesRecent}>
                {recentBadges.map(({ def, status }) => (
                  <BadgeMedal key={def.id} badge={def} status={status} size={24} />
                ))}
              </View>
            ) : null}
            <AppText variant="caption">{earnedBadgeCount} earned</AppText>
            <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
          </PressableScale>
        ) : null}
        {!signedIn ? (
          <View style={styles.authRow}>
            <Button
              label="Sign in"
              onPress={() => pushPath('/auth/sign-in')}
              style={styles.authBtn}
            />
            <Button
              label="Create account"
              variant="ghost"
              onPress={() => pushPath('/auth/sign-up')}
              style={styles.authBtn}
            />
          </View>
        ) : null}
      </Animated.View>

      {/* ── Your setup ──────────────────────────────────────── */}
      <Animated.View entering={enterUp(1)}>
        <AppText variant="label" style={styles.sectionLabel}>
          Your setup
        </AppText>
        <View style={styles.group}>
          <View style={styles.row}>
            <IconChip icon="male-female" size={36} />
            <AppText style={styles.rowLabel}>Sex</AppText>
            <View style={styles.rowControl}>
              {SEX_OPTIONS.map((o) => (
                <MiniChip
                  key={o.value}
                  label={o.title}
                  selected={sex === o.value}
                  onPress={() => update({ sex: o.value })}
                />
              ))}
            </View>
          </View>
          <View style={styles.row}>
            <IconChip icon="resize" size={36} />
            <AppText style={styles.rowLabel}>Height</AppText>
            <View style={styles.rowControl}>
              <MiniStepper
                value={heightCm ?? HEIGHT_CM.default}
                display={`${heightCm ?? HEIGHT_CM.default} cm`}
                onChange={(v) => update({ heightCm: v })}
                step={1}
                min={HEIGHT_CM.min}
                max={HEIGHT_CM.max}
                label="height"
              />
            </View>
          </View>
          <View style={styles.row}>
            <IconChip icon="calendar" size={36} />
            <AppText style={styles.rowLabel}>Born</AppText>
            <View style={styles.rowControl}>
              <MiniStepper
                value={birthYear ?? BIRTH_YEAR.default}
                onChange={(v) => update({ birthYear: v })}
                step={1}
                min={BIRTH_YEAR.min}
                max={BIRTH_YEAR.max}
                label="birth year"
              />
            </View>
          </View>
          <View style={styles.row}>
            <IconChip icon="scale" size={36} />
            <AppText style={styles.rowLabel}>Units</AppText>
            <View style={styles.rowControl}>
              <MiniChip
                label="kg"
                selected={unitPref === 'kg'}
                onPress={() => update({ unitPref: 'kg' })}
              />
              <MiniChip
                label="lb"
                selected={unitPref === 'lb'}
                onPress={() => update({ unitPref: 'lb' })}
              />
            </View>
          </View>
          <View style={[styles.row, styles.rowWrap]}>
            <IconChip icon="text" size={36} />
            <AppText style={styles.rowLabel}>Text size</AppText>
            <View style={styles.rowControl}>
              {FONT_SCALE_OPTIONS.map((o) => (
                <MiniChip
                  key={o.value}
                  label={o.label}
                  selected={fontScale === o.value}
                  onPress={() => update({ fontScale: o.value })}
                />
              ))}
            </View>
          </View>
        </View>
      </Animated.View>

      {/* ── Daily targets ───────────────────────────────────── */}
      <Animated.View entering={enterUp(2)}>
        <AppText variant="label" style={styles.sectionLabel}>
          Daily targets
        </AppText>
        <View style={styles.group}>
          <View style={styles.targetsRow}>
            <TargetCell label="kcal" value={targets.kcal} color={colors.kcal} />
            <TargetCell label="Protein" value={targets.protein} color={colors.protein} />
            <TargetCell label="Carbs" value={targets.carbs} color={colors.carbs} />
            <TargetCell label="Fat" value={targets.fat} color={colors.fat} />
          </View>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Recalculate targets from profile — uses your latest logged body weight"
            accessibilityState={{ disabled: !canRecalculate }}
            disabled={!canRecalculate}
            onPress={onRecalculate}
            style={[styles.recalcRow, !canRecalculate && styles.recalcDisabled]}
          >
            <Ionicons name="refresh" size={16} color={colors.text} />
            <AppText variant="bodyBold">Recalculate from profile</AppText>
          </PressableScale>
        </View>
      </Animated.View>

      {/* ── Training plan ───────────────────────────────────── */}
      <Animated.View entering={enterUp(3)} layout={layoutSpring}>
        <AppText variant="label" style={styles.sectionLabel}>
          Training plan
        </AppText>
        <View style={styles.group}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Training plan"
            accessibilityState={{ expanded: planOpen }}
            onPress={() => setPlanOpen((o) => !o)}
            style={styles.row}
          >
            <IconChip icon="barbell" size={36} />
            <AppText variant="bodyBold" numberOfLines={1} style={styles.planName}>
              {currentPlan ? currentPlan.name : 'Choose a plan'}
            </AppText>
            <Ionicons
              name={planOpen ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.textDim}
            />
          </PressableScale>
          {planOpen ? (
            <Animated.View entering={enterFade()}>
              {SEED_PLANS.map((p) => (
                <View key={p.id}>
                  <PressableScale
                    accessibilityRole="radio"
                    accessibilityState={{ selected: planId === p.id }}
                    accessibilityLabel={`Plan: ${p.name}`}
                    onPress={() => {
                      update({ planId: p.id });
                      setPlanOpen(false);
                    }}
                    style={styles.planOption}
                  >
                    <View style={styles.planInfo}>
                      <AppText variant="bodyBold">{p.name}</AppText>
                      <AppText variant="caption">
                        {p.daysPerWeek} days a week · {p.weeks} weeks
                      </AppText>
                    </View>
                    <Ionicons
                      name={planId === p.id ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={planId === p.id ? colors.accent : colors.textFaint}
                    />
                  </PressableScale>
                </View>
              ))}
            </Animated.View>
          ) : null}
        </View>
      </Animated.View>

      {/* ── Subscription ────────────────────────────────────── */}
      <Animated.View entering={enterUp(4)} layout={layoutSpring}>
        <View style={[styles.group, styles.subscriptionBlock]}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Subscription — current plan ${TIER_LABEL[serverTier]}`}
            onPress={() => pushPath('/subscribe')}
            style={styles.row}
          >
            <IconChip icon="card" size={36} />
            <AppText style={styles.rowLabelGrow} numberOfLines={1}>Subscription</AppText>
            <View style={styles.rowValue}>
              <AppText color={colors.textDim} numberOfLines={1}>{TIER_LABEL[serverTier]}</AppText>
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            </View>
          </PressableScale>
        </View>
      </Animated.View>

      {/* ── Community — invite friends + the public gym board ── */}
      <Animated.View entering={enterUp(5)} layout={layoutSpring}>
        <AppText variant="label" style={styles.sectionLabel}>
          Community
        </AppText>
        <View style={styles.group}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Invite friends — you both earn a subscription discount"
            onPress={() => pushPath('/invite')}
            style={styles.row}
          >
            <IconChip icon="gift-outline" size={36} />
            <AppText variant="bodyBold" style={styles.rowLabelGrow} numberOfLines={1}>
              Invite friends
            </AppText>
            <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Gym leaderboard — this month's consistency ranking, whole gym"
            onPress={() => pushPath('/leaderboard')}
            style={styles.row}
          >
            <IconChip icon="podium" size={36} />
            <AppText variant="bodyBold" style={styles.rowLabelGrow} numberOfLines={1}>
              Gym leaderboard
            </AppText>
            <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
          </PressableScale>
        </View>
      </Animated.View>

      {/* ── Staff console ───────────────────────────────────── */}
      {/* Only staff accounts see this; taps route OUTSIDE the onboarding gate. */}
      {staffRole !== null && staffPermissions.length > 0 ? (
        <Animated.View entering={enterUp(4)} layout={layoutSpring}>
          <AppText variant="label" style={styles.sectionLabel}>
            Staff
          </AppText>
          <View style={styles.group}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Staff console"
              onPress={() => pushStaff(STAFF_ROUTES.hub)}
              style={styles.row}
            >
              <IconChip
                icon="briefcase"
                size={36}
                color={colors.accentFaint}
                iconColor={colors.accent}
              />
              <AppText variant="bodyBold" style={styles.rowLabelGrow} numberOfLines={1}>
                Staff console
              </AppText>
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            </PressableScale>
          </View>
        </Animated.View>
      ) : null}

      {/* ── Support ─────────────────────────────────────────── */}
      {/* Coach chat moved to a prominent Home entry; support stays here.
          Open to every tier (SCALE-UP-PLAN §4.4) — Elite just keeps the
          priority-copy hero once inside; the row itself is never gated. */}
      <Animated.View entering={enterUp(5)} layout={layoutSpring}>
        <AppText variant="label" style={styles.sectionLabel}>
          Support
        </AppText>
        <View style={styles.group}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={
              supportUnread > 0 ? `Support, ${supportUnread} unread` : 'Support'
            }
            onPress={() => pushPath('/support')}
            style={styles.row}
          >
            <IconChip icon="shield-checkmark" size={36} />
            <AppText variant="bodyBold" style={styles.rowLabelGrow} numberOfLines={1}>
              {hasEntitlement({ tier }, 'coach_chat') ? 'Priority support' : 'Support'}
            </AppText>
            {supportUnread > 0 ? (
              <View style={styles.unreadPill} accessibilityLabel={`${supportUnread} unread`}>
                <AppText variant="label" color={colors.onBlock} tabular>
                  {supportUnread > 9 ? '9+' : String(supportUnread)}
                </AppText>
              </View>
            ) : null}
            <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
          </PressableScale>
        </View>
      </Animated.View>

      {/* ── Reminders (local, recurring) ────────────────────── */}
      <Animated.View entering={enterUp(6)} layout={layoutSpring}>
        <AppText variant="label" style={styles.sectionLabel}>
          Reminders
        </AppText>
        <View style={styles.group}>
          {/* Row 1 — workout reminders + inline day/time controls. */}
          <View style={styles.reminderHeader}>
            <IconChip icon="alarm" size={36} />
            <AppText variant="bodyBold" style={styles.rowLabelGrow} numberOfLines={1}>
              Workout reminders
            </AppText>
            <Switch
              value={workoutRemindersOn}
              onValueChange={onWorkoutRemindersToggle}
              trackColor={{ false: colors.surfaceRaised, true: colors.accentDim }}
              thumbColor={workoutRemindersOn ? colors.accent : colors.textDim}
              accessibilityLabel="Workout reminders"
            />
          </View>
          {workoutRemindersOn ? (
            <Animated.View entering={enterFade()} style={styles.reminderDetail}>
              <View style={styles.dayRow}>
                {WEEKDAY_CHIPS.map((d) => (
                  <DayChip
                    key={d.weekday}
                    letter={d.letter}
                    name={d.name}
                    selected={reminderWeekdays.includes(d.weekday)}
                    onPress={() => onToggleWeekday(d.weekday)}
                  />
                ))}
              </View>
              <View style={styles.timeRow}>
                <AppText color={colors.textDim} numberOfLines={1} style={styles.timeLabel}>
                  Time
                </AppText>
                <View style={styles.timeControls}>
                  <MiniStepper
                    value={reminderHour}
                    display={String(reminderHour).padStart(2, '0')}
                    onChange={(v) => onReminderTimeChange(v, reminderMinute)}
                    step={1}
                    min={0}
                    max={23}
                    label="hour"
                    valueStyle={styles.timeStepperValue}
                  />
                  <AppText style={styles.timeColon} tabular>
                    :
                  </AppText>
                  <MiniStepper
                    value={reminderMinute}
                    display={String(reminderMinute).padStart(2, '0')}
                    onChange={(v) => onReminderTimeChange(reminderHour, v)}
                    step={5}
                    min={0}
                    max={55}
                    label="minute"
                    valueStyle={styles.timeStepperValue}
                  />
                </View>
              </View>
            </Animated.View>
          ) : null}
          {/* Row 2 — daily morning nudge. */}
          <View style={styles.row}>
            <IconChip icon="sunny" size={36} />
            <AppText style={styles.rowLabelGrow} numberOfLines={1}>Morning nudge</AppText>
            <Switch
              value={morningNudgeOn}
              onValueChange={onMorningNudgeToggle}
              trackColor={{ false: colors.surfaceRaised, true: colors.accentDim }}
              thumbColor={morningNudgeOn ? colors.accent : colors.textDim}
              accessibilityLabel="Morning nudge"
            />
          </View>
          {/* Row 3 — weekly Sunday check-in. */}
          <View style={styles.row}>
            <IconChip icon="calendar-clear" size={36} />
            <AppText style={styles.rowLabelGrow} numberOfLines={1}>
              Sunday check-in reminder
            </AppText>
            <Switch
              value={checkInReminderOn}
              onValueChange={onCheckInToggle}
              trackColor={{ false: colors.surfaceRaised, true: colors.accentDim }}
              thumbColor={checkInReminderOn ? colors.accent : colors.textDim}
              accessibilityLabel="Sunday check-in reminder"
            />
          </View>
        </View>
      </Animated.View>

      {/* ── Achievements ────────────────────────────────────── */}
      <Animated.View entering={enterUp(7)} layout={layoutSpring}>
        <AppText variant="label" style={styles.sectionLabel}>
          Achievements
        </AppText>
        <View style={styles.group}>
          <View style={styles.row}>
            <IconChip icon="calendar-number" size={36} />
            <AppText style={styles.rowLabelGrow} numberOfLines={1}>
              Weekly session target
            </AppText>
            <MiniStepper
              value={daysPerWeek}
              display={`${daysPerWeek}/wk`}
              onChange={onWeeklyTargetChange}
              step={1}
              min={2}
              max={7}
              label="weekly session target"
              valueStyle={styles.timeStepperValue}
            />
          </View>
          <View style={styles.row}>
            <IconChip icon="eye-off" size={36} />
            <AppText style={styles.rowLabelGrow} numberOfLines={1}>
              Hide achievements
            </AppText>
            <Switch
              value={hideGamification}
              onValueChange={setHideGamification}
              trackColor={{ false: colors.surfaceRaised, true: colors.accentDim }}
              thumbColor={hideGamification ? colors.accent : colors.textDim}
              accessibilityLabel="Hide achievements"
            />
          </View>
          {/* Public-board opt-out — server-side privacy flag, so only shown
              when signed in. Optimistic flip; a failed PATCH reverts with a
              warn haptic (the server flag is the source of truth). */}
          {signedIn ? (
            <View style={styles.row}>
              <IconChip icon="podium" size={36} />
              <AppText style={styles.rowLabelGrow} numberOfLines={2}>
                Show me on the public leaderboard
              </AppText>
              <Switch
                value={!publicBoardHidden}
                onValueChange={onPublicBoardToggle}
                trackColor={{ false: colors.surfaceRaised, true: colors.accentDim }}
                thumbColor={!publicBoardHidden ? colors.accent : colors.textDim}
                accessibilityLabel="Show me on the public leaderboard"
              />
            </View>
          ) : null}
        </View>
      </Animated.View>

      {/* ── Your data ───────────────────────────────────────── */}
      <Animated.View entering={enterUp(7)} layout={layoutSpring}>
        <AppText variant="label" style={styles.sectionLabel}>
          Your data
        </AppText>
        <View style={styles.group}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Export training data — last 12 months as JSON"
            accessibilityState={{ disabled: exporting, busy: exporting }}
            disabled={exporting}
            onPress={() => void onExport()}
            style={styles.row}
          >
            <IconChip icon="download" size={36} />
            <View style={styles.exportInfo}>
              <AppText variant="bodyBold" numberOfLines={1}>
                Export training data
              </AppText>
              <AppText variant="caption" numberOfLines={1}>
                Last 12 months, JSON
              </AppText>
            </View>
            {exporting ? (
              <ActivityIndicator size="small" color={colors.textDim} />
            ) : (
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            )}
          </PressableScale>
        </View>
      </Animated.View>

      {/* ── Security ────────────────────────────────────────── */}
      {Platform.OS !== 'web' ? (
        <Animated.View entering={enterUp(7)} layout={layoutSpring}>
          <AppText variant="label" style={styles.sectionLabel}>
            Security
          </AppText>
          <View style={[styles.group, styles.securityCard]}>
            <View style={styles.securityHeader}>
              <IconChip
                icon="finger-print"
                size={36}
                color={colors.accentFaint}
                iconColor={colors.accent}
              />
              <AppText variant="bodyBold" style={styles.securityTitle} numberOfLines={1}>
                App lock
              </AppText>
              {bioBusy ? (
                <ActivityIndicator size="small" color={colors.textDim} />
              ) : null}
              <Switch
                value={biometricLock}
                disabled={bioBusy}
                onValueChange={(v) => void onBiometricToggle(v)}
                trackColor={{ false: colors.surfaceRaised, true: colors.accentDim }}
                thumbColor={biometricLock ? colors.accent : colors.textDim}
                accessibilityLabel="App lock"
              />
            </View>
            <AppText
              variant="caption"
              color={biometricLock ? colors.textDim : colors.textFaint}
              style={styles.securityStatus}
            >
              {biometricLock
                ? 'Locked with your fingerprint when you leave the app'
                : 'Anyone with your phone can open the app'}
            </AppText>
          </View>
        </Animated.View>
      ) : null}

      {/* ── Danger zone — black block, destructive last ─────── */}
      {signedIn ? (
        <Animated.View entering={enterUp(8)} layout={layoutSpring} style={styles.dangerBlock}>
          <AppText variant="label">Danger zone</AppText>
          <Button
            label="Sign out"
            variant="secondary"
            onPress={() => setConfirmingSignOut(true)}
          />
          <Button
            label="Sign out everywhere"
            variant="ghost"
            loading={logoutAllBusy}
            onPress={() => {
              setLogoutAllError(null);
              setConfirmingLogoutAll(true);
            }}
          />
          {logoutAllError !== null ? (
            <AppText variant="caption" color={colors.error} center style={styles.accountError}>
              {logoutAllError}
            </AppText>
          ) : null}
          {/* Delete account — red TEXT button (never the accent CTA); same
              handler + busy behavior as the old outlined danger button. */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Delete account"
            accessibilityState={{ disabled: deleteBusy }}
            disabled={deleteBusy}
            onPress={() => {
              setDeleteError(null);
              setDeleteText('');
              setDeleteStep('confirm');
            }}
            style={[styles.deleteBtn, deleteBusy && styles.deleteBtnBusy]}
          >
            {deleteBusy ? <ActivityIndicator size="small" color={colors.error} /> : null}
            <AppText variant="bodyBold" color={colors.error}>
              Delete account
            </AppText>
          </PressableScale>
          {deleteStep === 'idle' && deleteError !== null ? (
            <AppText variant="caption" color={colors.error} center style={styles.accountError}>
              {deleteError}
            </AppText>
          ) : null}
        </Animated.View>
      ) : null}

      {/* ── Custom yes/no popups ────────────────────────────── */}
      <ConfirmDialog
        visible={confirmingSignOut}
        title="Sign out?"
        message="Your logs stay safe on this phone — signing out only disconnects your account."
        confirmLabel={signingOut ? 'Signing out…' : 'Yes, sign out'}
        cancelLabel="No, stay"
        danger
        onConfirm={() => void onSignOut()}
        onCancel={() => setConfirmingSignOut(false)}
      />
      <ConfirmDialog
        visible={confirmingLogoutAll}
        title="Sign out everywhere?"
        message="Every device signed in to this account gets disconnected, including this one. Your logs stay safe on this phone."
        confirmLabel={logoutAllBusy ? 'Signing out…' : 'Yes, sign out everywhere'}
        cancelLabel="No, stay"
        danger
        onConfirm={() => void onLogoutAllConfirm()}
        onCancel={() => {
          if (!logoutAllBusy) setConfirmingLogoutAll(false);
        }}
      />
      {/* Delete account, step 1 of 2 — plain-words permanence warning. */}
      <ConfirmDialog
        visible={deleteStep === 'confirm'}
        title="Delete your account?"
        message="This permanently erases your sign-in, health and training data, and private progress photos. Active services must be closed first; billing and order history may require support-assisted anonymization. After the server confirms, this device’s local health and training logs are also removed."
        confirmLabel="Continue"
        cancelLabel="Keep my account"
        danger
        onConfirm={() => {
          setDeleteText('');
          setDeleteStep('type');
        }}
        onCancel={() => setDeleteStep('idle')}
      />
      {/* Delete account, step 2 of 2 — typed-DELETE arm switch. */}
      <DeleteAccountDialog
        visible={deleteStep === 'type'}
        email={authUser?.email ?? 'this account'}
        value={deleteText}
        onChangeValue={setDeleteText}
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void onDeleteConfirm()}
        onCancel={() => {
          if (!deleteBusy) setDeleteStep('idle');
        }}
      />
      <ConfirmDialog
        visible={confirmingBioOff}
        title="Turn off fingerprint lock?"
        message="Anyone with your phone will be able to open the app."
        confirmLabel="Yes, turn off"
        cancelLabel="No, keep it"
        danger
        onConfirm={() => {
          setBiometricLock(false);
          setConfirmingBioOff(false);
          tapHaptic();
        }}
        onCancel={() => setConfirmingBioOff(false)}
      />
      <ConfirmDialog
        visible={exportError !== null}
        title="Export didn't work"
        message={exportError ?? ''}
        confirmLabel="OK"
        hideCancel
        onConfirm={() => setExportError(null)}
        onCancel={() => setExportError(null)}
      />
      <ConfirmDialog
        visible={bioInfo !== null}
        title="Fingerprint unavailable"
        message={bioInfo ?? ''}
        confirmLabel="OK"
        hideCancel
        onConfirm={() => setBioInfo(null)}
        onCancel={() => setBioInfo(null)}
      />

      {/* ── About ───────────────────────────────────────────── */}
      <Animated.View layout={layoutSpring}>
        <AppText variant="caption" color={colors.textFaint} center style={styles.about}>
          v0.1.0 · Food data: Open Food Facts · Exercises: free-exercise-db · Anatomy art: MuscleMapJS
          (MIT) · 3D anatomy: Z-Anatomy — The libre 3D atlas of anatomy (CC BY-SA 4.0), based on
          BodyParts3D — The Database Center for Life Science (CC BY-SA 2.1 Japan); modified for this app
        </AppText>
      </Animated.View>
    </Screen>
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
  sectionLabel: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },

  // Account card — charcoal block: avatar + editable name + tier chip
  membershipCardWrap: { marginTop: spacing.xl },
  accountSection: { marginTop: spacing.md },
  accountCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.lg,
  },
  accountHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  accountInfo: { flex: 1, minWidth: 0, gap: 2 },
  // Outlined meta pill (brief §6) — chips may carry strokes; cards may not.
  tierChip: {
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontFamily: type.display, fontSize: 24, color: colors.text },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
  },
  nameText: { flexShrink: 1 },
  nameInput: {
    minHeight: 40,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  authRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  authBtn: { flex: 1 },
  // Badges shelf — its own small charcoal row block under the account card.
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  badgesRowText: { flex: 1 },
  badgesRecent: { flexDirection: 'row', gap: 4 },

  // Charcoal section block — NO border; spacing (not hairlines) between rows
  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 54,
    paddingVertical: spacing.sm,
  },
  rowWrap: { minHeight: 64 },
  rowLabel: { flexShrink: 1, minWidth: 0 },
  // Label that must take the row's leftover width and push a trailing Switch to
  // the edge (reminder toggles, subscription) — flexes and truncates.
  rowLabelGrow: { flex: 1, flexShrink: 1, minWidth: 0 },
  rowControl: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  rowValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  // Trailing lock affordance for gated Elite rows (Tag + small lock icon).
  lockedValue: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Unread-count pill on the Support row (accent-fill badge language).
  unreadPill: {
    minWidth: 20,
    height: 20,
    borderRadius: radius.full,
    paddingHorizontal: 6,
    backgroundColor: colors.blockRed,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Mini chips (row-scale variant of ui/Chip)
  miniChip: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Selected = solid red pill with BLACK label (black-on-red brand law).
  miniChipSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
  miniChipText: {
    fontFamily: type.bodyMedium,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // Reminders — header row, revealed detail, day picker, time control
  reminderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 54,
    paddingVertical: spacing.sm,
  },
  reminderDetail: { paddingBottom: spacing.md, gap: spacing.md },
  // Seven equal cells that flex to fill the card width — chips shrink to fit on
  // narrow phones instead of the row spilling past the group border.
  dayRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  dayChip: {
    flex: 1,
    minWidth: 0,
    aspectRatio: 1,
    maxWidth: 40,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayChipSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
  dayChipText: {
    fontFamily: type.bodyMedium,
    fontSize: 13,
    letterSpacing: 0.5,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  timeLabel: { flexShrink: 1, minWidth: 0 },
  timeControls: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  timeColon: { fontFamily: type.display, fontSize: 18, color: colors.textDim },
  // The clock steppers only ever show 2 padded digits — a narrower value cell
  // than the profile steppers ("175 cm") so both HH:MM fit one row.
  timeStepperValue: { minWidth: 34 },

  // Mini stepper (row-scale variant of ui/Stepper)
  miniStepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  miniStepBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniStepBtnPressed: { backgroundColor: colors.surfacePressed, transform: [{ scale: 0.96 }] },
  miniStepSign: {
    fontFamily: type.bodySemiBold,
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
  },
  miniStepValue: {
    fontFamily: type.display,
    fontSize: 18,
    color: colors.text,
    minWidth: 56,
    textAlign: 'center',
  },

  // Daily targets strip
  targetsRow: { flexDirection: 'row', paddingVertical: spacing.md },
  targetCell: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2, paddingHorizontal: 2 },
  targetValue: { fontFamily: type.display, fontSize: 20, color: colors.text },
  targetLabel: {
    fontFamily: type.display,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  recalcRow: {
    minHeight: touch.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  recalcDisabled: { opacity: 0.4 },

  // Training plan
  planName: { flex: 1 },
  planOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 54,
  },
  planInfo: { flex: 1, gap: 2 },

  subscriptionBlock: { marginTop: spacing.xl },

  // Your data — two-line export row (title + caption, like plan options)
  exportInfo: { flex: 1, minWidth: 0, gap: 2 },

  // Security card
  securityCard: { paddingVertical: spacing.lg, gap: spacing.sm },
  securityHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  securityTitle: { flex: 1 },
  securityStatus: { lineHeight: 18 },

  // Danger zone — black block that recedes behind the charcoal sections
  dangerBlock: {
    marginTop: spacing.xxl,
    backgroundColor: colors.bg,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.sm,
  },
  // Red TEXT button — quiet, centered, ≥48dp; spinner replaces nothing (the
  // label stays put) so the row never jumps while deleting.
  deleteBtn: {
    minHeight: touch.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  deleteBtnBusy: { opacity: 0.4 },
  accountError: { paddingHorizontal: spacing.lg, lineHeight: 18 },
  about: { marginTop: spacing.xl },

  // Delete-account dialog — mirrors ui/ConfirmDialog's backdrop + card so the
  // two popups are visually indistinguishable (same scrim, radius, gaps).
  dialogFill: { flex: 1 },
  dialogBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)', // same scrim literal as ui/ConfirmDialog
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 330,
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.sm,
  },
  dialogButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  dialogBtn: { flex: 1 },
});
