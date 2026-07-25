import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import type { UnitPref } from '@gym/shared';
import { inputToKg, selectTrainingPlan } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  enterFade,
  FractionStat,
  OptionCard,
  PressableScale,
  ProgressBar,
  Screen,
  Stepper,
} from '../../components/ui';
import { toApiError } from '../../lib/api/client';
import { todayIso } from '../../lib/dates';
import { successHaptic, warnHaptic } from '../../lib/haptics';
import { uid } from '../../lib/id';
import { resetStackTo } from '../../lib/nav';
import { registerForPushNotificationsAsync } from '../../lib/notifications';
import { syncProfileNow } from '../../lib/profileSync';
import { getRepo } from '../../lib/repo';
import { useTrainingCatalog } from '../../lib/trainingCatalog';
import { useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';
import { requestHealthConnectPermission, requestStepPermission } from '../activity/pedometer';
import { CountUpStat } from './components/CountUpStat';
import { NewieStage } from './components/NewieStage';
import {
  clearOnboardingProgress,
  useOnboardingProgress,
  useOnboardingProgressHydrated,
} from './draftStore';
import {
  ACTIVITY_OPTIONS,
  BIRTH_YEAR,
  cmToInches,
  DAYS_PER_WEEK,
  draftTargets,
  formatFeetInches,
  formatWeightValue,
  GOAL_OPTIONS,
  HEIGHT_CM,
  HEIGHT_IN,
  inchesToCm,
  SEX_OPTIONS,
  TOTAL_STEPS,
  UNIT_OPTIONS,
  WEIGHT_DEFAULTS,
  WEIGHT_RANGES,
  WEIGHT_STEPS,
  type OnboardingDraft,
} from './logic';

/**
 * Onboarding as a conversation with Newie. Layout contract (bulletproof):
 * header + progress on top, the conversation + answers scroll in the middle,
 * and the Continue button lives OUTSIDE the scroll — always on screen.
 * Answers are never hidden behind typing state.
 *
 * THE ACCOUNT IS PART OF SETUP (not an afterthought). Programs and the
 * exercise library are published in Neon and only reach a member through the
 * authenticated catalog read, so finishing setup signed out used to drop the
 * member on a Train tab that said "Sign in for training programs", an empty
 * library, and a Home card that pushed them straight back to that tab. The
 * last step therefore asks for a free account BEFORE the app opens: the
 * locally computed targets are shown first (the payoff needs no account),
 * then the account block, then the matched program once the catalog lands.
 *
 * The one exception is a member whose sign-up couldn't reach us at all
 * (offline). Trapping them in a wizard they can't leave would be worse than
 * letting them in, so that failure — and only that failure — offers a way to
 * finish setup now, with copy that says plainly what stays empty until the
 * account exists.
 */

/** Steps whose OptionCards auto-advance (no bottom button). */
const OPTION_STEPS = new Set([2, 4, 7, 8]);
/** Permission step renders its own Allow/Later buttons — no shared footer. */
const PERMISSION_STEP = 10;

/**
 * Field checks that mirror the account screens (features/auth/validation.ts)
 * and the server's own rules. Deliberately loose: this only catches typos
 * before a round trip, the server is still the judge. Duplicated rather than
 * imported because feature modules never import each other (CLAUDE.md rule 2).
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;

function emailIssue(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return 'Enter your email';
  if (!EMAIL_PATTERN.test(trimmed)) return "That doesn't look like an email";
  return null;
}

function passwordIssue(password: string): string | null {
  if (!password) return 'Choose a password';
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  return null;
}

/**
 * One question per step, and step one is a real question: the standalone
 * "hello, this takes 60 seconds" screen collected nothing and contradicted the
 * Welcome poster's own estimate, so the introduction rides along with the first
 * thing we actually need. Units are asked before height and weight, so nobody
 * who lifts in pounds is handed a centimetre dial.
 */
const SCRIPT: Record<number, { q: string; caption?: string }> = {
  1: {
    q: "I'm Newie, your coach. First things first: what should I call you?",
    caption: "Skip it and I'll call you Athlete.",
  },
  2: { q: "What's your sex? My calorie math needs it." },
  3: { q: 'What year were you born?', caption: 'Sets your calorie-burn baseline.' },
  4: {
    q: 'Which units do you lift in?',
    caption: 'Everything I ask after this uses them. Switch anytime in Settings.',
  },
  5: { q: 'How tall are you?' },
  6: { q: "Where's the scale at today?", caption: "A best guess is fine. We'll track the real trend." },
  7: { q: 'Now the big one. What are we chasing?' },
  8: { q: 'How active are you outside the gym?', caption: 'Workouts are counted separately.' },
  9: { q: 'How many days a week can you give me?', caption: 'Be honest. Consistency beats ambition.' },
  10: {
    q: 'One more thing. Stay on track?',
    caption:
      "I'll ping you when your coach replies or when you miss a day, and count your daily steps. Change this anytime in Settings.",
  },
  11: { q: "Here's your program. The GM Method takes it from here." },
};

/**
 * The last step speaks differently before the account exists: the numbers are
 * already earned, the account is what brings the program with it.
 */
const ACCOUNT_SCRIPT = {
  q: "Here are your numbers. One free account and I'll bring your program in.",
  caption: 'It is free and it takes a moment.',
};

const REACT_LINES: Record<string, string> = {
  'sex:male': 'Logged. Calorie math sorted.',
  'sex:female': 'Logged. Calorie math sorted.',
  'sex:other': 'Logged. Calorie math sorted.',
  'units:kg': 'Kilos, the honest unit.',
  'units:lb': 'Pounds it is.',
  'goal:muscle': 'Muscle it is. We eat big, we lift bigger.',
  'goal:fat_loss': "Cutting season. The scale won't know what hit it.",
  'goal:strength': 'Strength, the honest kind of progress.',
  'activity:sedentary': "Desk job? We'll fix that.",
  'activity:light': 'A start. The gym does the rest.',
  'activity:moderate': 'Solid base to build on.',
  'activity:high': 'A machine already. Good.',
};

export function OnboardingWizard() {
  // Step + answers live in a persisted store, so a mid-setup app kill resumes
  // exactly where it stopped instead of restarting at question 1.
  const step = useOnboardingProgress((s) => s.step);
  const draft = useOnboardingProgress((s) => s.draft);
  const patchDraft = useOnboardingProgress((s) => s.patchDraft);
  const progressHydrated = useOnboardingProgressHydrated();
  const [reaction, setReaction] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [permissionsBusy, setPermissionsBusy] = useState(false);
  const update = useProfile((s) => s.update);
  const completeOnboarding = useProfile((s) => s.completeOnboarding);
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const signUp = useAuth((s) => s.signUp);
  // Account fields live in component state ONLY. The resume snapshot is
  // written to device storage on every keystroke; a password must never go
  // anywhere near it.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordShown, setPasswordShown] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  /** Sign-up never reached us (offline). Only then is finishing without an
   * account offered — see the file header. */
  const [couldNotConnect, setCouldNotConnect] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const catalogState = useTrainingCatalog();
  const suggestedPlan = selectTrainingPlan(
    catalogState.catalog?.plans ?? [],
    draft.goal ?? 'muscle',
    draft.daysPerWeek,
  );
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set once the profile write lands — see the unmount cleanup below. */
  const completed = useRef(false);

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      // Drop the saved run only once this screen is GONE. Clearing it inline in
      // finish() would snap the still-mounted wizard back to question 1 for a
      // frame, under the route replace.
      if (completed.current) clearOnboardingProgress();
    },
    [],
  );

  function patch(p: Partial<OnboardingDraft>): void {
    patchDraft(p);
  }

  function clearAdvance(): void {
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  }

  /**
   * Move by `delta` steps. Reads the CURRENT step from the store rather than
   * this render's closure: the option steps advance from a timeout, which can
   * outlive the render that scheduled it. The store clamps to [1, TOTAL_STEPS].
   */
  function goStep(delta: number): void {
    const state = useOnboardingProgress.getState();
    state.setStep(state.step + delta);
  }

  function next(): void {
    clearAdvance();
    setReaction(null);
    goStep(1);
  }

  function back(): void {
    clearAdvance();
    setReaction(null);
    goStep(-1);
  }

  /**
   * Step 1's back control. There is nothing before question 1 inside the
   * wizard, so it leaves for the Welcome poster the member came from — without
   * it, step 1 was a dead end on iOS (no chevron, and the stack swipe is
   * deliberately disabled mid-wizard). `resetStackTo` covers the case where
   * onboarding IS the stack root — a brand-new account is sent straight here
   * after sign-up, so there is nothing to go back to.
   */
  function leaveWizard(): void {
    clearAdvance();
    if (router.canGoBack()) router.back();
    else resetStackTo('/welcome');
  }

  /** "I already have an account" — the returning member's way out of setup. */
  function goToSignIn(): void {
    clearAdvance();
    router.push('/auth/sign-in');
  }

  /** Option tap → Newie reacts for a beat → next question. */
  function selectAndAdvance(p: Partial<OnboardingDraft>, reactKey?: string): void {
    patch(p);
    clearAdvance();
    const line = reactKey ? REACT_LINES[reactKey] : undefined;
    if (line) {
      setReaction(line);
      advanceTimer.current = setTimeout(next, 850);
    } else {
      advanceTimer.current = setTimeout(next, 180);
    }
  }

  function chooseUnits(unit: UnitPref): void {
    // Switching units re-bases the weight stepper; re-picking the SAME unit
    // must not throw away a weight the member already dialled in.
    if (draft.unitPref !== unit) {
      patch({ unitPref: unit, weightInput: WEIGHT_DEFAULTS[unit] });
    }
    clearAdvance();
    setReaction(REACT_LINES[`units:${unit}`] ?? null);
    advanceTimer.current = setTimeout(next, 850);
  }

  function submitName(): void {
    clearAdvance();
    const name = draft.name.trim();
    setReaction(name ? `Good to meet you, ${name}.` : 'Athlete it is. I like the mystery.');
    advanceTimer.current = setTimeout(next, 850);
  }

  /**
   * "Stay on track" step's primary CTA: ask for notification permission (the
   * prompting variant — fires the OS dialog even though onboarding runs
   * signed out), then step-sensor permission, then Health Connect on Android
   * (a no-op there when the module/device doesn't support it). Never blocks
   * progress — always advances once the requests settle, granted or not.
   */
  async function handleAllowPermissions(): Promise<void> {
    if (permissionsBusy) return;
    setPermissionsBusy(true);
    try {
      await registerForPushNotificationsAsync({ askIfUndetermined: true });
      await requestStepPermission();
      if (Platform.OS === 'android') {
        await requestHealthConnectPermission();
      }
    } finally {
      setPermissionsBusy(false);
      next();
    }
  }

  /**
   * Last step, signed out: open the free account the program arrives with.
   * Runs BEFORE finish() on purpose — sign-up switches the local store over
   * to the new account, so the starting weight and profile written by finish()
   * land in that account rather than in the guest namespace.
   *
   * Success deliberately does NOT enter the app: it leaves the member on this
   * step, where the catalog they just unlocked fills in the matched program
   * under their targets and "Let's go" commits setup.
   */
  async function createAccount(): Promise<void> {
    if (creatingAccount || finishing) return;
    const nextEmail = emailIssue(email);
    const nextPassword = passwordIssue(password);
    setEmailError(nextEmail);
    setPasswordError(nextPassword);
    setAccountError(null);
    setCouldNotConnect(false);
    if (nextEmail || nextPassword) {
      warnHaptic();
      return;
    }

    setCreatingAccount(true);
    try {
      await signUp(email, password, draft.name.trim() || 'Athlete');
      successHaptic();
      setPassword('');
      setPasswordShown(false);
    } catch (error: unknown) {
      warnHaptic();
      const code = toApiError(error).code;
      if (code === 'email_taken') {
        setEmailError('This email already has an account. Sign in below instead.');
      } else if (code === 'invalid') {
        setAccountError('Check your email and password, then try again.');
      } else {
        setAccountError("We couldn't connect. Check your connection and try again.");
        setCouldNotConnect(true);
      }
    } finally {
      setCreatingAccount(false);
    }
  }

  async function finish(): Promise<void> {
    if (finishing) return;
    setFinishError(null);
    setFinishing(true);
    try {
      const kg = inputToKg(draft.weightInput, draft.unitPref);
      const targets = draftTargets(draft);
      // Persist the starting weight FIRST — the onboarded flag must only flip
      // once the SQLite write succeeds, or a failure here would strand the user
      // in an onboarded-but-empty state with no way back to this screen.
      const repo = await getRepo();
      await repo.upsertWeight({ id: uid(), date: todayIso(), kg });
      update({
        displayName: draft.name.trim() || 'Athlete',
        sex: draft.sex,
        birthYear: draft.birthYear,
        heightCm: draft.heightCm,
        startWeightKg: kg,
        unitPref: draft.unitPref,
        goalType: draft.goal,
        activityLevel: draft.activity,
        daysPerWeek: draft.daysPerWeek,
      });
      completeOnboarding({ targets, planId: suggestedPlan?.id ?? null });
      // Setup is committed: this run is finished, so the resume snapshot must
      // never come back. The actual wipe happens on unmount (see the effect
      // above) to keep the last frame of the wizard steady.
      completed.current = true;
      // Push the freshly-onboarded profile to Neon immediately — don't rely on
      // the 3s debounce, which a quick app-close could miss (that's how an
      // account ends up onboarded locally but empty on the server). No-op when
      // signed out; the next sign-in backs it up.
      syncProfileNow();
      successHaptic();
      // Reset the WHOLE stack: a plain replace left Welcome underneath, so
      // Android back from the fresh dashboard reopened "Get started".
      resetStackTo('/');
    } catch {
      // Persistence failed — leave the user on this screen with a clear retry
      // path instead of a silently re-enabled button.
      warnHaptic();
      setFinishError("Couldn't save your setup. Check your device storage and tap Let's go again.");
      setFinishing(false);
    }
  }

  function renderAnswers() {
    switch (step) {
      case 1:
        return (
          <AppTextInput
            value={draft.name}
            onChangeText={(t) => patch({ name: t })}
            placeholder="Athlete"
            returnKeyType="done"
            onSubmitEditing={submitName}
            maxLength={24}
            accessibilityLabel="Your name"
          />
        );
      case 2:
        return (
          <View style={styles.cards}>
            {SEX_OPTIONS.map((o) => (
              <OptionCard
                key={o.value}
                title={o.title}
                subtitle={o.subtitle}
                selected={draft.sex === o.value}
                onPress={() => selectAndAdvance({ sex: o.value }, `sex:${o.value}`)}
              />
            ))}
          </View>
        );
      case 3:
        return (
          <View style={styles.stepperWrap}>
            <Stepper
              value={draft.birthYear}
              onChange={(v) => patch({ birthYear: v })}
              step={1}
              min={BIRTH_YEAR.min}
              max={BIRTH_YEAR.max}
              label="Born in"
              big
            />
          </View>
        );
      case 4:
        return (
          <View style={styles.cards}>
            {UNIT_OPTIONS.map((o) => (
              <OptionCard
                key={o.value}
                title={o.title}
                subtitle={o.subtitle}
                selected={draft.unitPref === o.value}
                onPress={() => chooseUnits(o.value)}
              />
            ))}
          </View>
        );
      case 5:
        // Height follows the unit choice made a question earlier: feet and
        // inches for anyone lifting in pounds, centimetres for everyone else.
        // Stored as centimetres either way.
        return (
          <View style={styles.stepperWrap}>
            {draft.unitPref === 'lb' ? (
              <Stepper
                value={cmToInches(draft.heightCm)}
                onChange={(v) => patch({ heightCm: inchesToCm(v) })}
                step={1}
                min={HEIGHT_IN.min}
                max={HEIGHT_IN.max}
                format={formatFeetInches}
                label="Height"
                big
              />
            ) : (
              <Stepper
                value={draft.heightCm}
                onChange={(v) => patch({ heightCm: v })}
                step={1}
                min={HEIGHT_CM.min}
                max={HEIGHT_CM.max}
                label="cm"
                big
              />
            )}
          </View>
        );
      case 6:
        return (
          <View style={styles.stepperWrap}>
            <Stepper
              value={draft.weightInput}
              onChange={(v) => patch({ weightInput: v })}
              step={WEIGHT_STEPS[draft.unitPref]}
              min={WEIGHT_RANGES[draft.unitPref].min}
              max={WEIGHT_RANGES[draft.unitPref].max}
              format={formatWeightValue}
              label={draft.unitPref}
              big
            />
          </View>
        );
      case 7:
        return (
          <View style={styles.cards}>
            {GOAL_OPTIONS.map((o) => (
              <OptionCard
                key={o.value}
                title={o.title}
                subtitle={o.subtitle}
                selected={draft.goal === o.value}
                onPress={() => selectAndAdvance({ goal: o.value }, `goal:${o.value}`)}
              />
            ))}
          </View>
        );
      case 8:
        return (
          <View style={styles.cards}>
            {ACTIVITY_OPTIONS.map((o) => (
              <OptionCard
                key={o.value}
                title={o.title}
                subtitle={o.subtitle}
                selected={draft.activity === o.value}
                onPress={() => selectAndAdvance({ activity: o.value }, `activity:${o.value}`)}
              />
            ))}
          </View>
        );
      case 9:
        return (
          <View style={styles.stepperWrap}>
            <Stepper
              value={draft.daysPerWeek}
              onChange={(v) => patch({ daysPerWeek: v })}
              step={1}
              min={DAYS_PER_WEEK.min}
              max={DAYS_PER_WEEK.max}
              label="Days a week"
              big
            />
          </View>
        );
      case 10:
        return (
          <View style={styles.permissionActions}>
            <Button
              label="Allow"
              onPress={() => void handleAllowPermissions()}
              loading={permissionsBusy}
            />
            <Button
              label="Later"
              variant="ghost"
              disabled={permissionsBusy}
              onPress={next}
            />
          </View>
        );
      default: {
        const targets = draftTargets(draft);
        const plan = suggestedPlan;
        return (
          <View>
            {/* The screen's ONE red hero block: kcal count-up + macro
                fraction stats, all in black ink (brief §2/§7). */}
            <View style={styles.targetsBlock}>
              <CountUpStat label="Calories" value={targets.kcal} unit="kcal / day" onBlock />
              <View style={styles.macroRow}>
                <FractionStat label="Protein" value={targets.protein} total="g" onBlock />
                <FractionStat label="Carbs" value={targets.carbs} total="g" onBlock />
                <FractionStat label="Fat" value={targets.fat} total="g" onBlock />
              </View>
            </View>
            <AppText variant="caption" style={styles.gmMethodNote}>
              Starting targets by the GM Method. Gold adapts them to your weekly trend.
            </AppText>
            {/* Signed out, this is where the program WOULD be. Say what brings
                it, and ask for it here rather than two screens later. */}
            {!signedIn ? (
              <View style={styles.planBlock}>
                <AppText variant="label">Last step</AppText>
                <AppText variant="body" color={colors.textDim} style={styles.accountIntro}>
                  Your programs and the exercise library come from your coach, and they
                  arrive with your free account. It also keeps your progress if you
                  change phone.
                </AppText>

                <View style={styles.field}>
                  <AppText variant="label">Email</AppText>
                  <AppTextInput
                    value={email}
                    onChangeText={(t) => {
                      setEmail(t);
                      if (emailError) setEmailError(null);
                    }}
                    placeholder="you@example.com"
                    keyboardType="email-address"
                    autoComplete="email"
                    textContentType="emailAddress"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                    accessibilityLabel="Email"
                  />
                  {emailError ? (
                    <AppText variant="caption" color={colors.error}>
                      {emailError}
                    </AppText>
                  ) : null}
                </View>

                <View style={styles.field}>
                  <AppText variant="label">Password</AppText>
                  <AppTextInput
                    value={password}
                    onChangeText={(t) => {
                      setPassword(t);
                      if (passwordError) setPasswordError(null);
                    }}
                    placeholder="At least 8 characters"
                    secureTextEntry={!passwordShown}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="go"
                    onSubmitEditing={() => void createAccount()}
                    accessibilityLabel="Password"
                  />
                  <View style={styles.passwordRow}>
                    <View style={styles.passwordIssue}>
                      {passwordError ? (
                        <AppText variant="caption" color={colors.error}>
                          {passwordError}
                        </AppText>
                      ) : null}
                    </View>
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel={passwordShown ? 'Hide password' : 'Show password'}
                      onPress={() => setPasswordShown((shown) => !shown)}
                      style={styles.showPassword}
                    >
                      <AppText variant="caption" color={colors.accent}>
                        {passwordShown ? 'Hide' : 'Show'}
                      </AppText>
                    </PressableScale>
                  </View>
                </View>

                {accountError ? (
                  <AppText variant="body" color={colors.error} style={styles.accountError}>
                    {accountError}
                  </AppText>
                ) : null}
              </View>
            ) : plan ? (
              <View style={styles.planBlock}>
                <AppText variant="label">Suggested plan</AppText>
                <AppText variant="title" style={styles.planName}>
                  {plan.name}
                </AppText>
                <AppText variant="caption">
                  {plan.daysPerWeek} days a week · {plan.weeks} weeks
                </AppText>
                <AppText color={colors.textDim} style={styles.planDescription}>
                  {plan.description}
                </AppText>
              </View>
            ) : (
              <View style={styles.planBlock}>
                <AppText variant="label">Your program</AppText>
                <AppText variant="body" color={colors.textDim}>
                  {catalogState.status === 'error'
                    ? 'We can’t reach your coach’s programs right now. Your goal is saved, and one is matched as soon as they load.'
                    : catalogState.status === 'ready'
                      ? 'Nothing published matches this goal yet. Your goal is saved, and your program shows up in Train the moment your coach publishes it.'
                      : 'Finding the closest published program for your goal…'}
                </AppText>
              </View>
            )}
          </View>
        );
      }
    }
  }

  /** The last step still has one thing to collect: the account. */
  const needsAccount = step === TOTAL_STEPS && !signedIn;
  const script = needsAccount ? ACCOUNT_SCRIPT : (SCRIPT[step] ?? SCRIPT[TOTAL_STEPS]!);
  const footerLabel = needsAccount
    ? 'Create account'
    : step === TOTAL_STEPS
      ? "Let's go"
      : 'Continue';
  const footerAction = needsAccount
    ? () => void createAccount()
    : step === TOTAL_STEPS
      ? () => void finish()
      : step === 1
        ? submitName
        : next;
  const onFirstStep = step === 1;

  // Wait for the saved run before painting. Native storage reads synchronously
  // (this never shows), but web resolves a tick later — and question 1 flashing
  // before the resumed step would read as "it lost my answers after all".
  if (!progressHydrated) {
    return (
      <Screen>
        <View style={styles.flex} />
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header: back + progress. The chevron is on EVERY step, question 1
            included — on step 1 it leaves the wizard (the stack swipe stays
            disabled on purpose, so a missing chevron left iOS with no way
            out at all). */}
        <View style={styles.header}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={onFirstStep ? 'Back to the welcome screen' : 'Go back'}
            onPress={onFirstStep ? leaveWizard : back}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </PressableScale>
          {/* Step indicator: one thin red bar sweeping toward done (brief §7).
              ProgressBar owns the 500ms expo-out sweep + reduced-motion snap. */}
          <ProgressBar
            value={step / TOTAL_STEPS}
            height={8}
            accessibilityLabel={`Step ${step} of ${TOTAL_STEPS}`}
            style={styles.progress}
          />
          <View style={styles.backSpacer} />
        </View>

        {/* Conversation + answers (scrolls). Answers are ALWAYS rendered. */}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <NewieStage
            text={reaction ?? script.q}
            caption={reaction ? undefined : script.caption}
            mood={reaction ? 'react' : 'ask'}
          >
            {/* Each step's answers fade in place (never slide) as the step
                changes — keyed so the fade replays per question. */}
            <Animated.View key={step} entering={enterFade()}>
              {renderAnswers()}
            </Animated.View>
          </NewieStage>
        </ScrollView>

        {/* Footer: OUTSIDE the scroll — always visible. */}
        {OPTION_STEPS.has(step) || step === PERMISSION_STEP ? null : (
          <View style={styles.footer}>
            {finishError ? (
              <AppText variant="caption" color={colors.error} style={styles.finishError}>
                {finishError}
              </AppText>
            ) : null}
            <Button
              label={footerLabel}
              onPress={footerAction}
              loading={finishing || creatingAccount}
            />
            {/* Sign-up never left the phone. Holding someone hostage in setup
                would be worse than letting them in, so offer the door — and
                say exactly what stays empty until the account exists. */}
            {needsAccount && couldNotConnect ? (
              <>
                <AppText variant="caption" color={colors.textDim} center style={styles.offlineNote}>
                  You can finish setup now and make the account later from Train. Until
                  then your programs and the exercise library stay empty.
                </AppText>
                <Button
                  label="Finish setup for now"
                  variant="ghost"
                  disabled={creatingAccount}
                  onPress={() => void finish()}
                />
              </>
            ) : null}
            {/* Setup is for new members; a returning one shouldn't have to
                answer the whole wizard to find the door back to their
                account. */}
            {onFirstStep || needsAccount ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="I already have an account"
                accessibilityHint="Opens sign in"
                onPress={goToSignIn}
                style={styles.signInLink}
              >
                <AppText variant="body" color={colors.accent} center>
                  I already have an account
                </AppText>
              </PressableScale>
            ) : null}
          </View>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    // Screen already adds 16px top air; xs keeps total ~20 instead of 28.
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backSpacer: { width: touch.min, height: touch.min },
  progress: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xl },
  // lg bottom so the button clears the viewport edge even at insets=0 (web).
  footer: { paddingTop: spacing.md, paddingBottom: spacing.lg },
  finishError: { marginBottom: spacing.sm, textAlign: 'center' },
  // Quiet text link under the CTA — no chrome, but a full 48dp tap target.
  signInLink: {
    minHeight: touch.min,
    justifyContent: 'center',
    marginTop: spacing.xs,
  },

  cards: { gap: spacing.md },
  // "Stay on track" step: Allow stacks full-width above the ghost "Later" —
  // no shared footer, this IS the step's answer content.
  permissionActions: { gap: spacing.sm, marginTop: spacing.xs },
  // Number steps: the big Oswald stepper sits centered in its own charcoal
  // block — flat fill, chunky corners, no border (block language).
  stepperWrap: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.gutter,
    marginTop: spacing.xs,
  },

  // Red hero block for the final targets reveal (brief §11b anatomy).
  targetsBlock: {
    backgroundColor: colors.blockRed,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.lg,
  },
  // Wraps so three 56px Oswald numbers never clip at large font scales.
  macroRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.xl,
    rowGap: spacing.md,
  },
  gmMethodNote: { marginTop: spacing.md },
  planBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    marginTop: spacing.lg,
  },
  planName: { marginTop: spacing.xs },
  planDescription: { marginTop: spacing.sm },

  // Account block (last step, signed out) — same charcoal block as the plan
  // reveal it stands in for.
  accountIntro: { marginTop: spacing.xs },
  field: { gap: spacing.sm, marginTop: spacing.lg },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  passwordIssue: { flex: 1 },
  showPassword: {
    minHeight: touch.min,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  accountError: { marginTop: spacing.lg },
  offlineNote: { marginTop: spacing.md },
});
