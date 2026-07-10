import Ionicons from '@expo/vector-icons/Ionicons';
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
import { inputToKg } from '@gym/shared';
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
import { todayIso } from '../../lib/dates';
import { successHaptic, warnHaptic } from '../../lib/haptics';
import { uid } from '../../lib/id';
import { resetStackTo } from '../../lib/nav';
import { syncProfileNow } from '../../lib/profileSync';
import { getRepo } from '../../lib/repo';
import { getPlan } from '../../lib/seed/plans';
import { useProfile } from '../../state/profile';
import { CountUpStat } from './components/CountUpStat';
import { NewieStage } from './components/NewieStage';
import {
  ACTIVITY_OPTIONS,
  BIRTH_YEAR,
  DAYS_PER_WEEK,
  DEFAULT_DRAFT,
  draftTargets,
  formatWeightValue,
  GOAL_OPTIONS,
  HEIGHT_CM,
  planIdForGoal,
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
 */

/** Steps whose OptionCards auto-advance (no bottom button). */
const OPTION_STEPS = new Set([3, 6, 8, 9]);

const SCRIPT: Record<number, { q: string; caption?: string }> = {
  1: { q: "I'm Newie — Greece built me to get you strong. 60 seconds of questions, then we lift." },
  2: { q: 'First things first — what should I call you?', caption: "Skip it and I'll call you Athlete." },
  3: { q: "What's your sex? My calorie math needs it." },
  4: { q: 'What year were you born?', caption: 'Sets your calorie-burn baseline.' },
  5: { q: 'How tall are you?' },
  6: { q: 'Which units do you lift in?', caption: 'Switch anytime in Settings.' },
  7: { q: "Where's the scale at today?", caption: "A best guess is fine — we'll track the real trend." },
  8: { q: 'Now the big one — what are we chasing?' },
  9: { q: 'How active are you outside the gym?', caption: 'Workouts are counted separately.' },
  10: { q: 'How many days a week can you give me?', caption: 'Be honest — consistency beats ambition.' },
  11: { q: "Here's your plan. The GM Method takes it from here." },
};

const REACT_LINES: Record<string, string> = {
  'sex:male': 'Logged. Calorie math sorted.',
  'sex:female': 'Logged. Calorie math sorted.',
  'sex:other': 'Logged. Calorie math sorted.',
  'units:kg': 'Kilos — the honest unit.',
  'units:lb': 'Pounds it is.',
  'goal:muscle': 'Muscle it is. We eat big, we lift bigger.',
  'goal:fat_loss': "Cutting season. The scale won't know what hit it.",
  'goal:strength': 'Strength — the honest kind of progress.',
  'activity:sedentary': "Desk job? We'll fix that.",
  'activity:light': 'A start. The gym does the rest.',
  'activity:moderate': 'Solid base to build on.',
  'activity:high': 'A machine already. Good.',
};

export function OnboardingWizard() {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<OnboardingDraft>(DEFAULT_DRAFT);
  const [reaction, setReaction] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const update = useProfile((s) => s.update);
  const completeOnboarding = useProfile((s) => s.completeOnboarding);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    [],
  );

  function patch(p: Partial<OnboardingDraft>): void {
    setDraft((d) => ({ ...d, ...p }));
  }

  function clearAdvance(): void {
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  }

  function next(): void {
    clearAdvance();
    setReaction(null);
    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  }

  function back(): void {
    clearAdvance();
    setReaction(null);
    setStep((s) => Math.max(1, s - 1));
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
    setDraft((d) =>
      d.unitPref === unit ? d : { ...d, unitPref: unit, weightInput: WEIGHT_DEFAULTS[unit] },
    );
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

  async function finish(): Promise<void> {
    if (finishing) return;
    setFinishError(null);
    setFinishing(true);
    try {
      const kg = inputToKg(draft.weightInput, draft.unitPref);
      const targets = draftTargets(draft);
      const planId = planIdForGoal(draft.goal ?? 'muscle');
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
      completeOnboarding({ targets, planId });
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
        return null;
      case 2:
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
      case 3:
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
      case 4:
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
      case 5:
        return (
          <View style={styles.stepperWrap}>
            <Stepper
              value={draft.heightCm}
              onChange={(v) => patch({ heightCm: v })}
              step={1}
              min={HEIGHT_CM.min}
              max={HEIGHT_CM.max}
              label="cm"
              big
            />
          </View>
        );
      case 6:
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
      case 7:
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
      case 8:
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
      case 9:
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
      case 10:
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
      default: {
        const targets = draftTargets(draft);
        const plan = getPlan(planIdForGoal(draft.goal ?? 'muscle'));
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
            {plan ? (
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
            ) : null}
          </View>
        );
      }
    }
  }

  const script = SCRIPT[step] ?? SCRIPT[TOTAL_STEPS]!;
  const footerLabel =
    step === 1 ? "Let's talk" : step === TOTAL_STEPS ? "Let's go" : 'Continue';
  const footerAction =
    step === TOTAL_STEPS ? () => void finish() : step === 2 ? submitName : next;

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header: back + progress */}
        <View style={styles.header}>
          {step > 1 ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={back}
              style={styles.backBtn}
            >
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </PressableScale>
          ) : (
            <View style={styles.backSpacer} />
          )}
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
        {OPTION_STEPS.has(step) ? null : (
          <View style={styles.footer}>
            {finishError ? (
              <AppText variant="caption" color={colors.error} style={styles.finishError}>
                {finishError}
              </AppText>
            ) : null}
            <Button label={footerLabel} onPress={footerAction} loading={finishing} />
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

  cards: { gap: spacing.md },
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
});
