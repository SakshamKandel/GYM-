import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Measurement } from '@gym/shared';
import { spacing } from '@gym/ui-tokens';
import { AppText, Button, Divider, enterDown, enterUp, Screen, Stepper } from '../../components/ui';
import { posterDate, todayIso } from '../../lib/dates';
import { logHaptic } from '../../lib/haptics';
import { uid } from '../../lib/id';
import { getRepo } from '../../lib/repo';
import { BackHeader } from '../../features/body/components/BackHeader';
import {
  MEASUREMENT_DEFAULTS,
  MEASUREMENT_FIELDS,
  latestMeasurementValues,
  type MeasurementKey,
} from '../../features/body/logic';

/**
 * Tape day. Steppers prefilled with the last known value per field; only the
 * fields you actually change get saved — the rest stay null on the entry.
 */

type Values = Record<MeasurementKey, number>;

const styles = StyleSheet.create({
  headingWrap: { marginBottom: spacing.lg },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  hint: { marginTop: spacing.lg, marginBottom: spacing.md },
});

export default function MeasureScreen() {
  const [values, setValues] = useState<Values | null>(null);
  const [baseline, setBaseline] = useState<Values | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const repo = await getRepo();
      const entries = await repo.getMeasurements(50);
      if (!mounted) return;
      const latest = latestMeasurementValues(entries);
      const prefill: Values = { ...MEASUREMENT_DEFAULTS };
      for (const { key } of MEASUREMENT_FIELDS) {
        const known = latest[key];
        if (known !== null) prefill[key] = known;
      }
      setValues({ ...prefill });
      setBaseline({ ...prefill });
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const changedKeys: MeasurementKey[] =
    values !== null && baseline !== null
      ? MEASUREMENT_FIELDS.filter((f) => values[f.key] !== baseline[f.key]).map((f) => f.key)
      : [];

  async function save(): Promise<void> {
    if (values === null || changedKeys.length === 0 || saving) return;
    setSaving(true);
    const changed = new Set<MeasurementKey>(changedKeys);
    const entry: Measurement = {
      id: uid(),
      date: todayIso(),
      waistCm: changed.has('waistCm') ? values.waistCm : null,
      chestCm: changed.has('chestCm') ? values.chestCm : null,
      armCm: changed.has('armCm') ? values.armCm : null,
      hipCm: changed.has('hipCm') ? values.hipCm : null,
      thighCm: changed.has('thighCm') ? values.thighCm : null,
    };
    const repo = await getRepo();
    await repo.addMeasurement(entry);
    logHaptic();
    router.back();
  }

  return (
    <Screen scroll>
      <BackHeader />
      <Animated.View entering={enterDown(1)} style={styles.headingWrap}>
        <AppText variant="label">{posterDate()}</AppText>
        <AppText variant="heading">Measurements</AppText>
      </Animated.View>

      {values !== null ? (
        <>
          {MEASUREMENT_FIELDS.map(({ key, label }, i) => (
            <Animated.View key={key} entering={enterUp(Math.min(i + 1, 8))}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.fieldRow}>
                <AppText variant="bodyBold">{label}</AppText>
                <Stepper
                  value={values[key]}
                  onChange={(next) => setValues({ ...values, [key]: next })}
                  step={0.5}
                  min={10}
                  max={300}
                  format={(v) => v.toFixed(1)}
                />
              </View>
            </Animated.View>
          ))}

          <Animated.View entering={enterUp(Math.min(MEASUREMENT_FIELDS.length + 1, 8))}>
            <AppText variant="caption" style={styles.hint}>
              Only the fields you change are saved — everything is in cm.
            </AppText>
            <Button
              label="Save"
              onPress={() => void save()}
              loading={saving}
              disabled={changedKeys.length === 0}
            />
          </Animated.View>
        </>
      ) : null}
    </Screen>
  );
}
