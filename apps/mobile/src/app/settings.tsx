import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import * as LocalAuthentication from 'expo-local-authentication';
import type { FontScale, Tier } from '@gym/shared';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  ConfirmDialog,
  Divider,
  IconChip,
  PressableScale,
  Screen,
  Tag,
  enterDown,
  enterFade,
  enterUp,
} from '../components/ui';
import { successHaptic, tapHaptic, warnHaptic } from '../lib/haptics';
import {
  scheduleCheckInReminder,
  scheduleMorningNudge,
  scheduleWorkoutReminders,
} from '../lib/notifications';
import { getRepo } from '../lib/repo';
import { SEED_PLANS } from '../lib/seed/plans';
import { useAuth } from '../state/auth';
import { useProfile } from '../state/profile';
import { useReminders } from '../state/reminders';
import { useSecurity } from '../state/security';
import { pushPath } from '../features/auth/nav';
import { biometricsAvailable } from '../features/security/AppLock';
import {
  BIRTH_YEAR,
  HEIGHT_CM,
  recalcTargets,
  SEX_OPTIONS,
} from '../features/onboarding/logic';

/**
 * /settings — one profile card, then three compact groups (setup, targets,
 * plan), a subscription row, and the quiet sign-out + about footer.
 * Everything is dense on purpose: 52–56dp rows inside bordered surfaces.
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
      hitSlop={6}
      style={[styles.miniChip, selected && styles.miniChipSelected]}
    >
      <AppText
        style={styles.miniChipText}
        color={selected ? colors.text : colors.textDim}
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
      hitSlop={4}
      style={[styles.dayChip, selected && styles.dayChipSelected]}
    >
      <AppText
        style={styles.dayChipText}
        color={selected ? colors.text : colors.textDim}
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
}: {
  value: number;
  display?: string;
  onChange: (next: number) => void;
  step: number;
  min: number;
  max: number;
  label: string;
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
      <AppText style={styles.miniStepValue} tabular>
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
      <AppText style={styles.targetValue} tabular>
        {value}
      </AppText>
      <AppText style={[styles.targetLabel, { color }]} tabular={false}>
        {label}
      </AppText>
    </View>
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
  const tier = useProfile((s) => s.tier);
  const update = useProfile((s) => s.update);

  const authStatus = useAuth((s) => s.status);
  const authUser = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [latestKg, setLatestKg] = useState<number | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

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
        <AppText variant="heading">Settings</AppText>
      </Animated.View>

      {/* ── Profile card ────────────────────────────────────── */}
      <Animated.View entering={enterUp(0)}>
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <AppText style={styles.avatarInitial} tabular={false}>
              {nameInitial}
            </AppText>
          </View>
          <View style={styles.profileInfo}>
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
          <Tag label={TIER_LABEL[tier]} variant="dim" />
        </View>
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
          <Divider />
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
          <Divider />
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
          <Divider />
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
          <Divider />
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
          <Divider />
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
      <Animated.View entering={enterUp(3)}>
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
                  <Divider />
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
      <Animated.View entering={enterUp(4)}>
        <View style={[styles.group, styles.subscriptionBlock]}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Subscription — current plan ${TIER_LABEL[tier]}`}
            onPress={() => pushPath('/subscribe')}
            style={styles.row}
          >
            <IconChip icon="card" size={36} />
            <AppText style={styles.rowLabel}>Subscription</AppText>
            <View style={styles.rowValue}>
              <AppText color={colors.textDim}>{TIER_LABEL[tier]}</AppText>
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            </View>
          </PressableScale>
        </View>
      </Animated.View>

      {/* ── Reminders (local, recurring) ────────────────────── */}
      <Animated.View entering={enterUp(5)}>
        <AppText variant="label" style={styles.sectionLabel}>
          Reminders
        </AppText>
        <View style={styles.group}>
          {/* Row 1 — workout reminders + inline day/time controls. */}
          <View style={styles.reminderHeader}>
            <IconChip icon="alarm" size={36} />
            <AppText variant="bodyBold" style={styles.rowLabel}>
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
                <AppText color={colors.textDim}>Time</AppText>
                <View style={styles.timeControls}>
                  <MiniStepper
                    value={reminderHour}
                    display={String(reminderHour).padStart(2, '0')}
                    onChange={(v) => onReminderTimeChange(v, reminderMinute)}
                    step={1}
                    min={0}
                    max={23}
                    label="hour"
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
                  />
                </View>
              </View>
            </Animated.View>
          ) : null}
          <Divider />
          {/* Row 2 — daily morning nudge. */}
          <View style={styles.row}>
            <IconChip icon="sunny" size={36} />
            <AppText style={styles.rowLabel}>Morning nudge</AppText>
            <Switch
              value={morningNudgeOn}
              onValueChange={onMorningNudgeToggle}
              trackColor={{ false: colors.surfaceRaised, true: colors.accentDim }}
              thumbColor={morningNudgeOn ? colors.accent : colors.textDim}
              accessibilityLabel="Morning nudge"
            />
          </View>
          <Divider />
          {/* Row 3 — weekly Sunday check-in. */}
          <View style={styles.row}>
            <IconChip icon="calendar-clear" size={36} />
            <AppText style={styles.rowLabel}>Sunday check-in reminder</AppText>
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

      {/* ── Security ────────────────────────────────────────── */}
      {Platform.OS !== 'web' ? (
        <Animated.View entering={enterUp(6)}>
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
              <AppText variant="bodyBold" style={styles.securityTitle}>
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

      {/* ── Sign out (destructive actions live last) ────────── */}
      {signedIn ? (
        <Animated.View entering={enterUp(7)} style={styles.signOutBlock}>
          <Button
            label="Sign out"
            variant="ghost"
            onPress={() => setConfirmingSignOut(true)}
          />
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
        visible={bioInfo !== null}
        title="Fingerprint unavailable"
        message={bioInfo ?? ''}
        confirmLabel="OK"
        hideCancel
        onConfirm={() => setBioInfo(null)}
        onCancel={() => setBioInfo(null)}
      />

      {/* ── About ───────────────────────────────────────────── */}
      <AppText variant="caption" color={colors.textFaint} center style={styles.about}>
        v0.1.0 · Food data: Open Food Facts · Exercises: free-exercise-db
      </AppText>
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

  // Profile card
  profileCard: {
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
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontFamily: type.display, fontSize: 24, color: colors.text },
  profileInfo: { flex: 1, gap: 2 },
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
  authBtn: { flex: 1, minHeight: 44 },

  // Bordered group of compact rows
  group: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 54,
    paddingVertical: spacing.sm,
  },
  rowWrap: { minHeight: 64 },
  rowLabel: { flexShrink: 1 },
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
  miniChipSelected: { borderColor: colors.text },
  miniChipText: {
    fontFamily: type.bodyMedium,
    fontSize: 11,
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
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  dayChip: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayChipSelected: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  dayChipText: {
    fontFamily: type.bodyMedium,
    fontSize: 13,
    letterSpacing: 0.5,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  timeColon: { fontFamily: type.display, fontSize: 18, color: colors.textDim },

  // Mini stepper (row-scale variant of ui/Stepper)
  miniStepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  miniStepBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
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
  targetCell: { flex: 1, alignItems: 'center', gap: 2 },
  targetValue: { fontFamily: type.display, fontSize: 20, color: colors.text },
  targetLabel: {
    fontFamily: type.display,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  recalcRow: {
    minHeight: 44,
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

  // Security card
  securityCard: { paddingVertical: spacing.lg, gap: spacing.sm },
  securityHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  securityTitle: { flex: 1 },
  securityStatus: { lineHeight: 18 },

  // Sign out + about footer
  signOutBlock: { marginTop: spacing.xxl },
  signOutConfirm: { gap: spacing.sm },
  signOutButtons: { flexDirection: 'row', gap: spacing.md },
  signOutButton: { flex: 1 },
  about: { marginTop: spacing.xl },
});
