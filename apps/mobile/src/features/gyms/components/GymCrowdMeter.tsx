import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { Ionicons } from '@expo/vector-icons';
import { AppText, Card } from '../../../components/ui';
import type { GymCrowdStatus } from '../api';

const LEVEL_COLORS: Record<string, string> = {
  quiet: colors.success,
  moderate: colors.warning,
  busy: colors.orange,
  packed: colors.accent,
};

const LEVEL_LABELS: Record<string, string> = {
  quiet: 'Quiet • Optimal training time',
  moderate: 'Moderate • Good equipment availability',
  busy: 'Busy • Peak training hours',
  packed: 'Packed • High wait times',
};

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
  },
  percentageBadge: {
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  chartContainer: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 52,
    gap: 3,
    paddingTop: spacing.xs,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
  },
  barTrack: {
    width: '100%',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 2,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  barFill: {
    width: '100%',
    borderRadius: 2,
  },
  hourLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  peakFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
});

export function GymCrowdMeter({ crowd }: { crowd: GymCrowdStatus }) {
  const currentHour = new Date().getHours();
  const levelColor = LEVEL_COLORS[crowd.level] ?? colors.warning;
  const levelText = LEVEL_LABELS[crowd.level] ?? 'Moderate occupancy';

  // 24-hour occupancy fallback array
  const occupancy =
    crowd.hourlyOccupancy && crowd.hourlyOccupancy.length === 24
      ? crowd.hourlyOccupancy
      : Array.from({ length: 24 }, (_, i) =>
          i >= 7 && i <= 9 ? 80 : i >= 17 && i <= 20 ? 88 : i >= 11 && i <= 14 ? 50 : 25,
        );

  return (
    <Card padding={spacing.lg} style={styles.container}>
      {/* Status top header */}
      <View style={styles.statusHeader}>
        <View style={styles.statusLeft}>
          <View style={[styles.pulseDot, { backgroundColor: levelColor }]} />
          <AppText variant="bodyBold" color={colors.text}>
            {levelText}
          </AppText>
        </View>
        <View style={styles.percentageBadge}>
          <AppText variant="label" color={levelColor}>
            {crowd.percentage}% Full
          </AppText>
        </View>
      </View>

      {/* 24-Hour Peak Hours Visualizer */}
      <View style={styles.chartContainer}>
        <View style={styles.barsRow}>
          {occupancy.map((val, idx) => {
            const isCurrent = idx === currentHour;
            const barHeight = Math.max(12, (val / 100) * 44);
            const barColor =
              val > 75 ? colors.accent : val > 50 ? colors.warning : colors.success;

            return (
              <View key={idx} style={styles.barCol}>
                <View style={[styles.barTrack, { height: 44 }]}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        height: barHeight,
                        backgroundColor: isCurrent ? colors.text : barColor,
                        opacity: isCurrent ? 1 : 0.65,
                      },
                    ]}
                  />
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.hourLabelsRow}>
          <AppText variant="caption" color={colors.textDim}>
            12 AM
          </AppText>
          <AppText variant="caption" color={colors.textDim}>
            6 AM
          </AppText>
          <AppText variant="caption" color={colors.textDim}>
            12 PM
          </AppText>
          <AppText variant="caption" color={colors.textDim}>
            6 PM
          </AppText>
          <AppText variant="caption" color={colors.textDim}>
            11 PM
          </AppText>
        </View>
      </View>

      {crowd.peakHoursText ? (
        <View style={styles.peakFooter}>
          <Ionicons name="time-outline" size={14} color={colors.textDim} />
          <AppText variant="caption" color={colors.textDim}>
            {crowd.peakHoursText}
          </AppText>
        </View>
      ) : null}
    </Card>
  );
}
