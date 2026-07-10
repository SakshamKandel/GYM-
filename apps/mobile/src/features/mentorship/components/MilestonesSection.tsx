import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, IconChip, SectionLabel } from '../../../components/ui';
import { posterDate, toIsoDate } from '../../../lib/dates';
import { useMyMilestones } from '../hooks';

/**
 * "Coach milestones" — achievements the member's coach logged for them,
 * rendered as gap-separated charcoal rows (ribbon icon chip, title + note,
 * date + coach name on the right rail). Self-contained: fetches via
 * useMyMilestones and renders NOTHING when signed out or the list is empty,
 * so host screens can drop it in unconditionally.
 */

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },
  main: { flex: 1, gap: 2 },
  rail: { flexShrink: 0, alignItems: 'flex-end', gap: 2 },
});

/** "THU, JUL 3" from an ISO timestamp; empty when unparseable. */
function achievedLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : posterDate(toIsoDate(d));
}

export function MilestonesSection() {
  const { milestones } = useMyMilestones();

  if (milestones.length === 0) return null;

  return (
    <View>
      <SectionLabel>Coach milestones</SectionLabel>
      <View style={styles.stack}>
        {milestones.map((m) => {
          const date = achievedLabel(m.achievedAt);
          return (
            <View
              key={m.id}
              accessible
              accessibilityLabel={`Milestone: ${m.title}${m.note ? `. ${m.note}` : ''}${
                date ? `. ${date}` : ''
              }. From coach ${m.coachName}`}
              style={styles.row}
            >
              <IconChip icon="ribbon" />
              <View style={styles.main}>
                <AppText variant="bodyBold" numberOfLines={1}>
                  {m.title}
                </AppText>
                {m.note ? (
                  <AppText variant="caption" color={colors.textDim} numberOfLines={2}>
                    {m.note}
                  </AppText>
                ) : null}
              </View>
              <View style={styles.rail}>
                {date ? <AppText variant="label">{date}</AppText> : null}
                <AppText variant="caption" color={colors.textFaint} numberOfLines={1}>
                  {m.coachName}
                </AppText>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
