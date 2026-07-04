import { StyleSheet, View } from 'react-native';
import { balanceVerdict, MUSCLE_TARGET_BAND, type BalanceVerdict } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, SectionLabel, StatBlock } from '../../../components/ui';
import type { MuscleBalanceData } from '../hooks';
import { fmtSets, muscleLabel } from '../logic';

/**
 * This week's hard sets per muscle against the 10–20 band. The raised zone on
 * each track IS the band; the red fill is this week's volume. Verdicts stay
 * factual — the app informs, it never scolds.
 */

interface Props {
  data: MuscleBalanceData;
}

const VERDICT_TEXT: Record<BalanceVerdict, { label: string; color: string }> = {
  low: { label: 'LOW', color: colors.textDim },
  inRange: { label: 'ON TARGET', color: colors.success },
  high: { label: 'HIGH', color: colors.warning },
};

const styles = StyleSheet.create({
  legend: { marginBottom: spacing.lg },
  muscleRow: { marginBottom: spacing.lg },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.md,
    marginBottom: spacing.xs + 2,
  },
  name: { flex: 1, minWidth: 0 },
  track: {
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  band: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: colors.surfaceRaised,
  },
  fill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.xl },
  stat: { width: '50%' },
  ratioNote: { marginTop: spacing.sm },
  callout: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  empty: { marginTop: spacing.lg },
});

export function MuscleBalanceSection({ data }: Props) {
  if (data.perMuscle.length === 0) {
    return (
      <AppText variant="caption" style={styles.empty}>
        No sets this week yet. Finish a workout and your muscle split lands here.
      </AppText>
    );
  }

  const maxSets = Math.max(...data.perMuscle.map((m) => m.hardSets));
  const scaleMax = Math.max(MUSCLE_TARGET_BAND.max + 4, Math.ceil(maxSets));
  const pct = (v: number): `${number}%` => `${(v / scaleMax) * 100}%`;

  return (
    <View>
      <SectionLabel>Hard sets this week</SectionLabel>
      <AppText variant="caption" color={colors.textFaint} style={styles.legend}>
        The raised zone is the {MUSCLE_TARGET_BAND.min}–{MUSCLE_TARGET_BAND.max} set weekly target
        band. Secondary muscles count half a set.
      </AppText>
      {data.perMuscle.map((m) => {
        const verdict = VERDICT_TEXT[balanceVerdict(m.hardSets)];
        return (
          <View
            key={m.muscle}
            style={styles.muscleRow}
            accessible
            accessibilityLabel={`${muscleLabel(m.muscle)}: ${fmtSets(m.hardSets)} hard sets, ${verdict.label.toLowerCase()}.`}
          >
            <View style={styles.head}>
              <AppText variant="body" style={styles.name} numberOfLines={1}>
                {muscleLabel(m.muscle)}
              </AppText>
              <AppText variant="caption" tabular>
                {fmtSets(m.hardSets)} sets
              </AppText>
              <AppText variant="label" color={verdict.color}>
                {verdict.label}
              </AppText>
            </View>
            <View style={styles.track}>
              <View
                style={[
                  styles.band,
                  {
                    left: pct(MUSCLE_TARGET_BAND.min),
                    width: pct(MUSCLE_TARGET_BAND.max - MUSCLE_TARGET_BAND.min),
                  },
                ]}
              />
              <View style={[styles.fill, { width: pct(Math.min(m.hardSets, scaleMax)) }]} />
            </View>
          </View>
        );
      })}

      <SectionLabel>Balance</SectionLabel>
      <View style={styles.statRow}>
        <StatBlock
          label="Push : pull"
          value={data.ratio !== null ? String(data.ratio) : '—'}
          style={styles.stat}
        />
        <StatBlock label="Muscles hit" value={data.perMuscle.length} style={styles.stat} />
      </View>
      {data.ratio === null ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.ratioNote}>
          Log some pulling work to see your push-pull balance.
        </AppText>
      ) : null}

      {data.neglected.length > 0 ? (
        <>
          <SectionLabel>Not hit yet this week</SectionLabel>
          <View style={styles.callout}>
            <AppText variant="bodyBold">{data.neglected.map(muscleLabel).join(' · ')}</AppText>
            <AppText variant="caption">
              You trained these in the last four weeks — there is still room for them before Sunday.
            </AppText>
          </View>
        </>
      ) : null}
    </View>
  );
}
