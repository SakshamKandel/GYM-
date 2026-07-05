import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, Divider, Sheet } from '../../../components/ui';
import type { BuddyEvent } from '../../../lib/api/client';
import { eventDateIso, formatCompact, formatDuration, relativeDayLabel } from '../logic';

/**
 * Leaderboard tap-through: a buddy's recent synced workout summaries. Reuses
 * the SAME `workout_completed` events the buddy feed already fetches (no new
 * endpoint) — respecting the visibility the feed establishes (only events
 * the server already decided this caller may see). Read-only, no XP/rank.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
  displayName: string;
  events: BuddyEvent[];
  buddyId: string;
  todayIso: string;
}

const RECENT_LIMIT = 8;

export function BuddySummarySheet({ visible, onClose, displayName, events, buddyId, todayIso }: Props) {
  const recent = events
    .filter((e) => e.type === 'workout_completed' && e.actor.id === buddyId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, RECENT_LIMIT);

  return (
    <Sheet visible={visible} onClose={onClose} title={`${displayName}'s recent sessions`}>
      {recent.length === 0 ? (
        <AppText variant="body" color={colors.textDim} style={styles.empty}>
          No recent session summaries to show yet.
        </AppText>
      ) : (
        <View style={styles.list}>
          {recent.map((event) => {
            const name = event.payload?.name ?? 'Workout';
            const dateIso = eventDateIso(event);
            const durationSec = event.payload?.durationSec;
            const volumeKg = event.payload?.volumeKg;
            const prCount = event.payload?.prCount ?? 0;
            return (
              <View key={event.id}>
                <View style={styles.row}>
                  <View style={styles.info}>
                    <AppText variant="bodyBold" numberOfLines={1}>
                      {name}
                    </AppText>
                    <AppText variant="caption">
                      {dateIso ? relativeDayLabel(dateIso, todayIso) : ''}
                      {durationSec !== undefined ? ` · ${formatDuration(durationSec)}` : ''}
                    </AppText>
                  </View>
                  <View style={styles.stats}>
                    {volumeKg !== undefined ? (
                      <AppText variant="caption" tabular>
                        {formatCompact(volumeKg)} kg
                      </AppText>
                    ) : null}
                    {prCount > 0 ? (
                      <AppText variant="caption" color={colors.accent}>
                        {prCount} PR{prCount === 1 ? '' : 's'}
                      </AppText>
                    ) : null}
                  </View>
                </View>
                <Divider />
              </View>
            );
          })}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  empty: { paddingVertical: spacing.lg },
  list: { gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  info: { flex: 1, gap: 1, minWidth: 0 },
  stats: { alignItems: 'flex-end', gap: 1 },
});
