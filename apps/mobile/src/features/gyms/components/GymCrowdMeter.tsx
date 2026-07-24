import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { Ionicons } from '@expo/vector-icons';
import type { GymCrowdStatus } from '@gym/shared';
import { AppText, Card } from '../../../components/ui';

const LEVEL_COLORS: Record<string, string> = {
  quiet: colors.success,
  moderate: colors.warning,
  busy: colors.orange,
  packed: colors.accent,
};

const LEVEL_LABELS: Record<GymCrowdStatus['level'], string> = {
  quiet: 'Quiet',
  moderate: 'Moderate',
  busy: 'Busy',
  packed: 'Packed',
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
  const levelText = LEVEL_LABELS[crowd.level];
  const occupancy = crowd.hourlyOccupancy;

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
            {crowd.percentage}% occupied
          </AppText>
        </View>
      </View>

      {/* Never synthesize an hourly curve: render only a complete backend profile. */}
      {occupancy ? (
        <View style={styles.chartContainer} accessible accessibilityLabel="Reported hourly occupancy">
          <View style={styles.barsRow}>
            {occupancy.map((val, idx) => {
              const isCurrent = idx === currentHour;
              const barHeight = (val / 100) * 44;
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
      ) : null}

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
