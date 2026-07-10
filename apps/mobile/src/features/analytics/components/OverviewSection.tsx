import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { displayWeight, unitLabel } from '@gym/shared';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, Card, EmptyState, SectionLabel } from '../../../components/ui';
import { todayIso } from '../../../lib/dates';
import { useProfile } from '../../../state/profile';
import type { OverviewData } from '../hooks';
import { buildHeatmap, fmtCompact } from '../logic';
import { ConsistencyHeatmap } from './ConsistencyHeatmap';
import { TonnageChart } from './TonnageChart';

/**
 * Overview: the consistency calendar, weekly tonnage, and the numbers behind
 * them. Block language (REVAMP-BRIEF): borderless charcoal blocks for the
 * charts, and the 12-week stats live on the screen's one cream counterpoint
 * block — the red hero is already the screen-level "Monthly pace" block.
 */

interface Props {
  data: OverviewData;
}

const styles = StyleSheet.create({
  caption: { marginTop: spacing.md },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.xl },
  stat: { width: '50%' },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, minWidth: 0 },
  statValue: { flexShrink: 1 },
});

/**
 * StatBlock's eyebrow-number unit re-inked for the cream block: black Oswald
 * numeral (`onBlock`), `creamDim` eyebrow/unit — never white on cream.
 */
function CreamStat({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <View style={styles.stat}>
      <AppText variant="label" color={colors.creamDim} numberOfLines={1}>
        {label}
      </AppText>
      <View style={styles.statValueRow}>
        <AppText
          variant="display"
          color={colors.onBlock}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={styles.statValue}
        >
          {value}
        </AppText>
        {unit ? (
          <AppText variant="caption" color={colors.creamDim}>
            {unit}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

export function OverviewSection({ data }: Props) {
  const unitPref = useProfile((s) => s.unitPref);
  const daysPerWeek = useProfile((s) => s.daysPerWeek);
  const weeks = buildHeatmap(data.workoutDates, todayIso());
  const { avgPerWeek, adherencePct } = data.consistency;

  // Nothing in the whole 12-week window — an all-zero calendar and chart would
  // just look broken, so point at the one action that starts the data flowing.
  if (data.workoutDates.length === 0) {
    return (
      <EmptyState
        icon="barbell-outline"
        title="No workouts yet"
        body="Finish your first session and your training calendar, weekly tonnage and stats build here."
        actionLabel="Log your first workout"
        onAction={() => router.push('/(tabs)/train')}
      />
    );
  }

  return (
    <View>
      <SectionLabel>Training calendar</SectionLabel>
      <Card>
        <ConsistencyHeatmap weeks={weeks} />
        <AppText variant="caption" color={colors.textDim} style={styles.caption}>
          Last 12 weeks — every filled square is a session. Today is outlined.
        </AppText>
      </Card>

      <SectionLabel>Weekly tonnage</SectionLabel>
      <Card>
        <TonnageChart weeks={data.tonnage} unitPref={unitPref} />
      </Card>

      <SectionLabel>12-week stats</SectionLabel>
      <Card variant="cream">
        <View style={styles.statRow}>
          <CreamStat label="Sessions / week" value={avgPerWeek} unit={`of ${daysPerWeek}`} />
          <CreamStat label="Adherence" value={adherencePct} unit="%" />
          <CreamStat
            label="Avg session"
            value={data.avgSessionMin ?? '—'}
            unit={data.avgSessionMin !== null ? 'min' : undefined}
          />
          <CreamStat
            label="Total lifted"
            value={fmtCompact(displayWeight(data.totalTonnageKg, unitPref))}
            unit={unitLabel(unitPref)}
          />
        </View>
      </Card>
    </View>
  );
}
