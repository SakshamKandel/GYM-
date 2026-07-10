import { Share } from 'react-native';
import type {
  FoodLog,
  Measurement,
  SetLog,
  Streak,
  WeightLog,
  WorkoutLog,
} from '@gym/shared';
import { addDays, lastNDays, nowIso, todayIso } from './dates';
import { getRepo, type Repo } from './repo';

/**
 * Training-data export: everything the user logged in the last 12 months,
 * bundled into one schema-versioned JSON payload and handed to the OS share
 * sheet. No file-system writes — the share sheet receives the raw string.
 */

/** History window — keeps the payload sane for multi-year users. */
const EXPORT_DAYS = 365;

export interface WorkoutExport extends WorkoutLog {
  sets: SetLog[];
}

export interface TrainingExport {
  exportedAt: string;
  app: 'gym-tracker';
  version: 1;
  workouts: WorkoutExport[];
  weights: WeightLog[];
  measurements: Measurement[];
  foodLogs: FoodLog[];
  waterLogs: { date: string; ml: number }[];
  stepLogs: { date: string; steps: number }[];
  streak: Streak;
}

/** Pure builder — assembles the export payload from repo queries. */
export async function buildTrainingExport(repo: Repo, today: string): Promise<TrainingExport> {
  const from = addDays(today, -(EXPORT_DAYS - 1));
  const dates = lastNDays(EXPORT_DAYS, today);

  const [workoutLogs, weights, measurements, streak] = await Promise.all([
    repo.getWorkoutsBetween(from, today),
    repo.getWeights(EXPORT_DAYS),
    repo.getMeasurements(EXPORT_DAYS),
    repo.getStreak(),
  ]);

  const workouts: WorkoutExport[] = await Promise.all(
    workoutLogs.map(async (w) => ({ ...w, sets: await repo.getSetsForWorkout(w.id) })),
  );

  const foodByDate = await Promise.all(dates.map((d) => repo.getFoodLogs(d)));
  const foodLogs = foodByDate.flat();

  const waterByDate = await Promise.all(dates.map((d) => repo.getWaterMl(d)));
  const waterLogs = dates
    .map((date, i) => ({ date, ml: waterByDate[i] ?? 0 }))
    .filter((w) => w.ml > 0);

  const stepLogs = (await repo.getStepsBetween(from, today)).filter((s) => s.steps > 0);

  return {
    exportedAt: nowIso(),
    app: 'gym-tracker',
    version: 1,
    workouts,
    weights,
    measurements,
    foodLogs,
    waterLogs,
    stepLogs,
    streak,
  };
}

/**
 * Build the payload and open the OS share sheet.
 * Resolves true when the user actually shared, false when they dismissed.
 * Throws when the share sheet itself fails — callers show a friendly dialog.
 */
export async function shareTrainingData(): Promise<boolean> {
  const repo = await getRepo();
  const payload = await buildTrainingExport(repo, todayIso());
  const result = await Share.share(
    { title: 'Gym Tracker export', message: JSON.stringify(payload) },
    { dialogTitle: 'Gym Tracker export', subject: 'Gym Tracker export' },
  );
  return result.action === Share.sharedAction;
}
