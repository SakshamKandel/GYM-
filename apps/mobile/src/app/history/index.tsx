import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { displayWeight, unitLabel, type UnitPref, type WorkoutLog } from '@gym/shared';
import { colors, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  Divider,
  enterDown,
  enterFade,
  enterUp,
  IconChip,
  PressableScale,
  Screen,
  Tag,
} from '../../components/ui';
import { BackHeader } from '../../features/body/components/BackHeader';
import { useHistory } from '../../features/history/hooks';
import {
  formatCompact,
  minutesLabel,
  monthTonnageKg,
  type MonthSection,
  type WorkoutStats,
} from '../../features/history/logic';
import { openWorkout } from '../../features/history/nav';
import { getGamificationFlags } from '../../lib/api/gamification';
import { posterDate } from '../../lib/dates';
import { useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';

/**
 * Flagged workout ids for the quiet "not counted toward rankings" row —
 * best-effort, never blocks the list (design law 4: flagged sessions stay
 * fully visible in history, they just quietly note they're unranked).
 */
function useFlaggedWorkoutIds(): Set<string> {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (status !== 'signedIn' || token === null) {
      setFlagged(new Set());
      return;
    }
    let mounted = true;
    void (async () => {
      try {
        const flags = await getGamificationFlags(token);
        if (mounted) setFlagged(new Set(flags.map((f) => f.workoutId)));
      } catch {
        // Best-effort — an empty set just means no quiet notes show this load.
      }
    })();
    return () => {
      mounted = false;
    };
  }, [status, token]);

  return flagged;
}

/** Every finished session, newest first, sectioned by month. */

type Row =
  | { kind: 'month'; key: string; label: string; sessions: number; tonnageKg: number | null }
  | { kind: 'workout'; key: string; workout: WorkoutLog };

const styles = StyleSheet.create({
  headingWrap: { marginBottom: spacing.sm },
  list: { flex: 1 },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: touch.min,
  },
  rowText: { flex: 1 },
  // Right-aligned meta must not be pushed off-screen by a long session name.
  rowMeta: { flexShrink: 0, alignItems: 'flex-end' },
  emptyWrap: {
    alignItems: 'center',
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: { marginTop: spacing.sm },
  emptyBtn: { marginTop: spacing.lg, alignSelf: 'stretch' },
});

function MonthHeader({ row, unitPref }: { row: Row & { kind: 'month' }; unitPref: UnitPref }) {
  const unit = unitLabel(unitPref);
  const sessions = `${row.sessions} ${row.sessions === 1 ? 'session' : 'sessions'}`;
  const tonnage =
    row.tonnageKg !== null
      ? ` · ${formatCompact(displayWeight(row.tonnageKg, unitPref))} ${unit}`
      : '';
  return (
    <>
      <View style={styles.monthRow}>
        <AppText variant="label" color={colors.text}>
          {row.label}
        </AppText>
        <AppText variant="caption" tabular numberOfLines={1}>
          {`${sessions}${tonnage}`}
        </AppText>
      </View>
      <Divider />
    </>
  );
}

function WorkoutRow({
  workout,
  stats,
  unitPref,
  flagged,
}: {
  workout: WorkoutLog;
  stats: WorkoutStats | undefined;
  unitPref: UnitPref;
  flagged: boolean;
}) {
  const unit = unitLabel(unitPref);
  const duration = minutesLabel(workout.durationSec);
  return (
    <>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Open ${workout.name}, ${posterDate(workout.date)}`}
        onPress={() => openWorkout(workout.id)}
        style={styles.row}
      >
        <View style={styles.rowText}>
          <AppText variant="bodyBold" numberOfLines={1}>
            {workout.name}
          </AppText>
          <AppText variant="caption" numberOfLines={1}>
            {`${posterDate(workout.date)}${duration ? ` · ${duration}` : ''}`}
          </AppText>
          {flagged ? (
            <AppText variant="caption" color={colors.textFaint} numberOfLines={1}>
              Not counted toward rankings — fix this entry?
            </AppText>
          ) : null}
        </View>
        {stats !== undefined && stats.prCount > 0 ? (
          <Tag label={stats.prCount === 1 ? 'PR' : `${stats.prCount} PRS`} variant="outline" />
        ) : null}
        <View style={styles.rowMeta}>
          {stats !== undefined ? (
            <AppText variant="caption" tabular numberOfLines={1}>
              {`${formatCompact(displayWeight(stats.volumeKg, unitPref))} ${unit} · ${stats.setCount} sets`}
            </AppText>
          ) : (
            <AppText variant="caption" color={colors.textFaint}>
              …
            </AppText>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </PressableScale>
      <Divider />
    </>
  );
}

function EmptyState() {
  return (
    <Animated.View entering={enterFade(0)} style={styles.emptyWrap}>
      <IconChip icon="barbell" color={colors.surface} iconColor={colors.textFaint} size={52} />
      <AppText variant="bodyBold" center style={styles.emptyTitle}>
        No sessions yet
      </AppText>
      <AppText variant="body" color={colors.textDim} center>
        Finish your first workout and it'll show up here.
      </AppText>
      <Button
        label="Start training"
        onPress={() => router.push('/(tabs)/train')}
        style={styles.emptyBtn}
      />
    </Animated.View>
  );
}

function buildRows(
  months: MonthSection[] | null,
  stats: Readonly<Record<string, WorkoutStats>>,
): Row[] {
  if (months === null) return [];
  const rows: Row[] = [];
  for (const section of months) {
    rows.push({
      kind: 'month',
      key: `m-${section.key}`,
      label: section.label,
      sessions: section.workouts.length,
      tonnageKg: monthTonnageKg(section, stats),
    });
    for (const w of section.workouts) rows.push({ kind: 'workout', key: w.id, workout: w });
  }
  return rows;
}

export default function HistoryScreen() {
  const unitPref = useProfile((s) => s.unitPref);
  const { months, stats } = useHistory();
  const flaggedIds = useFlaggedWorkoutIds();
  const rows = useMemo(() => buildRows(months, stats), [months, stats]);

  return (
    <Screen>
      <BackHeader />
      <Animated.View entering={enterDown(1)} style={styles.headingWrap}>
        <AppText variant="label">Training log</AppText>
        <AppText variant="heading">History</AppText>
      </Animated.View>

      {/* FlashList is virtualized — animate the container only, never the rows. */}
      <Animated.View entering={enterUp(0)} style={styles.list}>
        <FlashList
          data={rows}
          keyExtractor={(r) => r.key}
          getItemType={(r) => r.kind}
          renderItem={({ item }) =>
            item.kind === 'month' ? (
              <MonthHeader row={item} unitPref={unitPref} />
            ) : (
              <WorkoutRow
                workout={item.workout}
                stats={stats[item.workout.id]}
                unitPref={unitPref}
                flagged={flaggedIds.has(item.workout.id)}
              />
            )
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          ListEmptyComponent={months !== null ? <EmptyState /> : null}
        />
      </Animated.View>
    </Screen>
  );
}
