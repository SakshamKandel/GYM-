import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Card } from '../ui';
import { addDays, todayIso } from '../../lib/dates';
import { weekStartIso } from '../../features/engagement/logic';

const DAY_NAMES = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  daysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    gap: 4,
    minHeight: 58,
  },
  dayCellToday: {
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  dayCellActive: {
    backgroundColor: colors.blockRed,
  },
  dayLabelActive: {
    color: colors.onBlock,
  },
  dayNumActive: {
    color: colors.onBlock,
  },
});

interface WeeklyActivityStripProps {
  /** Dates (ISO format 'YYYY-MM-DD') that have completed sessions this week */
  activeDates: Set<string>;
  targetSessions?: number;
}

export const WeeklyActivityStrip = memo(function WeeklyActivityStrip({
  activeDates,
  targetSessions = 4,
}: WeeklyActivityStripProps) {
  const today = todayIso();
  const monday = weekStartIso(today);

  // Generate 7 days (Mon .. Sun)
  const days = Array.from({ length: 7 }, (_, i) => {
    const dateStr = addDays(monday, i);
    const dayNum = parseInt(dateStr.slice(8), 10);
    const isToday = dateStr === today;
    const isActive = activeDates.has(dateStr);
    return {
      dateStr,
      label: DAY_NAMES[i],
      dayNum,
      isToday,
      isActive,
    };
  });

  const activeCount = days.filter((d) => d.isActive).length;

  return (
    <Card style={styles.container}>
      <View style={styles.headerRow}>
        <AppText variant="label" color={colors.textDim}>
          This Week&apos;s Activity
        </AppText>
        <AppText variant="caption" color={colors.textDim} tabular>
          {activeCount} of {targetSessions} workouts
        </AppText>
      </View>
      <View style={styles.daysRow}>
        {days.map((day) => {
          return (
            <View
              key={day.dateStr}
              style={[
                styles.dayCell,
                day.isToday && !day.isActive && styles.dayCellToday,
                day.isActive && styles.dayCellActive,
              ]}
              accessibilityLabel={`${day.label} ${day.dayNum}, ${day.isActive ? 'workout completed' : 'rest day'}`}
            >
              <AppText
                variant="label"
                color={day.isActive ? colors.onBlock : colors.textDim}
                style={day.isActive && styles.dayLabelActive}
              >
                {day.label}
              </AppText>
              {day.isActive ? (
                <Ionicons name="checkmark-sharp" size={16} color={colors.onBlock} />
              ) : (
                <AppText
                  variant="bodyBold"
                  color={day.isToday ? colors.text : colors.textDim}
                  style={{ fontSize: 13, lineHeight: 16 }}
                >
                  {day.dayNum}
                </AppText>
              )}
            </View>
          );
        })}
      </View>
    </Card>
  );
});
