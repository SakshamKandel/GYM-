import { StyleSheet, View } from 'react-native';
import { displayWeight, unitLabel, type PlateauVerdict, type UnitPref } from '@gym/shared';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import { AppText, Divider, SectionLabel, Tag } from '../../../components/ui';
import type { Big4Row } from '../hooks';

/**
 * Squat / bench / deadlift / press: best e1RM each plus a plateau read from
 * recent history. Lifts with no sets yet show a plain dash — never fake numbers.
 */

interface Props {
  rows: Big4Row[];
  unitPref: UnitPref;
}

const VERDICT: Record<Exclude<PlateauVerdict, 'insufficient'>, { label: string; color: string }> = {
  progressing: { label: 'UP', color: colors.success },
  plateau: { label: 'FLAT', color: colors.warning },
  regressing: { label: 'DOWN', color: colors.textDim },
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  name: { flex: 1, minWidth: 0 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, flexShrink: 0 },
  value: { fontFamily: type.display, fontSize: 24, color: colors.text },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
});

export function Big4Card({ rows, unitPref }: Props) {
  const unit = unitLabel(unitPref);
  const logged = rows.filter((r) => r.bestE1RmKg !== null);
  const totalKg = logged.reduce((sum, r) => sum + (r.bestE1RmKg ?? 0), 0);

  return (
    <View>
      <SectionLabel>The big four</SectionLabel>
      <View style={styles.card}>
        {rows.map((r, i) => {
          const verdict = r.verdict === 'insufficient' ? null : VERDICT[r.verdict];
          return (
            <View key={r.key}>
              {i > 0 ? <Divider /> : null}
              <View
                style={styles.row}
                accessible
                accessibilityLabel={
                  r.bestE1RmKg !== null
                    ? `${r.label}: best estimated one rep max ${Math.round(
                        displayWeight(r.bestE1RmKg, unitPref),
                      )} ${unit}${verdict ? `, trend ${verdict.label.toLowerCase()}` : ''}.`
                    : `${r.label}: no sets yet.`
                }
              >
                <AppText variant="bodyBold" style={styles.name} numberOfLines={1}>
                  {r.label}
                </AppText>
                {verdict ? <Tag label={verdict.label} color={verdict.color} /> : null}
                <View style={styles.valueRow}>
                  {r.bestE1RmKg !== null ? (
                    <>
                      <AppText style={styles.value} tabular>
                        {Math.round(displayWeight(r.bestE1RmKg, unitPref))}
                      </AppText>
                      <AppText variant="caption">{unit}</AppText>
                    </>
                  ) : (
                    <AppText variant="caption" color={colors.textFaint}>
                      no sets yet
                    </AppText>
                  )}
                </View>
              </View>
            </View>
          );
        })}
        {logged.length > 0 ? (
          <>
            <Divider />
            <View style={styles.totalRow}>
              <View>
                <AppText variant="label">Big-4 total</AppText>
                {logged.length < rows.length ? (
                  <AppText variant="caption" color={colors.textFaint}>
                    {logged.length} of {rows.length} lifts logged
                  </AppText>
                ) : null}
              </View>
              <View style={styles.valueRow}>
                <AppText variant="display" tabular>
                  {Math.round(displayWeight(totalKg, unitPref))}
                </AppText>
                <AppText variant="caption">{unit}</AppText>
              </View>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}
