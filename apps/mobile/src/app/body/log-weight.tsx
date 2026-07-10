import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import type { TrendSummary } from '@gym/shared';
import { displayWeight, inputToKg, unitLabel } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Button, Card, enterDown, enterUp, Screen, Stepper } from '../../components/ui';
import { posterDate, todayIso } from '../../lib/dates';
import { successHaptic } from '../../lib/haptics';
import { uid } from '../../lib/id';
import { getRepo } from '../../lib/repo';
import { useProfile } from '../../state/profile';
import { BackHeader } from '../../features/body/components/BackHeader';
import { SaveConfirmation } from '../../features/body/components/SaveConfirmation';
import { directionIcon, rateLabel, weightHeadline } from '../../features/body/logic';

/** How long the "Saved" affirmation shows before the screen pops. */
const SAVE_CONFIRM_MS = 520;

/**
 * One weigh-in per day (upsert). Stepper, not keyboard — prefilled with the
 * last weight so logging is two taps on a good day.
 *
 * Revamp layout (REVAMP-BRIEF): date eyebrow → big Oswald title → charcoal
 * entry block (huge Oswald stepper number + outlined trend chip) → red save
 * pill. No borders on the card — fill contrast only; the chip may carry a
 * stroke (§6).
 */

const styles = StyleSheet.create({
  headingWrap: { marginBottom: spacing.lg, gap: spacing.sm },
  title: { textTransform: 'uppercase' },
  center: { flex: 1, justifyContent: 'center' },
  // The entry block: charcoal color-block card, number front and center.
  entryCard: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.xl,
  },
  // Outlined meta pill (§6). Non-interactive — informational trend readout.
  // Arrow stays textDim on purpose: whether up is good depends on the goal.
  trendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  // lg so the button clears the viewport bottom even at insets=0 (web).
  save: { marginBottom: spacing.lg },
  error: { marginBottom: spacing.sm },
});

export default function LogWeightScreen() {
  const unitPref = useProfile((s) => s.unitPref);
  const startWeightKg = useProfile((s) => s.startWeightKg);
  const [value, setValue] = useState<number | null>(null);
  const [hasToday, setHasToday] = useState(false);
  const [trend, setTrend] = useState<TrendSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  // Clear the auto-pop timer if we leave first (hardware/swipe back) so it can't
  // fire router.back() on an already-popped screen and pop one screen too many.
  const popTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (popTimer.current) clearTimeout(popTimer.current);
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const repo = await getRepo();
      const weights = await repo.getWeights(90);
      if (!mounted) return;
      const lastKg = weights[weights.length - 1]?.kg ?? startWeightKg ?? 75;
      setHasToday(weights.some((w) => w.date === todayIso()));
      setValue(displayWeight(lastKg, unitPref));
      // Display-only trend chip from the same fetch (EWMA summary is kg-based,
      // unit-independent). Needs ≥2 weigh-ins to mean anything.
      setTrend(weights.length >= 2 ? weightHeadline(weights, unitPref).summary : null);
    })();
    return () => {
      mounted = false;
    };
    // Prefill once on mount — unit/profile changes mid-screen shouldn't reset input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(): Promise<void> {
    if (value === null || saving || saved) return;
    setSaving(true);
    setError(false);
    try {
      const repo = await getRepo();
      await repo.upsertWeight({ id: uid(), date: todayIso(), kg: inputToKg(value, unitPref) });
      successHaptic();
      setSaved(true);
      popTimer.current = setTimeout(() => router.back(), SAVE_CONFIRM_MS);
    } catch {
      // Write failed (locked/full disk, repo init) — release the button so the
      // user can retry instead of leaving the spinner stuck forever.
      setSaving(false);
      setError(true);
    }
  }

  return (
    <Screen>
      {saved ? null : <BackHeader />}
      <Animated.View entering={enterDown(1)} style={styles.headingWrap}>
        <AppText variant="label">{posterDate()}</AppText>
        <AppText variant="display" style={styles.title}>
          Body weight
        </AppText>
      </Animated.View>

      <Animated.View entering={enterUp(1)} style={styles.center}>
        {value !== null ? (
          <Card style={styles.entryCard}>
            <Stepper
              value={value}
              onChange={setValue}
              step={unitPref === 'kg' ? 0.1 : 0.2}
              min={20}
              max={unitPref === 'kg' ? 350 : 770}
              label={unitLabel(unitPref)}
              format={(v) => v.toFixed(1)}
              big
            />
            {trend !== null ? (
              <View
                style={styles.trendChip}
                accessibilityRole="text"
                accessibilityLabel={`Trend ${rateLabel(trend, unitPref)}`}
              >
                <Ionicons name={directionIcon(trend.direction)} size={16} color={colors.textDim} />
                <AppText variant="caption" color={colors.text}>
                  {rateLabel(trend, unitPref)}
                </AppText>
              </View>
            ) : null}
            {hasToday && !saved ? (
              <AppText variant="caption" center>{"Updates today's entry"}</AppText>
            ) : null}
          </Card>
        ) : null}
      </Animated.View>

      <Animated.View entering={enterUp(2)}>
        {saved ? (
          <View style={styles.save}>
            <SaveConfirmation />
          </View>
        ) : (
          <>
            {error ? (
              <AppText variant="caption" color={colors.error} center style={styles.error}>
                {"Couldn't save — please try again."}
              </AppText>
            ) : null}
            <Button
              label="Save"
              onPress={() => void save()}
              loading={saving}
              disabled={value === null}
              style={styles.save}
            />
          </>
        )}
      </Animated.View>
    </Screen>
  );
}
