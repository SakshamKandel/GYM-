import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { displayWeight, unitLabel, type PrRecord, type UnitPref } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import {
  AnimatedNumber,
  AppText,
  CategoryTile,
  Divider,
  enterFade,
  SectionLabel,
  Sheet,
  StatBlock,
} from '../../../components/ui';
import { dayLabel, posterDate } from '../../../lib/dates';
import { formatCompact } from '../logic';
import type { DayVolume, SessionSummary } from '../hooks';

/**
 * Tap-to-reveal detail for the three Home stat tiles. Each tile becomes a
 * PressableScale (via CategoryTile) that opens a <Sheet> with a genuinely useful
 * breakdown — matching the bar set by StreakDetailSheet. All movement is either
 * the user-driven sheet itself or a quiet fade; passive content never slides,
 * and every count-up lands instantly under reduced motion.
 */

/** How tall the tallest volume bar draws. */
const BAR_TRACK = 84;
/** Cap the PR list so a heavy month can't grow the sheet past the screen. */
const PR_LIMIT = 8;

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  heroUnit: { marginBottom: 2 },
  caption: { marginTop: spacing.xs },
  section: { marginTop: spacing.xl },
  // Volume bar chart
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  barCell: { flex: 1, alignItems: 'center', gap: spacing.sm },
  barTrack: {
    width: 16,
    height: BAR_TRACK,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: { width: '100%', borderRadius: radius.full },
  statRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.xl,
  },
  statHalf: { flex: 1, minWidth: 0 },
  // List rows (sessions + PRs)
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
    paddingVertical: spacing.md,
  },
  rowMain: { flex: 1, minWidth: 0 },
  rowMeta: { flexShrink: 0, textAlign: 'right' },
  prIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { marginTop: spacing.lg, marginBottom: spacing.sm },
  more: { marginTop: spacing.sm },
});

/** Mounts at 0 then sweeps to `target` (instant under reduced motion). */
function useCountUp(target: number): number {
  const reduceMotion = useReducedMotion();
  const [value, setValue] = useState(reduceMotion ? target : 0);
  useEffect(() => {
    if (reduceMotion) {
      setValue(target);
      return;
    }
    const id = requestAnimationFrame(() => setValue(target));
    return () => cancelAnimationFrame(id);
  }, [target, reduceMotion]);
  return value;
}

/** Shared sheet hero: a big Oswald count-up with a unit + caption line. */
function DetailHero({
  value,
  unit,
  caption,
  decimals = 0,
  grouped = false,
  tint,
}: {
  value: number;
  unit: string;
  caption: string;
  decimals?: number;
  grouped?: boolean;
  tint?: string;
}) {
  const shown = useCountUp(value);
  return (
    <View>
      <View style={styles.hero}>
        <AnimatedNumber
          value={shown}
          decimals={decimals}
          grouped={grouped}
          variant="display"
          color={tint}
        />
        <AppText variant="label" style={styles.heroUnit}>
          {unit}
        </AppText>
      </View>
      <AppText variant="caption" color={colors.textDim} style={styles.caption}>
        {caption}
      </AppText>
    </View>
  );
}

/**
 * The Home stat tile: a colourful CategoryTile that opens `children` in a Sheet.
 * Mirrors the self-contained StreakChip pattern (owns its own open state).
 */
export function StatTile({
  title,
  value,
  unit,
  icon,
  color,
  deepColor,
  textColor,
  sheetTitle,
  children,
}: {
  title: string;
  value: string | number;
  unit?: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  color: string;
  deepColor: string;
  textColor?: string;
  sheetTitle: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <CategoryTile
        title={title}
        value={value}
        unit={unit}
        icon={icon}
        color={color}
        deepColor={deepColor}
        textColor={textColor}
        onPress={() => setOpen(true)}
      />
      <Sheet visible={open} onClose={() => setOpen(false)} title={sheetTitle}>
        {children}
      </Sheet>
    </>
  );
}

/** Volume-this-week breakdown: total, a per-day bar chart, sessions + top day. */
export function VolumeDetail({
  byDay,
  totalKg,
  sessionCount,
  unitPref,
}: {
  byDay: DayVolume[];
  totalKg: number;
  sessionCount: number;
  unitPref: UnitPref;
}) {
  const unit = unitLabel(unitPref);
  const maxKg = Math.max(1, ...byDay.map((d) => d.volumeKg));
  const topKg = byDay.reduce((m, d) => Math.max(m, d.volumeKg), 0);
  const today = byDay[byDay.length - 1]?.date;

  return (
    <View>
      <DetailHero
        value={displayWeight(totalKg, unitPref)}
        unit={`${unit} lifted`}
        caption="Total volume this week"
        grouped
      />

      <View style={styles.section}>
        <SectionLabel>By day</SectionLabel>
        <Animated.View entering={enterFade(0)} style={styles.bars}>
          {byDay.map((d) => {
            const h = d.volumeKg > 0 ? Math.max(6, (d.volumeKg / maxKg) * BAR_TRACK) : 0;
            const isToday = d.date === today;
            const displayKg = displayWeight(d.volumeKg, unitPref);
            return (
              <View
                key={d.date}
                style={styles.barCell}
                accessible
                accessibilityLabel={`${dayLabel(d.date)}${isToday ? ', today' : ''}: ${
                  d.volumeKg > 0 ? `${formatCompact(displayKg)} ${unit}` : 'rest day'
                }`}
              >
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { height: h, backgroundColor: isToday ? colors.accent : colors.accentDim },
                    ]}
                  />
                </View>
                <AppText variant="label" color={isToday ? colors.text : colors.textDim}>
                  {dayLabel(d.date).charAt(0)}
                </AppText>
              </View>
            );
          })}
        </Animated.View>
      </View>

      <View style={styles.statRow}>
        <StatBlock
          label="Sessions"
          value={sessionCount}
          unit={sessionCount === 1 ? 'session' : 'sessions'}
          style={styles.statHalf}
        />
        <StatBlock
          label="Top day"
          value={formatCompact(displayWeight(topKg, unitPref))}
          unit={unit}
          style={styles.statHalf}
        />
      </View>
    </View>
  );
}

/** Sessions-this-week breakdown: count, a week summary, and the session list. */
export function SessionsDetail({
  sessions,
  unitPref,
}: {
  sessions: SessionSummary[];
  unitPref: UnitPref;
}) {
  const unit = unitLabel(unitPref);
  const totalSets = sessions.reduce((sum, s) => sum + s.sets, 0);
  const totalKg = sessions.reduce((sum, s) => sum + s.volumeKg, 0);
  const caption =
    sessions.length === 0
      ? 'No sessions logged yet this week'
      : `${totalSets} sets · ${formatCompact(displayWeight(totalKg, unitPref))} ${unit} total`;

  return (
    <View>
      <DetailHero
        value={sessions.length}
        unit={sessions.length === 1 ? 'session' : 'sessions'}
        caption={caption}
      />

      {sessions.length === 0 ? (
        <AppText variant="body" color={colors.textDim} style={styles.empty}>
          Your week is a blank page — finish a workout and it lands here.
        </AppText>
      ) : (
        <View style={styles.section}>
          <SectionLabel>This week</SectionLabel>
          <Divider />
          {sessions.map((s) => (
            <View key={s.id}>
              <View style={styles.row}>
                <View style={styles.rowMain}>
                  <AppText variant="bodyBold" numberOfLines={1}>
                    {s.name}
                  </AppText>
                  <AppText variant="caption">{posterDate(s.date)}</AppText>
                </View>
                <AppText variant="caption" numberOfLines={1} style={styles.rowMeta}>
                  {formatCompact(displayWeight(s.volumeKg, unitPref))} {unit} · {s.sets} sets
                </AppText>
              </View>
              <Divider />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** Recent-PRs breakdown: 30-day count and the record list, newest first. */
export function PrDetail({ prs, unitPref }: { prs: PrRecord[]; unitPref: UnitPref }) {
  const unit = unitLabel(unitPref);
  const shown = prs.slice(0, PR_LIMIT);
  const extra = prs.length - shown.length;

  return (
    <View>
      <DetailHero
        value={prs.length}
        unit={prs.length === 1 ? 'PR' : 'PRs'}
        caption="Personal records in the last 30 days"
        tint={colors.orange}
      />

      {prs.length === 0 ? (
        <AppText variant="body" color={colors.textDim} style={styles.empty}>
          No PRs in the last 30 days — your next session is a chance to set one.
        </AppText>
      ) : (
        <View style={styles.section}>
          <SectionLabel>Newest first</SectionLabel>
          <Divider />
          {shown.map((pr, i) => (
            <View key={`${pr.exerciseId}-${pr.date}-${i}`}>
              <View style={styles.row}>
                <View style={styles.prIcon}>
                  <Ionicons name="trophy" size={18} color={colors.orange} />
                </View>
                <View style={styles.rowMain}>
                  <AppText variant="bodyBold" numberOfLines={1}>
                    {pr.exerciseName}
                  </AppText>
                  <AppText variant="caption">{posterDate(pr.date)}</AppText>
                </View>
                <AppText variant="bodyBold" numberOfLines={1} style={styles.rowMeta}>
                  {displayWeight(pr.weightKg, unitPref)} {unit} × {pr.reps}
                </AppText>
              </View>
              <Divider />
            </View>
          ))}
          {extra > 0 ? (
            <AppText variant="caption" color={colors.textDim} style={styles.more}>
              +{extra} more this month
            </AppText>
          ) : null}
        </View>
      )}
    </View>
  );
}
