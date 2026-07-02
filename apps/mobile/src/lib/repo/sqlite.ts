import * as SQLite from 'expo-sqlite';
import { epley1Rm } from '@gym/shared';
import type {
  FoodItem,
  FoodLog,
  Measurement,
  PrRecord,
  SetLog,
  Streak,
  WeightLog,
  WorkoutLog,
} from '@gym/shared';
import type { Repo } from './types';

/** Offline-first native store (CLAUDE.md rule 5): every write lands here first. */

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS workout_logs (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, plan_workout_id TEXT,
  name TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, duration_sec INTEGER
);
CREATE TABLE IF NOT EXISTS set_logs (
  id TEXT PRIMARY KEY, workout_log_id TEXT NOT NULL, exercise_id TEXT NOT NULL,
  exercise_name TEXT NOT NULL, set_no INTEGER NOT NULL, weight_kg REAL NOT NULL,
  reps INTEGER NOT NULL, rpe REAL, is_pr INTEGER NOT NULL DEFAULT 0, logged_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sets_workout ON set_logs(workout_log_id);
CREATE INDEX IF NOT EXISTS idx_sets_exercise ON set_logs(exercise_id, logged_at);
CREATE TABLE IF NOT EXISTS weight_logs (
  id TEXT PRIMARY KEY, date TEXT NOT NULL UNIQUE, kg REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS measurements (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, waist_cm REAL, chest_cm REAL,
  arm_cm REAL, hip_cm REAL, thigh_cm REAL
);
CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, brand TEXT, source TEXT NOT NULL,
  barcode TEXT, kcal_per_100 REAL NOT NULL, protein_per_100 REAL NOT NULL,
  carbs_per_100 REAL NOT NULL, fat_per_100 REAL NOT NULL,
  serving_grams REAL, serving_label TEXT
);
CREATE INDEX IF NOT EXISTS idx_foods_barcode ON foods(barcode);
CREATE TABLE IF NOT EXISTS food_logs (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, meal TEXT NOT NULL, food_id TEXT NOT NULL,
  food_name TEXT NOT NULL, grams REAL NOT NULL, kcal REAL NOT NULL,
  protein REAL NOT NULL, carbs REAL NOT NULL, fat REAL NOT NULL, logged_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_food_logs_date ON food_logs(date);
CREATE TABLE IF NOT EXISTS water_logs (date TEXT PRIMARY KEY, ml INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS streaks (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current INTEGER NOT NULL DEFAULT 0, best INTEGER NOT NULL DEFAULT 0, last_workout_date TEXT
);
INSERT OR IGNORE INTO streaks (id, current, best, last_workout_date) VALUES (1, 0, 0, NULL);
`;

interface WorkoutRow {
  id: string;
  date: string;
  plan_workout_id: string | null;
  name: string;
  started_at: string;
  finished_at: string | null;
  duration_sec: number | null;
}

interface SetRow {
  id: string;
  workout_log_id: string;
  exercise_id: string;
  exercise_name: string;
  set_no: number;
  weight_kg: number;
  reps: number;
  rpe: number | null;
  is_pr: number;
  logged_at: string;
}

interface FoodRow {
  id: string;
  name: string;
  brand: string | null;
  source: string;
  barcode: string | null;
  kcal_per_100: number;
  protein_per_100: number;
  carbs_per_100: number;
  fat_per_100: number;
  serving_grams: number | null;
  serving_label: string | null;
}

interface FoodLogRow {
  id: string;
  date: string;
  meal: string;
  food_id: string;
  food_name: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  logged_at: string;
}

function toWorkout(r: WorkoutRow): WorkoutLog {
  return {
    id: r.id,
    date: r.date,
    planWorkoutId: r.plan_workout_id,
    name: r.name,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationSec: r.duration_sec,
  };
}

function toSet(r: SetRow): SetLog {
  return {
    id: r.id,
    workoutLogId: r.workout_log_id,
    exerciseId: r.exercise_id,
    exerciseName: r.exercise_name,
    setNo: r.set_no,
    weightKg: r.weight_kg,
    reps: r.reps,
    rpe: r.rpe,
    isPr: r.is_pr === 1,
    loggedAt: r.logged_at,
  };
}

function toFood(r: FoodRow): FoodItem {
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    source: r.source as FoodItem['source'],
    barcode: r.barcode,
    kcalPer100: r.kcal_per_100,
    proteinPer100: r.protein_per_100,
    carbsPer100: r.carbs_per_100,
    fatPer100: r.fat_per_100,
    servingGrams: r.serving_grams,
    servingLabel: r.serving_label,
  };
}

function toFoodLog(r: FoodLogRow): FoodLog {
  return {
    id: r.id,
    date: r.date,
    meal: r.meal as FoodLog['meal'],
    foodId: r.food_id,
    foodName: r.food_name,
    grams: r.grams,
    kcal: r.kcal,
    protein: r.protein,
    carbs: r.carbs,
    fat: r.fat,
  };
}

export async function createSqliteRepo(): Promise<Repo> {
  const db = await SQLite.openDatabaseAsync('gym-tracker.db');
  await db.execAsync(SCHEMA);

  return {
    // ── Workouts ────────────────────────────────────────────
    async startWorkout(w) {
      await db.runAsync(
        'INSERT INTO workout_logs (id, date, plan_workout_id, name, started_at) VALUES (?,?,?,?,?)',
        w.id, w.date, w.planWorkoutId, w.name, w.startedAt,
      );
    },
    async finishWorkout(id, finishedAt, durationSec) {
      await db.runAsync(
        'UPDATE workout_logs SET finished_at = ?, duration_sec = ? WHERE id = ?',
        finishedAt, durationSec, id,
      );
    },
    async deleteWorkout(id) {
      await db.runAsync('DELETE FROM set_logs WHERE workout_log_id = ?', id);
      await db.runAsync('DELETE FROM workout_logs WHERE id = ?', id);
    },
    async getWorkout(id) {
      const r = await db.getFirstAsync<WorkoutRow>('SELECT * FROM workout_logs WHERE id = ?', id);
      return r ? toWorkout(r) : null;
    },
    async getActiveWorkout() {
      const r = await db.getFirstAsync<WorkoutRow>(
        'SELECT * FROM workout_logs WHERE finished_at IS NULL ORDER BY started_at DESC LIMIT 1',
      );
      return r ? toWorkout(r) : null;
    },
    async getWorkoutsBetween(fromDate, toDate) {
      const rows = await db.getAllAsync<WorkoutRow>(
        'SELECT * FROM workout_logs WHERE date >= ? AND date <= ? AND finished_at IS NOT NULL ORDER BY started_at DESC',
        fromDate, toDate,
      );
      return rows.map(toWorkout);
    },
    async getRecentWorkouts(limit) {
      const rows = await db.getAllAsync<WorkoutRow>(
        'SELECT * FROM workout_logs WHERE finished_at IS NOT NULL ORDER BY started_at DESC LIMIT ?',
        limit,
      );
      return rows.map(toWorkout);
    },

    // ── Sets ────────────────────────────────────────────────
    async logSet(s) {
      await db.runAsync(
        'INSERT INTO set_logs (id, workout_log_id, exercise_id, exercise_name, set_no, weight_kg, reps, rpe, is_pr, logged_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        s.id, s.workoutLogId, s.exerciseId, s.exerciseName, s.setNo,
        s.weightKg, s.reps, s.rpe, s.isPr ? 1 : 0, s.loggedAt,
      );
    },
    async updateSet(s) {
      await db.runAsync(
        'UPDATE set_logs SET weight_kg = ?, reps = ?, rpe = ?, is_pr = ? WHERE id = ?',
        s.weightKg, s.reps, s.rpe, s.isPr ? 1 : 0, s.id,
      );
    },
    async deleteSet(id) {
      await db.runAsync('DELETE FROM set_logs WHERE id = ?', id);
    },
    async getSetsForWorkout(workoutLogId) {
      const rows = await db.getAllAsync<SetRow>(
        'SELECT * FROM set_logs WHERE workout_log_id = ? ORDER BY logged_at ASC',
        workoutLogId,
      );
      return rows.map(toSet);
    },
    async getLastSetsForExercise(exerciseId, excludeWorkoutId) {
      const last = await db.getFirstAsync<{ workout_log_id: string }>(
        `SELECT s.workout_log_id FROM set_logs s
         JOIN workout_logs w ON w.id = s.workout_log_id
         WHERE s.exercise_id = ? AND s.workout_log_id != ? AND w.finished_at IS NOT NULL
         ORDER BY s.logged_at DESC LIMIT 1`,
        exerciseId, excludeWorkoutId,
      );
      if (!last) return [];
      const rows = await db.getAllAsync<SetRow>(
        'SELECT * FROM set_logs WHERE workout_log_id = ? AND exercise_id = ? ORDER BY set_no ASC',
        last.workout_log_id, exerciseId,
      );
      return rows.map(toSet);
    },
    async getBestE1Rm(exerciseId, excludeWorkoutId) {
      const rows = await db.getAllAsync<{ weight_kg: number; reps: number }>(
        'SELECT weight_kg, reps FROM set_logs WHERE exercise_id = ? AND workout_log_id != ? AND reps <= 12',
        exerciseId, excludeWorkoutId,
      );
      if (rows.length === 0) return null;
      return Math.max(...rows.map((r) => epley1Rm(r.weight_kg, r.reps)));
    },
    async getBestWeight(exerciseId, excludeWorkoutId) {
      const r = await db.getFirstAsync<{ m: number | null }>(
        'SELECT MAX(weight_kg) as m FROM set_logs WHERE exercise_id = ? AND workout_log_id != ?',
        exerciseId, excludeWorkoutId,
      );
      return r?.m ?? null;
    },
    async getPrRecords(limit) {
      const rows = await db.getAllAsync<SetRow & { date: string }>(
        `SELECT s.*, w.date as date FROM set_logs s
         JOIN workout_logs w ON w.id = s.workout_log_id
         WHERE s.is_pr = 1 ORDER BY s.logged_at DESC LIMIT ?`,
        limit,
      );
      return rows.map(
        (r): PrRecord => ({
          exerciseId: r.exercise_id,
          exerciseName: r.exercise_name,
          weightKg: r.weight_kg,
          reps: r.reps,
          e1rm: epley1Rm(r.weight_kg, r.reps),
          date: r.date,
        }),
      );
    },
    async getVolumeBetween(fromDate, toDate) {
      const r = await db.getFirstAsync<{ v: number | null }>(
        `SELECT SUM(s.weight_kg * s.reps) as v FROM set_logs s
         JOIN workout_logs w ON w.id = s.workout_log_id
         WHERE w.date >= ? AND w.date <= ?`,
        fromDate, toDate,
      );
      return Math.round(r?.v ?? 0);
    },
    async getE1RmHistory(exerciseId, limit) {
      const rows = await db.getAllAsync<{ date: string; weight_kg: number; reps: number }>(
        `SELECT w.date as date, s.weight_kg, s.reps FROM set_logs s
         JOIN workout_logs w ON w.id = s.workout_log_id
         WHERE s.exercise_id = ? AND s.reps <= 12 AND w.finished_at IS NOT NULL`,
        exerciseId,
      );
      const bestByDate = new Map<string, number>();
      for (const r of rows) {
        const e = epley1Rm(r.weight_kg, r.reps);
        const prev = bestByDate.get(r.date) ?? 0;
        if (e > prev) bestByDate.set(r.date, e);
      }
      return [...bestByDate.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-limit)
        .map(([date, e1rm]) => ({ date, e1rm }));
    },
    async getRecentExerciseIds(limit) {
      const rows = await db.getAllAsync<{ exercise_id: string }>(
        `SELECT exercise_id, MAX(logged_at) as last FROM set_logs
         GROUP BY exercise_id ORDER BY last DESC LIMIT ?`,
        limit,
      );
      return rows.map((r) => r.exercise_id);
    },

    // ── Body ────────────────────────────────────────────────
    async upsertWeight(w) {
      await db.runAsync(
        `INSERT INTO weight_logs (id, date, kg) VALUES (?,?,?)
         ON CONFLICT(date) DO UPDATE SET kg = excluded.kg`,
        w.id, w.date, w.kg,
      );
    },
    async getWeights(limitDays) {
      const rows = await db.getAllAsync<{ id: string; date: string; kg: number }>(
        'SELECT * FROM weight_logs ORDER BY date DESC LIMIT ?',
        limitDays,
      );
      return rows.reverse().map((r): WeightLog => ({ id: r.id, date: r.date, kg: r.kg }));
    },
    async addMeasurement(m) {
      await db.runAsync(
        'INSERT INTO measurements (id, date, waist_cm, chest_cm, arm_cm, hip_cm, thigh_cm) VALUES (?,?,?,?,?,?,?)',
        m.id, m.date, m.waistCm, m.chestCm, m.armCm, m.hipCm, m.thighCm,
      );
    },
    async getMeasurements(limit) {
      const rows = await db.getAllAsync<{
        id: string; date: string; waist_cm: number | null; chest_cm: number | null;
        arm_cm: number | null; hip_cm: number | null; thigh_cm: number | null;
      }>('SELECT * FROM measurements ORDER BY date DESC LIMIT ?', limit);
      return rows.map(
        (r): Measurement => ({
          id: r.id,
          date: r.date,
          waistCm: r.waist_cm,
          chestCm: r.chest_cm,
          armCm: r.arm_cm,
          hipCm: r.hip_cm,
          thighCm: r.thigh_cm,
        }),
      );
    },

    // ── Food ────────────────────────────────────────────────
    async logFood(f) {
      await db.runAsync(
        'INSERT INTO food_logs (id, date, meal, food_id, food_name, grams, kcal, protein, carbs, fat, logged_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        f.id, f.date, f.meal, f.foodId, f.foodName, f.grams,
        f.kcal, f.protein, f.carbs, f.fat, new Date().toISOString(),
      );
    },
    async deleteFoodLog(id) {
      await db.runAsync('DELETE FROM food_logs WHERE id = ?', id);
    },
    async getFoodLogs(date) {
      const rows = await db.getAllAsync<FoodLogRow>(
        'SELECT * FROM food_logs WHERE date = ? ORDER BY logged_at ASC',
        date,
      );
      return rows.map(toFoodLog);
    },
    async getKcalByDate(dates) {
      const out: Record<string, number> = {};
      for (const d of dates) out[d] = 0;
      if (dates.length === 0) return out;
      const placeholders = dates.map(() => '?').join(',');
      const rows = await db.getAllAsync<{ date: string; k: number }>(
        `SELECT date, SUM(kcal) as k FROM food_logs WHERE date IN (${placeholders}) GROUP BY date`,
        ...dates,
      );
      for (const r of rows) out[r.date] = Math.round(r.k);
      return out;
    },
    async saveFood(item) {
      await db.runAsync(
        `INSERT INTO foods (id, name, brand, source, barcode, kcal_per_100, protein_per_100, carbs_per_100, fat_per_100, serving_grams, serving_label)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, brand=excluded.brand,
           kcal_per_100=excluded.kcal_per_100, protein_per_100=excluded.protein_per_100,
           carbs_per_100=excluded.carbs_per_100, fat_per_100=excluded.fat_per_100,
           serving_grams=excluded.serving_grams, serving_label=excluded.serving_label`,
        item.id, item.name, item.brand, item.source, item.barcode,
        item.kcalPer100, item.proteinPer100, item.carbsPer100, item.fatPer100,
        item.servingGrams, item.servingLabel,
      );
    },
    async getFoodByBarcode(barcode) {
      const r = await db.getFirstAsync<FoodRow>('SELECT * FROM foods WHERE barcode = ?', barcode);
      return r ? toFood(r) : null;
    },
    async getFood(id) {
      const r = await db.getFirstAsync<FoodRow>('SELECT * FROM foods WHERE id = ?', id);
      return r ? toFood(r) : null;
    },
    async searchLocalFoods(query, limit) {
      const rows = await db.getAllAsync<FoodRow>(
        'SELECT * FROM foods WHERE name LIKE ? ORDER BY name LIMIT ?',
        `%${query}%`, limit,
      );
      return rows.map(toFood);
    },
    async getRecentFoods(limit) {
      const rows = await db.getAllAsync<FoodRow>(
        `SELECT f.* FROM foods f
         JOIN (SELECT food_id, MAX(logged_at) as last FROM food_logs GROUP BY food_id) fl
           ON fl.food_id = f.id
         ORDER BY fl.last DESC LIMIT ?`,
        limit,
      );
      return rows.map(toFood);
    },

    // ── Water ───────────────────────────────────────────────
    async getWaterMl(date) {
      const r = await db.getFirstAsync<{ ml: number }>(
        'SELECT ml FROM water_logs WHERE date = ?', date,
      );
      return r?.ml ?? 0;
    },
    async addWater(date, deltaMl) {
      await db.runAsync(
        `INSERT INTO water_logs (date, ml) VALUES (?, MAX(0, ?))
         ON CONFLICT(date) DO UPDATE SET ml = MAX(0, water_logs.ml + ?)`,
        date, deltaMl, deltaMl,
      );
      const r = await db.getFirstAsync<{ ml: number }>(
        'SELECT ml FROM water_logs WHERE date = ?', date,
      );
      return r?.ml ?? 0;
    },

    // ── Streak ──────────────────────────────────────────────
    async getStreak() {
      const r = await db.getFirstAsync<{
        current: number; best: number; last_workout_date: string | null;
      }>('SELECT current, best, last_workout_date FROM streaks WHERE id = 1');
      return {
        current: r?.current ?? 0,
        best: r?.best ?? 0,
        lastWorkoutDate: r?.last_workout_date ?? null,
      } satisfies Streak;
    },
    async setStreak(s) {
      await db.runAsync(
        'UPDATE streaks SET current = ?, best = ?, last_workout_date = ? WHERE id = 1',
        s.current, s.best, s.lastWorkoutDate,
      );
    },
  };
}
