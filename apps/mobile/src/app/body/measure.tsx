import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Measurement, UnitPref } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Button, enterDown, enterUp, Screen, Stepper, Tag } from '../../components/ui';
import { posterDate, todayIso } from '../../lib/dates';
import { successHaptic } from '../../lib/haptics';
import { uid } from '../../lib/id';
import { getRepo } from '../../lib/repo';
import { BackHeader } from '../../features/body/components/BackHeader';
import { SaveConfirmation } from '../../features/body/components/SaveConfirmation';
import { displayLength, lengthInputToCm } from '../../features/body/lengthUnits';
import {
  MEASUREMENT_DEFAULTS,
  MEASUREMENT_FIELDS,
  latestMeasurementValues,
  type MeasurementKey,
} from '../../features/body/logic';
import { useProfile } from '../../state/profile';

/** How long the "Saved" affirmation shows before the screen pops. */
const SAVE_CONFIRM_MS = 520;

/** Stepper bounds in the display unit (10–300 cm ≈ 4–118 in). */
const LENGTH_RANGE: Record<UnitPref, { min: number; max: number }> = {
  kg: { min: 10, max: 300 },
  lb: { min: 4, max: 118 },
};

/**
 * Tape day. Steppers prefilled with the last known value per field; only the
 * fields you actually change get saved — the rest stay null on the entry.
 * Values are shown and edited in the user's unit (cm or inches) but ALWAYS
 * stored as canonical cm, mirroring how weight stores kg.
 *
 * Revamp layout (REVAMP-BRIEF): date eyebrow → big Oswald title → stack of
 * charcoal rounded rows (field name + dim unit chip + stepper), gaps instead
 * of Divider hairlines (§11c) → red save pill.
 */

type Values = Record<MeasurementKey, number>;

const styles = StyleSheet.create({
  headingWrap: { marginBottom: spacing.lg, gap: spacing.sm },
  title: { textTransform: 'uppercase' },
  // Rounded charcoal rows separated by gaps — no hairlines in the block look.
  rows: { gap: spacing.sm },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 64,
  },
  fieldInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  hint: { marginTop: spacing.lg, marginBottom: spacing.md },
});

export default function MeasureScreen() {
  const unitPref = useProfile((s) => s.unitPref);
  const [values, setValues] = useState<Values | null>(null);
  const [baseline, setBaseline] = useState<Values | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const entries = await repo.getMeasurements(50);
      if (!mounted) return;
      const latest = latestMeasurementValues(entries);
      // Prefill in canonical cm, then convert once to the display unit.
      const prefill: Values = { ...MEASUREMENT_DEFAULTS };
      for (const { key } of MEASUREMENT_FIELDS) {
        const known = latest[key];
        if (known !== null) prefill[key] = known;
        prefill[key] = displayLength(prefill[key], unitPref);
      }
      setValues({ ...prefill });
      setBaseline({ ...prefill });
    })();
    return () => {
      mounted = false;
    };
  }, [unitPref]);

  const changedKeys: MeasurementKey[] =
    values !== null && baseline !== null
      ? MEASUREMENT_FIELDS.filter((f) => values[f.key] !== baseline[f.key]).map((f) => f.key)
      : [];

  async function save(): Promise<void> {
    if (values === null || changedKeys.length === 0 || saving || saved) return;
    setSaving(true);
    setError(null);
    const changed = new Set<MeasurementKey>(changedKeys);
    // Steppers run in the display unit — convert back to canonical cm here.
    const toCm = (key: MeasurementKey): number | null =>
      changed.has(key) ? lengthInputToCm(values[key], unitPref) : null;
    const entry: Measurement = {
      id: uid(),
      date: todayIso(),
      waistCm: toCm('waistCm'),
      chestCm: toCm('chestCm'),
      armCm: toCm('armCm'),
      hipCm: toCm('hipCm'),
      thighCm: toCm('thighCm'),
    };
    try {
      const repo = await getRepo();
      await repo.addMeasurement(entry);
    } catch {
      setSaving(false);
      setError("Couldn't save your measurements — try again.");
      return;
    }
    successHaptic();
    setSaved(true);
    popTimer.current = setTimeout(() => router.back(), SAVE_CONFIRM_MS);
  }

  const unitChip = unitPref === 'kg' ? 'cm' : 'in';

  return (
    <Screen scroll>
      {saved ? null : <BackHeader />}
      <Animated.View entering={enterDown(1)} style={styles.headingWrap}>
        <AppText variant="label">{posterDate()}</AppText>
        <AppText variant="display" style={styles.title}>
          Measurements
        </AppText>
      </Animated.View>

      {values !== null ? (
        <>
          <View style={styles.rows}>
            {MEASUREMENT_FIELDS.map(({ key, label }, i) => (
              <Animated.View key={key} entering={enterUp(Math.min(i + 1, 8))}>
                <View style={styles.fieldRow}>
                  <View style={styles.fieldInfo}>
                    <AppText variant="bodyBold">{label}</AppText>
                    <Tag variant="dim" label={unitChip} />
                  </View>
                  <Stepper
                    value={values[key]}
                    onChange={(next) => setValues({ ...values, [key]: next })}
                    step={0.5}
                    min={LENGTH_RANGE[unitPref].min}
                    max={LENGTH_RANGE[unitPref].max}
                    format={(v) => v.toFixed(1)}
                  />
                </View>
              </Animated.View>
            ))}
          </View>

          <Animated.View entering={enterUp(Math.min(MEASUREMENT_FIELDS.length + 1, 8))}>
            {saved ? (
              <SaveConfirmation label="Measurements saved" />
            ) : (
              <>
                <AppText variant="caption" style={styles.hint}>
                  {`Only the fields you change are saved — everything is in ${
                    unitPref === 'kg' ? 'cm' : 'inches'
                  }.`}
                </AppText>
                {error !== null ? (
                  <AppText variant="caption" color={colors.error} style={styles.hint}>
                    {error}
                  </AppText>
                ) : null}
                <Button
                  label="Save"
                  onPress={() => void save()}
                  loading={saving}
                  disabled={changedKeys.length === 0}
                />
              </>
            )}
          </Animated.View>
        </>
      ) : null}
    </Screen>
  );
}
