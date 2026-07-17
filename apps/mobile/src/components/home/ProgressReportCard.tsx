import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, Card, StatBlock } from '../ui';
import { ProgressMotif } from '../visual';

/**
 * Home "Progress report" block — three headline stats (sessions this week,
 * PRs in the last 30 days, 30-day weight-trend delta) plus the latest PR as
 * a caption. Purely presentational: the screen computes everything from
 * offline stores and passes strings/numbers down, so this renders instantly.
 *
 * The whole card is ONE tap target into the Progress tab (secondary
 * affordance — the hero keeps the screen's single primary CTA). Weight delta
 * ink stays neutral: whether up is good depends on the goal, we don't judge.
 */
interface Props {
  /** Finished sessions this week (Monday → today). */
  sessions: number;
  /** PRs set in the last 30 days. */
  prCount: number;
  /** Signed 30-day trend delta in display units ("+0.4" / "−1.2"), or null
   * when fewer than two trend points exist yet. */
  weightDeltaText: string | null;
  /** Display unit label for the weight delta ("kg" / "lb"). */
  unit: string;
  /** "Bench Press · 100 kg × 5", or null when no PR has been set yet. */
  latestPrText: string | null;
  onOpen: () => void;
}

const styles = StyleSheet.create({
  // overflow:hidden clips the decorative rising-bars motif to the block corners.
  card: { marginBottom: spacing.md, gap: spacing.lg, overflow: 'hidden' },
  statRow: { flexDirection: 'row', gap: spacing.md },
  statCell: { flex: 1, minWidth: 0 },
  prRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  prText: { flex: 1 },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
});

export function ProgressReportCard({
  sessions,
  prCount,
  weightDeltaText,
  unit,
  latestPrText,
  onOpen,
}: Props) {
  const weightLine =
    weightDeltaText !== null ? `weight trend ${weightDeltaText} ${unit} in 30 days` : '';
  const label =
    `Progress report: ${sessions} ${sessions === 1 ? 'session' : 'sessions'} this week, ` +
    `${prCount} ${prCount === 1 ? 'PR' : 'PRs'} in 30 days` +
    (weightLine !== '' ? `, ${weightLine}` : '') +
    (latestPrText !== null ? `. Latest PR ${latestPrText}` : '') +
    '. Open Progress';

  return (
    <Card accessibilityLabel={label} onPress={onOpen} style={styles.card}>
      <ProgressMotif />
      <View style={styles.statRow}>
        <StatBlock label="Sessions" value={sessions} unit="wk" style={styles.statCell} />
        <StatBlock label="PRs" value={prCount} unit="30d" style={styles.statCell} />
        <StatBlock
          label="Weight"
          value={weightDeltaText ?? '—'}
          unit={weightDeltaText !== null ? `${unit} 30d` : undefined}
          style={styles.statCell}
        />
      </View>

      {latestPrText !== null ? (
        <View style={styles.prRow}>
          <Ionicons name="trophy-outline" size={16} color={colors.textDim} />
          <AppText variant="caption" numberOfLines={1} style={styles.prText}>
            Latest PR · {latestPrText}
          </AppText>
        </View>
      ) : null}

      <View style={styles.footerRow}>
        <AppText variant="bodyBold" numberOfLines={1}>
          Open Progress
        </AppText>
        <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
      </View>
    </Card>
  );
}
