import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { displayWeight, inputToKg, unitLabel } from '@gym/shared';
import { spacing } from '@gym/ui-tokens';
import { AppText, Button, enterDown, enterUp, Screen, Stepper } from '../../components/ui';
import { posterDate, todayIso } from '../../lib/dates';
import { successHaptic } from '../../lib/haptics';
import { uid } from '../../lib/id';
import { getRepo } from '../../lib/repo';
import { useProfile } from '../../state/profile';
import { BackHeader } from '../../features/body/components/BackHeader';
import { SaveConfirmation } from '../../features/body/components/SaveConfirmation';

/** How long the "Saved" affirmation shows before the screen pops. */
const SAVE_CONFIRM_MS = 520;

/**
 * One weigh-in per day (upsert). Stepper, not keyboard — prefilled with the
 * last weight so logging is two taps on a good day.
 */

const styles = StyleSheet.create({
  headingWrap: { marginBottom: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  // lg so the button clears the viewport bottom even at insets=0 (web).
  save: { marginBottom: spacing.lg },
});

export default function LogWeightScreen() {
  const unitPref = useProfile((s) => s.unitPref);
  const startWeightKg = useProfile((s) => s.startWeightKg);
  const [value, setValue] = useState<number | null>(null);
  const [hasToday, setHasToday] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
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
    const repo = await getRepo();
    await repo.upsertWeight({ id: uid(), date: todayIso(), kg: inputToKg(value, unitPref) });
    successHaptic();
    setSaved(true);
    popTimer.current = setTimeout(() => router.back(), SAVE_CONFIRM_MS);
  }

  return (
    <Screen>
      {saved ? null : <BackHeader />}
      <Animated.View entering={enterDown(1)} style={styles.headingWrap}>
        <AppText variant="label">{posterDate()}</AppText>
        <AppText variant="heading">Body weight</AppText>
      </Animated.View>

      <Animated.View entering={enterUp(1)} style={styles.center}>
        {value !== null ? (
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
        ) : null}
        {hasToday && !saved ? (
          <AppText variant="caption" center>Updates today's entry</AppText>
        ) : null}
      </Animated.View>

      <Animated.View entering={enterUp(2)}>
        {saved ? (
          <View style={styles.save}>
            <SaveConfirmation />
          </View>
        ) : (
          <Button
            label="Save"
            onPress={() => void save()}
            loading={saving}
            disabled={value === null}
            style={styles.save}
          />
        )}
      </Animated.View>
    </Screen>
  );
}
