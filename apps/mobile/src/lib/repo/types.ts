import type {
  DailyMacros,
  FoodItem,
  FoodLog,
  Measurement,
  PrRecord,
  SetLog,
  Streak,
  WeightLog,
  WorkoutLog,
} from '@gym/shared';

/** One set with its workout's date attached — the analytics query shape. */
export interface AnalyticsSet {
  exerciseId: string;
  exerciseName: string;
  weightKg: number;
  reps: number;
  rpe: number | null;
  isPr: boolean;
  /** Date (yyyy-mm-dd) of the workout the set belongs to. */
  workoutDate: string;
}

/**
 * Local persistence contract. All feature code talks to THIS interface —
 * native uses SQLite, web QA uses the AsyncStorage-backed memory impl.
 * Everything is async and must resolve fast (<100ms perceived).
 */
export interface Repo {
  // ── Workouts ────────────────────────────────────────────────
  startWorkout(w: Omit<WorkoutLog, 'finishedAt' | 'durationSec'>): Promise<void>;
  finishWorkout(id: string, finishedAt: string, durationSec: number): Promise<void>;
  /** Delete a workout and its sets (e.g. discarded empty session). */
  deleteWorkout(id: string): Promise<void>;
  getWorkout(id: string): Promise<WorkoutLog | null>;
  getActiveWorkout(): Promise<WorkoutLog | null>;
  getWorkoutsBetween(fromDate: string, toDate: string): Promise<WorkoutLog[]>;
  getRecentWorkouts(limit: number): Promise<WorkoutLog[]>;

  // ── Sets ────────────────────────────────────────────────────
  logSet(s: SetLog): Promise<void>;
  updateSet(s: SetLog): Promise<void>;
  deleteSet(id: string): Promise<void>;
  getSetsForWorkout(workoutLogId: string): Promise<SetLog[]>;
  /** Sets from the most recent workout (before `excludeWorkoutId`) that included this exercise. */
  getLastSetsForExercise(exerciseId: string, excludeWorkoutId: string): Promise<SetLog[]>;
  /** Best-ever estimated 1RM for the exercise, excluding a given workout. */
  getBestE1Rm(exerciseId: string, excludeWorkoutId: string): Promise<number | null>;
  /** Heaviest weight ever lifted for the exercise, excluding a given workout. */
  getBestWeight(exerciseId: string, excludeWorkoutId: string): Promise<number | null>;
  getPrRecords(limit: number): Promise<PrRecord[]>;
  /** Total volume (kg × reps) for workouts within a date range. */
  getVolumeBetween(fromDate: string, toDate: string): Promise<number>;
  /** e1RM history (best per workout) for one exercise, oldest first. */
  getE1RmHistory(exerciseId: string, limit: number): Promise<{ date: string; e1rm: number }[]>;
  /** Exercise ids the user has logged, most recently used first. */
  getRecentExerciseIds(limit: number): Promise<string[]>;
  /** Sets from FINISHED workouts whose workout date is within [fromDate, toDate], oldest first. */
  getSetsBetween(fromDate: string, toDate: string): Promise<AnalyticsSet[]>;

  // ── Sync (one-way server backup) ────────────────────────────
  /** Finished workouts not yet backed up to the server (with their sets), oldest first. */
  getUnsyncedFinishedWorkouts(limit: number): Promise<{ workout: WorkoutLog; sets: SetLog[] }[]>;
  /** Stamp workouts synced — call ONLY after the server confirmed the batch. */
  markWorkoutsSynced(ids: string[], syncedAt: string): Promise<void>;

  // ── Body ────────────────────────────────────────────────────
  upsertWeight(w: WeightLog): Promise<void>;
  getWeights(limitDays: number): Promise<WeightLog[]>;
  addMeasurement(m: Measurement): Promise<void>;
  getMeasurements(limit: number): Promise<Measurement[]>;

  // ── Food ────────────────────────────────────────────────────
  logFood(f: FoodLog): Promise<void>;
  deleteFoodLog(id: string): Promise<void>;
  getFoodLogs(date: string): Promise<FoodLog[]>;
  /** kcal totals for each of the given dates (missing dates → 0). */
  getKcalByDate(dates: string[]): Promise<Record<string, number>>;
  /** Macro totals for each of the given dates (missing dates → all zeros). */
  getMacrosByDate(dates: string[]): Promise<Record<string, DailyMacros>>;
  saveFood(item: FoodItem): Promise<void>;
  getFoodByBarcode(barcode: string): Promise<FoodItem | null>;
  getFood(id: string): Promise<FoodItem | null>;
  searchLocalFoods(query: string, limit: number): Promise<FoodItem[]>;
  /** Most recently logged distinct foods. */
  getRecentFoods(limit: number): Promise<FoodItem[]>;

  // ── Water ───────────────────────────────────────────────────
  getWaterMl(date: string): Promise<number>;
  addWater(date: string, deltaMl: number): Promise<number>;

  // ── Steps ───────────────────────────────────────────────────
  /** Step count for a date (yyyy-mm-dd); 0 when nothing logged. */
  getSteps(date: string): Promise<number>;
  /** Absolute overwrite of a day's steps (iOS full-day pedometer query). */
  setSteps(date: string, steps: number): Promise<void>;
  /** Increment a day's steps (Android watch deltas, manual adds); returns the new total. */
  addSteps(date: string, delta: number): Promise<number>;
  /** Logged days within [startDate, endDate], ascending by date; missing days omitted. */
  getStepsBetween(startDate: string, endDate: string): Promise<{ date: string; steps: number }[]>;

  // ── Streak ──────────────────────────────────────────────────
  getStreak(): Promise<Streak>;
  setStreak(s: Streak): Promise<void>;
}
