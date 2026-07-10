import { useCallback, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  activityCaloriesOut,
  bmr,
  netKcal as netKcalOf,
  restingKcal as restingKcalOf,
  stepsGoal as stepsGoalOf,
  stepsKcal as stepsKcalOf,
  stepsToKm,
  workoutKcal as workoutKcalOf,
} from '@gym/shared';
import { addDays, lastNDays, todayIso } from '../../lib/dates';
import { getRepo } from '../../lib/repo';
import { useProfile } from '../../state/profile';
import {
  getStepPermission,
  getStepsSource,
  isPedometerAvailable,
  requestHealthConnectPermission as requestHcPermission,
  subscribeSteps,
  syncStepsNow,
  type StepPermission,
  type StepsSource,
} from './pedometer';

/** Everything the Activity home section + its sheets need for today. */
export interface ActivityToday {
  loaded: boolean;
  steps: number;
  stepsGoal: number;
  distanceKm: number;
  /** Active kcal burned walking (net of resting). */
  stepsKcal: number;
  /** Kcal burned in today's finished workouts. */
  workoutKcal: number;
  /** Full-day resting (basal) burn; 0 until the profile has sex/weight/height/age. */
  restingKcal: number;
  /** resting + steps + workouts. */
  caloriesOut: number;
  eatenKcal: number;
  /** eaten − out (negative = deficit, deliberately unclamped). */
  netKcal: number;
  kcalTarget: number;
  /**
   * Device can count steps automatically (step sensor OR active Health
   * Connect; false on web → manual logging only).
   */
  supported: boolean;
  /**
   * Sensor permission state. Reported as 'granted' whenever Health Connect is
   * the active source — steps are flowing, so no "enable tracking" CTA applies.
   */
  permission: StepPermission;
  /**
   * Where today's automatic steps come from:
   * 'health-connect' (Android dev build, authoritative full-day aggregate that
   * also covers app-closed time) · 'sensor' (CoreMotion / expo-sensors) ·
   * 'manual-only'. Manual adds are only overwritten when the source is
   * 'health-connect' (HC already counted those steps).
   */
  stepsSource: StepsSource;
  /**
   * Show Health Connect's read-Steps permission screen (Android dev builds
   * only). Resolves true on grant (state refreshes automatically); false on
   * iOS, Expo Go, HC missing, or denial. Wire to the UI's permission CTA.
   */
  requestHealthConnectPermission: () => Promise<boolean>;
  refresh: () => Promise<void>;
  addManualSteps: (n: number) => Promise<void>;
}

/** Raw async state — derived kcal math happens in the memo below. */
interface Snapshot {
  steps: number;
  eatenKcal: number;
  workoutSec: number;
  /** Most recent weigh-in; null when the user never logged one. */
  latestWeightKg: number | null;
  supported: boolean;
  permission: StepPermission;
  source: StepsSource;
}

export function useActivityToday(): ActivityToday {
  const sex = useProfile((s) => s.sex);
  const heightCm = useProfile((s) => s.heightCm);
  const weightKg = useProfile((s) => s.startWeightKg);
  const birthYear = useProfile((s) => s.birthYear);
  const activityLevel = useProfile((s) => s.activityLevel);
  const targets = useProfile((s) => s.targets);

  const [snap, setSnap] = useState<Snapshot | null>(null);

  const load = useCallback(async (): Promise<Snapshot> => {
    const repo = await getRepo();
    const today = todayIso();
    const [steps, kcalByDate, todaysWorkouts, weights, sensorSupported, sensorPermission, source] =
      await Promise.all([
        repo.getSteps(today),
        repo.getKcalByDate([today]),
        repo.getWorkoutsBetween(today, today),
        repo.getWeights(1),
        isPedometerAvailable(),
        getStepPermission(),
        getStepsSource(),
      ]);
    const workoutSec = todaysWorkouts
      .filter((w) => w.finishedAt !== null)
      .reduce((sum, w) => sum + (w.durationSec ?? 0), 0);
    const hcActive = source === 'health-connect';
    return {
      steps,
      eatenKcal: Math.round(kcalByDate[today] ?? 0),
      workoutSec,
      latestWeightKg: weights[weights.length - 1]?.kg ?? null,
      // HC can be active on devices whose raw sensor is unusable, and it
      // supersedes the sensor permission — steps flow either way, so the
      // "enable step tracking" CTA must not show while HC is the source.
      supported: sensorSupported || hcActive,
      permission: hcActive ? 'granted' : sensorPermission,
      source,
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const run = () => {
        void load().then((next) => {
          if (active) setSnap(next);
        });
      };
      // Sensor truth first (fast no-op when unsupported), then the repo read.
      void syncStepsNow().finally(run);

      // useFocusEffect fires on NAVIGATION focus only — it does not re-run when
      // the app returns from the OS background while Home is already focused.
      const appState = AppState.addEventListener('change', (state) => {
        if (state === 'active') void syncStepsNow().finally(run);
      });

      // Live pedometer merge: persisted totals stream in (~2s cadence while
      // walking) without waiting for the next focus refetch.
      const unsubscribe = subscribeSteps((date, total) => {
        if (!active || date !== todayIso()) return;
        setSnap((s) => (s === null ? s : { ...s, steps: total }));
      });

      return () => {
        active = false;
        appState.remove();
        unsubscribe();
      };
    }, [load]),
  );

  const refresh = useCallback(async () => {
    await syncStepsNow();
    setSnap(await load());
  }, [load]);

  const addManualSteps = useCallback(async (n: number) => {
    if (!Number.isFinite(n) || n <= 0) return;
    const repo = await getRepo();
    const total = await repo.addSteps(todayIso(), Math.round(n));
    setSnap((s) => (s === null ? s : { ...s, steps: total }));
  }, []);

  const requestHealthConnectPermission = useCallback(async () => {
    const granted = await requestHcPermission();
    // On grant the service already ran an authoritative read; reload so
    // supported/permission/stepsSource/steps all reflect the new source.
    if (granted) setSnap(await load());
    return granted;
  }, [load]);

  return useMemo(() => {
    const steps = snap?.steps ?? 0;
    const eatenKcal = snap?.eatenKcal ?? 0;
    const workoutSec = snap?.workoutSec ?? 0;

    const age = birthYear !== null ? Math.max(0, Number(todayIso().slice(0, 4)) - birthYear) : null;
    // Burn estimates track the latest weigh-in; the onboarding weight only
    // seeds users who never logged one (it goes stale as weight changes).
    const currentWeightKg = snap?.latestWeightKg ?? weightKg;
    // restingKcal's contract is male/female; bmr's midpoint handles 'other'.
    // Missing profile data → 0 (out is then just steps + workouts).
    const restingKcal =
      sex !== null && currentWeightKg !== null && heightCm !== null && age !== null
        ? sex === 'other'
          ? Math.max(0, bmr('other', currentWeightKg, heightCm, age))
          : restingKcalOf({ sex, weightKg: currentWeightKg, heightCm, age })
        : 0;
    const stepsKcal = stepsKcalOf(steps, currentWeightKg ?? 0, heightCm ?? 0);
    const workoutKcal = workoutKcalOf(workoutSec, currentWeightKg ?? 0);
    const caloriesOut = activityCaloriesOut({ resting: restingKcal, stepsKcal, workoutKcal });

    return {
      loaded: snap !== null,
      steps,
      stepsGoal: targets.steps > 0 ? targets.steps : stepsGoalOf(activityLevel ?? ''),
      distanceKm: stepsToKm(steps, heightCm ?? 0),
      stepsKcal,
      workoutKcal,
      restingKcal,
      caloriesOut,
      eatenKcal,
      netKcal: netKcalOf(eatenKcal, caloriesOut),
      kcalTarget: targets.kcal,
      supported: snap?.supported ?? false,
      permission: snap?.permission ?? 'undetermined',
      stepsSource: snap?.source ?? 'manual-only',
      requestHealthConnectPermission,
      refresh,
      addManualSteps,
    };
  }, [
    snap,
    sex,
    heightCm,
    weightKg,
    birthYear,
    activityLevel,
    targets,
    refresh,
    addManualSteps,
    requestHealthConnectPermission,
  ]);
}

/** One day of the trailing-week chart (zero-padded, today inclusive). */
export interface DaySteps {
  date: string;
  steps: number;
}

/** Last 7 days of stored steps, oldest → today; null while loading. */
export function useStepsWeek(): DaySteps[] | null {
  const [week, setWeek] = useState<DaySteps[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        const repo = await getRepo();
        const today = todayIso();
        const logged = await repo.getStepsBetween(addDays(today, -6), today);
        const byDate = new Map(logged.map((d) => [d.date, d.steps]));
        const days = lastNDays(7).map((date) => ({ date, steps: byDate.get(date) ?? 0 }));
        if (active) setWeek(days);
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  return week;
}
