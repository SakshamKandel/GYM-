import { useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  Divider,
  enterUp,
  IconChip,
  PressableScale,
  SectionLabel,
  Sheet,
} from '../../../components/ui';
import { posterDate } from '../../../lib/dates';
import { useProfile } from '../../../state/profile';
import { useMeasurements } from '../hooks';
import { displayLength, lengthUnitLabel } from '../lengthUnits';
import {
  MEASUREMENT_FIELDS,
  latestMeasurementValues,
  measurementFieldsLabel,
  measurementSeries,
  toHref,
  type MeasurementKey,
} from '../logic';
import { MeasurementDetailSheet } from './MeasurementDetailSheet';

/** Latest tape values in a 2-column grid + entry history.
 * Stored cm canonically; displayed in the user's unit (cm or inches). */

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    // lg (not xl): the chips row above already contributes its own margin.
    marginTop: spacing.lg,
  },
  headerText: { flex: 1 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xl,
    marginTop: spacing.xl,
  },
  cell: { width: '50%', paddingRight: spacing.md },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  labelText: { flexShrink: 1, minWidth: 0 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, minWidth: 0 },
  measureValue: { flexShrink: 1, minWidth: 0 },
  cta: { marginTop: spacing.xl },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  historyDate: { flexShrink: 0 },
  historyMeta: { flexShrink: 1, minWidth: 0, textAlign: 'right' },
});

export function MeasurementsSection() {
  const entries = useMeasurements();
  const unitPref = useProfile((s) => s.unitPref);
  // `openKey` names the field to render; `sheetOpen` drives visibility. Keeping
  // the key set while the sheet animates out means the content doesn't blank
  // mid-exit (same idea as StreakChip keeping its prop).
  const [openKey, setOpenKey] = useState<MeasurementKey | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  if (entries === null) return null;

  const latest = latestMeasurementValues(entries);
  const openField = MEASUREMENT_FIELDS.find((f) => f.key === openKey) ?? null;

  const openDetail = (key: MeasurementKey): void => {
    setOpenKey(key);
    setSheetOpen(true);
  };
  // Order-independent "last taped" date — entries only carry changed fields.
  const lastDate = entries.reduce<string | null>(
    (acc, e) => (acc === null || e.date > acc ? e.date : acc),
    null,
  );

  return (
    <View>
      <Animated.View entering={enterUp(0)} style={styles.headerRow}>
        <IconChip icon="body" />
        <View style={styles.headerText}>
          <AppText variant="bodyBold">Tape measurements</AppText>
          <AppText variant="caption">
            {lastDate !== null ? `Last taped ${posterDate(lastDate)}` : 'No entries yet'}
          </AppText>
        </View>
      </Animated.View>

      <Animated.View entering={enterUp(1)} style={styles.grid}>
        {MEASUREMENT_FIELDS.map(({ key, label }) => {
          const value = latest[key];
          const shown = value !== null ? displayLength(value, unitPref) : null;
          const inner = (
            <>
              <View style={styles.labelRow}>
                <AppText variant="label" numberOfLines={1} style={styles.labelText}>
                  {label}
                </AppText>
                {value !== null ? (
                  <Ionicons name="chevron-forward" size={13} color={colors.textFaint} />
                ) : null}
              </View>
              <View style={styles.valueRow}>
                <AppText
                  variant="display"
                  color={value !== null ? colors.text : colors.textDim}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                  style={styles.measureValue}
                >
                  {shown !== null ? shown.toFixed(1) : '—'}
                </AppText>
                <AppText variant="caption">{lengthUnitLabel(unitPref)}</AppText>
              </View>
            </>
          );
          return value !== null && shown !== null ? (
            <PressableScale
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`View ${label} history, latest ${shown.toFixed(1)} ${
                unitPref === 'kg' ? 'centimetres' : 'inches'
              }`}
              onPress={() => openDetail(key)}
              style={styles.cell}
            >
              {inner}
            </PressableScale>
          ) : (
            <View key={key} style={styles.cell}>
              {inner}
            </View>
          );
        })}
      </Animated.View>

      <Animated.View entering={enterUp(2)}>
        <Button
          label="Add measurements"
          variant="secondary"
          onPress={() => router.push(toHref('/body/measure'))}
          style={styles.cta}
        />
      </Animated.View>

      {entries.length > 0 ? (
        <Animated.View entering={enterUp(3)}>
          <SectionLabel>History</SectionLabel>
          <Divider />
          {entries.slice(0, 5).map((entry) => (
            <View key={entry.id}>
              <View style={styles.historyRow}>
                <AppText variant="bodyBold" numberOfLines={1} style={styles.historyDate}>
                  {posterDate(entry.date)}
                </AppText>
                <AppText variant="caption" numberOfLines={1} style={styles.historyMeta}>
                  {measurementFieldsLabel(entry)}
                </AppText>
              </View>
              <Divider />
            </View>
          ))}
        </Animated.View>
      ) : null}

      <Sheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={openField ? `${openField.label} history` : ''}
      >
        {openKey !== null && openField ? (
          <MeasurementDetailSheet
            label={openField.label}
            series={measurementSeries(entries, openKey)}
          />
        ) : null}
      </Sheet>
    </View>
  );
}
