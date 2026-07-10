import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { displayWeight, unitLabel, type UnitPref, type WorkoutLog } from '@gym/shared';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  enterFade,
  enterUp,
  IconChip,
  PressableScale,
  Screen,
  ScreenHeader,
  SkeletonRow,
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

/** Sum of a month's PRs, or null while any session's stats are still loading. */
function monthPrCount(
  section: MonthSection,
  stats: Readonly<Record<string, WorkoutStats>>,
): number | null {
  let total = 0;
  for (const w of section.workouts) {
    const s = stats[w.id];
    if (!s) return null;
    total += s.prCount;
  }
  return total;
}

const styles = StyleSheet.create({
  headingWrap: { marginBottom: spacing.lg },
  list: { flex: 1 },
  // Outlined meta pill (brief §6) — chips may carry strokes, cards may not.
  metaChip: {
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  // The screen's ONE red block: the newest month's headline recap. It replaces
  // that month's header row, so the log below starts straight at its sessions.
  hero: {
    backgroundColor: colors.blockRed,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  heroValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  heroValue: { flexShrink: 1 },
  heroUnit: { opacity: 0.6 },
  heroChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  // Charcoal session block — fill contrast instead of hairline dividers.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
    marginBottom: spacing.sm,
  },
  rowText: { flex: 1, gap: 2 },
  // Right-aligned meta must not be pushed off-screen by a long session name.
  rowMeta: { flexShrink: 0, alignItems: 'flex-end' },
  rowVolumeRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  // Oswald volume numerals — the row's visual anchor.
  rowVolume: { fontFamily: type.display, fontSize: 20, color: colors.text, letterSpacing: 0.5 },
  emptyWrap: {
    alignItems: 'center',
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: { marginTop: spacing.sm },
  emptyBtn: { marginTop: spacing.lg, alignSelf: 'stretch' },
  loadingWrap: { gap: spacing.lg, paddingTop: spacing.md },
});

function MetaChip({ label }: { label: string }) {
  return (
    <View style={styles.metaChip}>
      <AppText variant="label" color={colors.text} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

/** Red hero block: the newest month's tonnage headline with session/PR pills. */
function LatestMonthHero({
  section,
  stats,
  unitPref,
}: {
  section: MonthSection;
  stats: Readonly<Record<string, WorkoutStats>>;
  unitPref: UnitPref;
}) {
  const unit = unitLabel(unitPref);
  const tonnage = monthTonnageKg(section, stats);
  const prs = monthPrCount(section, stats);
  const sessions = section.workouts.length;
  return (
    <View style={styles.hero}>
      <AppText variant="label" color={colors.onBlock}>
        {section.label}
      </AppText>
      <View style={styles.heroValueRow}>
        <AppText
          variant="stat"
          color={colors.onBlock}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={styles.heroValue}
        >
          {tonnage !== null ? formatCompact(displayWeight(tonnage, unitPref)) : '—'}
        </AppText>
        <AppText variant="title" color={colors.onBlock} style={styles.heroUnit}>
          {`${unit} total`}
        </AppText>
      </View>
      <View style={styles.heroChips}>
        <Tag
          variant="onBlock"
          label={`${sessions} ${sessions === 1 ? 'session' : 'sessions'}`}
        />
        {prs !== null && prs > 0 ? (
          <Tag variant="onBlock" label={prs === 1 ? '1 PR' : `${prs} PRS`} />
        ) : null}
      </View>
    </View>
  );
}

function MonthHeader({ row, unitPref }: { row: Row & { kind: 'month' }; unitPref: UnitPref }) {
  const unit = unitLabel(unitPref);
  const sessions = `${row.sessions} ${row.sessions === 1 ? 'session' : 'sessions'}`;
  const tonnage =
    row.tonnageKg !== null
      ? ` · ${formatCompact(displayWeight(row.tonnageKg, unitPref))} ${unit}`
      : '';
  return (
    <View style={styles.monthRow}>
      <AppText variant="label">{row.label}</AppText>
      <AppText variant="caption" tabular numberOfLines={1}>
        {`${sessions}${tonnage}`}
      </AppText>
    </View>
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
          <>
            <View style={styles.rowVolumeRow}>
              <AppText tabular numberOfLines={1} style={styles.rowVolume}>
                {formatCompact(displayWeight(stats.volumeKg, unitPref))}
              </AppText>
              <AppText variant="caption">{unit}</AppText>
            </View>
            <AppText variant="caption" tabular numberOfLines={1}>
              {`${stats.setCount} sets`}
            </AppText>
          </>
        ) : (
          <AppText variant="caption" color={colors.textFaint}>
            …
          </AppText>
        )}
      </View>
    </PressableScale>
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
        {"Finish your first workout and it'll show up here."}
      </AppText>
      <Button
        label="Start training"
        onPress={() => router.push('/(tabs)/train')}
        style={styles.emptyBtn}
      />
    </Animated.View>
  );
}

/** Static skeleton rows while the first load is in flight (design law: no shimmer). */
function LoadingState() {
  return (
    <View style={styles.loadingWrap} accessibilityLabel="Loading history">
      {[0, 1, 2, 3, 4].map((i) => (
        <SkeletonRow key={i} />
      ))}
    </View>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Animated.View entering={enterFade(0)} style={styles.emptyWrap}>
      <IconChip icon="alert-circle" color={colors.surface} iconColor={colors.textFaint} size={52} />
      <AppText variant="bodyBold" center style={styles.emptyTitle}>
        {"Couldn't load your history"}
      </AppText>
      <AppText variant="body" color={colors.textDim} center>
        Something went wrong reading your saved sessions.
      </AppText>
      <Button label="Try again" onPress={onRetry} style={styles.emptyBtn} />
    </Animated.View>
  );
}

function buildRows(
  months: MonthSection[] | null,
  stats: Readonly<Record<string, WorkoutStats>>,
): Row[] {
  if (months === null) return [];
  const rows: Row[] = [];
  months.forEach((section, i) => {
    // The newest month's header IS the red hero above the list — no row for it.
    if (i > 0) {
      rows.push({
        kind: 'month',
        key: `m-${section.key}`,
        label: section.label,
        sessions: section.workouts.length,
        tonnageKg: monthTonnageKg(section, stats),
      });
    }
    for (const w of section.workouts) rows.push({ kind: 'workout', key: w.id, workout: w });
  });
  return rows;
}

export default function HistoryScreen() {
  const unitPref = useProfile((s) => s.unitPref);
  const { months, stats, error, reload } = useHistory();
  const flaggedIds = useFlaggedWorkoutIds();
  const rows = useMemo(() => buildRows(months, stats), [months, stats]);
  const latest = months !== null ? (months[0] ?? null) : null;
  const totalSessions = useMemo(
    () => (months === null ? null : months.reduce((n, s) => n + s.workouts.length, 0)),
    [months],
  );

  return (
    <Screen>
      <BackHeader />
      <ScreenHeader
        eyebrow="Training log"
        title="History"
        meta={
          totalSessions !== null && totalSessions > 0 ? (
            <MetaChip
              label={`${totalSessions} ${totalSessions === 1 ? 'session' : 'sessions'}`}
            />
          ) : undefined
        }
        style={styles.headingWrap}
      />

      {/* FlashList is virtualized — animate the container only, never the rows. */}
      <Animated.View entering={enterUp(0)} style={styles.list}>
        {error ? (
          <ErrorState onRetry={reload} />
        ) : months === null ? (
          <LoadingState />
        ) : (
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
            ListHeaderComponent={
              latest !== null ? (
                <LatestMonthHero section={latest} stats={stats} unitPref={unitPref} />
              ) : null
            }
            ListEmptyComponent={<EmptyState />}
          />
        )}
      </Animated.View>
    </Screen>
  );
}
