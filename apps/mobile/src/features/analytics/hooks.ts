import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  consistencyStats,
  detectPlateau,
  hasEntitlement,
  kcalAdherence,
  proteinHitRate,
  pushPullRatio,
  weeklySetsPerMuscle,
  weeklyTonnage,
  weekStartIso,
  type ConsistencyStats,
  type KcalAdherence,
  type MuscleSets,
  type PlateauVerdict,
  type ProteinHitRate,
  type TaggedSet,
  type WeeklyTonnage,
} from '@gym/shared';
import { addDays, lastNDays, todayIso } from '../../lib/dates';
import { getExercise } from '../../lib/exercises';
import { getRepo } from '../../lib/repo';
import { useProfile } from '../../state/profile';
import {
  ANALYTICS_WEEKS,
  avgSessionMinutes,
  avgWaterMl,
  BIG4_LIFTS,
  NEGLECT_LOOKBACK_WEEKS,
  neglectedMuscles,
  NUTRITION_DAYS,
} from './logic';

/**
 * One focus-refreshing hook for the whole Progress dashboard (the useHomeData
 * pattern). Tier-locked slices stay null so locked sections can never leak
 * real-looking numbers into a teaser.
 */

export interface OverviewData {
  /** Dates of finished workouts inside the window (duplicates = extra sessions). */
  workoutDates: string[];
  consistency: ConsistencyStats;
  tonnage: WeeklyTonnage[];
  totalTonnageKg: number;
  avgSessionMin: number | null;
}

export interface MuscleBalanceData {
  /** This week's hard sets per muscle, highest first. */
  perMuscle: MuscleSets[];
  /** Push ÷ pull volume; null when there is no pull volume yet. */
  ratio: number | null;
  /** Trained in the prior 4 weeks, untouched so far this week. */
  neglected: string[];
}

export interface Big4Row {
  key: string;
  label: string;
  bestE1RmKg: number | null;
  verdict: PlateauVerdict;
}

export interface NutritionTrendData {
  /** Oldest → newest, one entry per day, zero-filled. */
  days: { date: string; kcal: number }[];
  kcal: KcalAdherence;
  protein: ProteinHitRate;
  avgWaterMl: number | null;
}

export interface AnalyticsData {
  overview: OverviewData;
  /** null while the tier keeps muscle balance locked. */
  muscle: MuscleBalanceData | null;
  big4: Big4Row[];
  /** null while the tier keeps nutrition trends locked. */
  nutrition: NutritionTrendData | null;
}

export function useAnalytics(): AnalyticsData | null {
  const tier = useProfile((s) => s.tier);
  const daysPerWeek = useProfile((s) => s.daysPerWeek);
  const targets = useProfile((s) => s.targets);
  const [data, setData] = useState<AnalyticsData | null>(null);

  const muscleUnlocked = hasEntitlement({ tier }, 'adaptive_progression');
  const nutritionUnlocked = hasEntitlement({ tier }, 'full_kcal_tracker');

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void (async () => {
        const repo = await getRepo();
        const today = todayIso();
        const currentWeekStart = weekStartIso(today);
        // First Monday of the 12-week window — also covers the 4-week
        // lookback the neglected-muscles callout needs.
        const windowStart = addDays(currentWeekStart, -7 * (ANALYTICS_WEEKS - 1));

        const [sets, workouts, e1rmHistories] = await Promise.all([
          repo.getSetsBetween(windowStart, today),
          repo.getWorkoutsBetween(windowStart, today),
          Promise.all(BIG4_LIFTS.map((l) => repo.getE1RmHistory(l.exerciseId, 30))),
        ]);

        const workoutDates = workouts.map((w) => w.date);
        const overview: OverviewData = {
          workoutDates,
          consistency: consistencyStats(workoutDates, ANALYTICS_WEEKS, today, daysPerWeek),
          tonnage: weeklyTonnage(sets, ANALYTICS_WEEKS, today),
          totalTonnageKg: Math.round(sets.reduce((sum, s) => sum + s.weightKg * s.reps, 0)),
          avgSessionMin: avgSessionMinutes(workouts),
        };

        let muscle: MuscleBalanceData | null = null;
        if (muscleUnlocked) {
          const tagged: TaggedSet[] = sets.map((s) => {
            const ex = getExercise(s.exerciseId);
            return {
              workoutDate: s.workoutDate,
              primaryMuscle: ex?.muscleGroup ?? '',
              secondaryMuscles: ex?.secondaryMuscles ?? [],
            };
          });
          const perMuscle = weeklySetsPerMuscle(tagged, currentWeekStart);
          muscle = {
            perMuscle,
            ratio: pushPullRatio(perMuscle),
            neglected: neglectedMuscles(tagged, currentWeekStart, NEGLECT_LOOKBACK_WEEKS),
          };
        }

        const big4: Big4Row[] = BIG4_LIFTS.map((lift, i) => {
          const history = e1rmHistories[i] ?? [];
          const best = history.reduce((m, h) => Math.max(m, h.e1rm), 0);
          return {
            key: lift.key,
            label: lift.label,
            bestE1RmKg: best > 0 ? best : null,
            verdict: detectPlateau(history.map((h) => ({ date: h.date, value: h.e1rm }))),
          };
        });

        let nutrition: NutritionTrendData | null = null;
        if (nutritionUnlocked) {
          const dates = lastNDays(NUTRITION_DAYS, today);
          const [byDate, waterMls] = await Promise.all([
            repo.getMacrosByDate(dates),
            Promise.all(dates.map((d) => repo.getWaterMl(d))),
          ]);
          nutrition = {
            days: dates.map((date) => ({ date, kcal: byDate[date]?.kcal ?? 0 })),
            kcal: kcalAdherence(byDate, targets.kcal),
            protein: proteinHitRate(byDate, targets.protein),
            avgWaterMl: avgWaterMl(waterMls),
          };
        }

        if (!mounted) return;
        setData({ overview, muscle, big4, nutrition });
      })();
      return () => {
        mounted = false;
      };
    }, [daysPerWeek, muscleUnlocked, nutritionUnlocked, targets.kcal, targets.protein]),
  );

  return data;
}
