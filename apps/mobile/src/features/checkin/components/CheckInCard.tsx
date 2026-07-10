import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import { displayWeight, inputToKg, unitLabel } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  enterFade,
  enterUp,
  HeroCard,
  PressableScale,
} from '../../../components/ui';
import { posterDate, todayIso } from '../../../lib/dates';
import { successHaptic, tapHaptic } from '../../../lib/haptics';
import { uid } from '../../../lib/id';
import { useAuth } from '../../../state/auth';
import { useProfile } from '../../../state/profile';
import { formatCompact } from '../../engagement/logic';
import { postCheckIn, type CheckInSummary } from '../api';
import { isCheckInDue, weekSummary } from '../logic';
import { hydrateCheckIns, useCheckIn } from '../store';

/**
 * Weekly coach check-in card (home screen). Signed-in members only — this is
 * the check-in that reaches the coach console, distinct from the local GM
 * WeeklyCheckIn targets adjuster, which stays untouched next to it.
 *
 * Phases: due (quiet prompt) → form (bodyweight + three 1–5 rows + note,
 * with the auto-computed week summary attached) → sent. Between check-ins the
 * card shows the coach's reply when one exists, otherwise renders nothing.
 * Clean and still — no glow, no pulsing.
 */

type Phase = 'due' | 'form' | 'done';

const SCALE = [1, 2, 3, 4, 5] as const;

interface ScaleField {
  key: 'sleep' | 'energy' | 'soreness';
  label: string;
  hint: string;
}

const FIELDS: ScaleField[] = [
  { key: 'sleep', label: 'Sleep', hint: '1 = poor, 5 = great' },
  { key: 'energy', label: 'Energy', hint: '1 = drained, 5 = full' },
  { key: 'soreness', label: 'Soreness', hint: '1 = none, 5 = very sore' },
];

const EMPTY_SUMMARY: CheckInSummary = { sessions: 0, volumeKg: 0, prCount: 0 };

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  form: { gap: spacing.md },
  field: { gap: spacing.xs },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  optionRow: { flexDirection: 'row', gap: spacing.sm },
  // Scale chips follow the interactive-chip spec (brief §6): outlined pill on
  // dark, selected = solid red fill with BLACK label. ≥48dp tap target.
  option: {
    flex: 1,
    minHeight: touch.min,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  note: {
    minHeight: 80,
    paddingTop: 16,
    textAlignVertical: 'top',
  },
  buttonTop: { marginTop: spacing.sm },
  replyBody: { marginTop: spacing.xs },
});

/** Parse the optional bodyweight field ("72.5" / "72,5") in the display unit. */
function parseWeightInput(raw: string): number | null {
  const n = Number(raw.replace(',', '.').trim());
  return Number.isFinite(n) && n > 0 && n < 1000 ? n : null;
}

/** One 1–5 question: label + hint above five tappable chips. */
function ScaleRow({
  field,
  value,
  onSelect,
}: {
  field: ScaleField;
  value: number | null;
  onSelect: (v: number) => void;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.hintRow}>
        <AppText variant="label">{field.label}</AppText>
        <AppText variant="caption" color={colors.textFaint}>
          {field.hint}
        </AppText>
      </View>
      <View style={styles.optionRow}>
        {SCALE.map((v) => {
          const selected = value === v;
          return (
            <PressableScale
              key={v}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${field.label}: ${v} of 5`}
              onPress={() => {
                tapHaptic();
                onSelect(v);
              }}
              style={[styles.option, selected && styles.optionSelected]}
            >
              <AppText variant="bodyBold" color={selected ? colors.onBlock : colors.textDim}>
                {v}
              </AppText>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

export function CheckInCard({ stagger = 0 }: { stagger?: number }) {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const unitPref = useProfile((s) => s.unitPref);
  const lastCheckInAt = useCheckIn((s) => s.lastCheckInAt);
  const accountId = useCheckIn((s) => s.accountId);
  const coachReply = useCheckIn((s) => s.coachReply);

  const [phase, setPhase] = useState<Phase>('due');
  const [summary, setSummary] = useState<CheckInSummary | null>(null);
  const [bodyweight, setBodyweight] = useState('');
  const [sleep, setSleep] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [soreness, setSoreness] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  // Frozen on the FIRST submit and reused for retries: a timed-out POST may
  // have committed server-side, and a retry that re-generated the id/date
  // (e.g. across midnight) would insert a duplicate row on the next date
  // instead of converging on the original via the (account, date) upsert.
  const submissionRef = useRef<{ id: string; date: string } | null>(null);

  // Reconcile due-state + coach reply with the server whenever Home focuses.
  // Client-triggered only — no scheduling beyond checking on open.
  useFocusEffect(
    useCallback(() => {
      void hydrateCheckIns();
    }, []),
  );

  const startForm = () => {
    setPhase('form');
    // Compute the auto-attached week summary from local data; a repo hiccup
    // degrades to zeros rather than blocking the check-in.
    void weekSummary()
      .then(setSummary)
      .catch(() => setSummary(EMPTY_SUMMARY));
  };

  const submit = () => {
    if (sleep === null || energy === null || soreness === null || sending) return;
    const token = useAuth.getState().token;
    if (token === null) return;
    const weightInput = parseWeightInput(bodyweight);
    const trimmedNote = note.trim();
    submissionRef.current ??= { id: uid(), date: todayIso() };
    const submission = submissionRef.current;
    setSending(true);
    setFailed(false);
    void (async () => {
      try {
        const row = await postCheckIn(token, {
          id: submission.id,
          date: submission.date,
          ...(weightInput !== null ? { bodyweightKg: inputToKg(weightInput, unitPref) } : null),
          sleep,
          energy,
          soreness,
          ...(trimmedNote.length > 0 ? { note: trimmedNote } : null),
          summary: summary ?? EMPTY_SUMMARY,
        });
        useCheckIn.getState().recordCheckIn(row);
        submissionRef.current = null;
        setPhase('done');
        successHaptic();
      } catch {
        // Keep the answers — one tap retries. The POST is idempotent, so a
        // response lost in transit can never double-submit.
        setFailed(true);
      } finally {
        setSending(false);
      }
    })();
  };

  // Server check-ins are meaningless signed out — the card simply hides.
  if (status !== 'signedIn' || user === null) return null;
  // Persisted due-state belongs to another account until hydrate re-keys it
  // (synchronously, on the first focus) — never flash the wrong cadence.
  if (accountId !== user.id) return null;

  const unit = unitLabel(unitPref);

  // Just sent — a quiet confirmation until the screen unmounts.
  if (phase === 'done') {
    return (
      <Animated.View entering={enterUp(stagger)} style={styles.wrap}>
        <HeroCard mascot variant="charcoal">
          <AppText variant="label">Weekly check-in</AppText>
          <AppText variant="title">Sent to your coach</AppText>
          <AppText variant="caption">The reply will show up right here.</AppText>
        </HeroCard>
      </Animated.View>
    );
  }

  const due = isCheckInDue(lastCheckInAt);

  if (!due) {
    // Between check-ins: surface the coach's reply when one exists.
    if (coachReply === null) return null;
    return (
      <Animated.View entering={enterUp(stagger)} style={styles.wrap}>
        <HeroCard mascot variant="charcoal">
          <AppText variant="label">Coach reply</AppText>
          <AppText variant="body" style={styles.replyBody}>
            {coachReply.body}
          </AppText>
          <AppText variant="caption" color={colors.textFaint}>
            {posterDate(coachReply.createdAt.slice(0, 10))}
          </AppText>
        </HeroCard>
      </Animated.View>
    );
  }

  if (phase === 'form') {
    const allAnswered = sleep !== null && energy !== null && soreness !== null;
    return (
      <Animated.View entering={enterUp(stagger)} style={styles.wrap}>
        <HeroCard variant="charcoal">
          <AppText variant="label">Weekly check-in</AppText>
          <Animated.View entering={enterFade(0)} style={styles.form}>
            {summary !== null ? (
              <AppText variant="caption">
                {`This week: ${summary.sessions} sessions · ${formatCompact(
                  displayWeight(summary.volumeKg, unitPref),
                )} ${unit} · ${summary.prCount} PRs`}
              </AppText>
            ) : null}
            <AppTextInput
              value={bodyweight}
              onChangeText={setBodyweight}
              placeholder={`Bodyweight (${unit}) — optional`}
              keyboardType="decimal-pad"
              accessibilityLabel={`Bodyweight in ${unit}, optional`}
            />
            <ScaleRow field={FIELDS[0]!} value={sleep} onSelect={setSleep} />
            <ScaleRow field={FIELDS[1]!} value={energy} onSelect={setEnergy} />
            <ScaleRow field={FIELDS[2]!} value={soreness} onSelect={setSoreness} />
            <AppTextInput
              value={note}
              onChangeText={setNote}
              placeholder="Note for your coach — optional"
              multiline
              maxLength={2000}
              style={styles.note}
              accessibilityLabel="Note for your coach, optional"
            />
            {failed ? (
              <AppText variant="caption" color={colors.error}>
                {"Couldn't send it. Check your connection and try again."}
              </AppText>
            ) : null}
            <Button
              label="Send check-in"
              onPress={submit}
              disabled={!allAnswered}
              loading={sending}
              style={styles.buttonTop}
            />
          </Animated.View>
        </HeroCard>
      </Animated.View>
    );
  }

  // Due — a quiet prompt; the form only opens on demand.
  return (
    <Animated.View entering={enterUp(stagger)} style={styles.wrap}>
      <HeroCard variant="charcoal">
        <AppText variant="label">Weekly check-in</AppText>
        <AppText variant="title">How was your week?</AppText>
        <AppText variant="caption">
          A minute of answers keeps your coach in the loop.
        </AppText>
        <Button label="Start check-in" onPress={startForm} style={styles.buttonTop} />
      </HeroCard>
    </Animated.View>
  );
}
