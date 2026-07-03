import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, Button, Divider, enterUp, IconChip, SectionLabel } from '../../../components/ui';
import { posterDate } from '../../../lib/dates';
import { useMeasurements } from '../hooks';
import {
  MEASUREMENT_FIELDS,
  latestMeasurementValues,
  measurementFieldsLabel,
  toHref,
} from '../logic';

/** Latest tape values in a 2-column grid + entry history. Always cm. */

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
  if (entries === null) return null;

  const latest = latestMeasurementValues(entries);
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
          return (
            <View key={key} style={styles.cell}>
              <AppText variant="label" numberOfLines={1}>{label}</AppText>
              <View style={styles.valueRow}>
                <AppText
                  variant="display"
                  color={value !== null ? colors.text : colors.textDim}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                  style={styles.measureValue}
                >
                  {value !== null ? value.toFixed(1) : '—'}
                </AppText>
                <AppText variant="caption">cm</AppText>
              </View>
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
    </View>
  );
}
