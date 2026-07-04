import AsyncStorage from '@react-native-async-storage/async-storage';
import { epley1Rm } from '@gym/shared';
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
import type { AnalyticsSet, Repo } from './types';

/**
 * Web/QA implementation — same contract as SQLite, backed by an in-memory
 * store persisted to AsyncStorage (localStorage on web) as one JSON blob.
 * expo-sqlite's web support is alpha; this keeps browser QA rock-solid.
 */

interface MemoryState {
  workouts: WorkoutLog[];
  sets: (SetLog & { date?: string })[];
  weights: WeightLog[];
  measurements: Measurement[];
  foods: FoodItem[];
  foodLogs: (FoodLog & { loggedAt: string })[];
  water: Record<string, number>;
  streak: Streak;
}

const KEY = 'gym-tracker-db-v1';

function emptyState(): MemoryState {
  return {
    workouts: [],
    sets: [],
    weights: [],
    measurements: [],
    foods: [],
    foodLogs: [],
    water: {},
    streak: { current: 0, best: 0, lastWorkoutDate: null },
  };
}

export async function createMemoryRepo(): Promise<Repo> {
  let state = emptyState();
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) state = { ...emptyState(), ...(JSON.parse(raw) as MemoryState) };
  } catch {
    // corrupted store → start fresh rather than brick the app
  }

  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  function persist(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      void AsyncStorage.setItem(KEY, JSON.stringify(state));
    }, 150);
  }

  function workoutDate(workoutLogId: string): string {
    return state.workouts.find((w) => w.id === workoutLogId)?.date ?? '';
  }

  function finishedWorkoutIds(): Set<string> {
    return new Set(state.workouts.filter((w) => w.finishedAt !== null).map((w) => w.id));
  }

  return {
    // ── Workouts ────────────────────────────────────────────
    async startWorkout(w) {
      state.workouts.push({ ...w, finishedAt: null, durationSec: null });
      persist();
    },
    async finishWorkout(id, finishedAt, durationSec) {
      const w = state.workouts.find((x) => x.id === id);
      if (w) {
        w.finishedAt = finishedAt;
        w.durationSec = durationSec;
      }
      persist();
    },
    async deleteWorkout(id) {
      state.workouts = state.workouts.filter((w) => w.id !== id);
      state.sets = state.sets.filter((s) => s.workoutLogId !== id);
      persist();
    },
    async getWorkout(id) {
      return state.workouts.find((w) => w.id === id) ?? null;
    },
    async getActiveWorkout() {
      const active = state.workouts.filter((w) => w.finishedAt === null);
      return active.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
    },
    async getWorkoutsBetween(fromDate, toDate) {
      return state.workouts
        .filter((w) => w.date >= fromDate && w.date <= toDate && w.finishedAt !== null)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },
    async getRecentWorkouts(limit) {
      return state.workouts
        .filter((w) => w.finishedAt !== null)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit);
    },

    // ── Sets ────────────────────────────────────────────────
    async logSet(s) {
      state.sets.push({ ...s });
      persist();
    },
    async updateSet(s) {
      const i = state.sets.findIndex((x) => x.id === s.id);
      if (i >= 0) state.sets[i] = { ...state.sets[i], ...s };
      persist();
    },
    async deleteSet(id) {
      state.sets = state.sets.filter((s) => s.id !== id);
      persist();
    },
    async getSetsForWorkout(workoutLogId) {
      return state.sets
        .filter((s) => s.workoutLogId === workoutLogId)
        .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
    },
    async getLastSetsForExercise(exerciseId, excludeWorkoutId) {
      const finished = finishedWorkoutIds();
      const candidates = state.sets
        .filter(
          (s) =>
            s.exerciseId === exerciseId &&
            s.workoutLogId !== excludeWorkoutId &&
            finished.has(s.workoutLogId),
        )
        .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
      const lastWorkout = candidates[0]?.workoutLogId;
      if (!lastWorkout) return [];
      return candidates
        .filter((s) => s.workoutLogId === lastWorkout)
        .sort((a, b) => a.setNo - b.setNo);
    },
    async getBestE1Rm(exerciseId, excludeWorkoutId) {
      const es = state.sets.filter(
        (s) => s.exerciseId === exerciseId && s.workoutLogId !== excludeWorkoutId && s.reps <= 12,
      );
      if (es.length === 0) return null;
      return Math.max(...es.map((s) => epley1Rm(s.weightKg, s.reps)));
    },
    async getBestWeight(exerciseId, excludeWorkoutId) {
      const es = state.sets.filter(
        (s) => s.exerciseId === exerciseId && s.workoutLogId !== excludeWorkoutId,
      );
      if (es.length === 0) return null;
      return Math.max(...es.map((s) => s.weightKg));
    },
    async getPrRecords(limit) {
      return state.sets
        .filter((s) => s.isPr)
        .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt))
        .slice(0, limit)
        .map(
          (s): PrRecord => ({
            exerciseId: s.exerciseId,
            exerciseName: s.exerciseName,
            weightKg: s.weightKg,
            reps: s.reps,
            e1rm: epley1Rm(s.weightKg, s.reps),
            date: workoutDate(s.workoutLogId),
          }),
        );
    },
    async getVolumeBetween(fromDate, toDate) {
      const ids = new Set(
        state.workouts.filter((w) => w.date >= fromDate && w.date <= toDate).map((w) => w.id),
      );
      return Math.round(
        state.sets
          .filter((s) => ids.has(s.workoutLogId))
          .reduce((sum, s) => sum + s.weightKg * s.reps, 0),
      );
    },
    async getE1RmHistory(exerciseId, limit) {
      const finished = finishedWorkoutIds();
      const bestByDate = new Map<string, number>();
      for (const s of state.sets) {
        if (s.exerciseId !== exerciseId || s.reps > 12 || !finished.has(s.workoutLogId)) continue;
        const date = workoutDate(s.workoutLogId);
        const e = epley1Rm(s.weightKg, s.reps);
        if (e > (bestByDate.get(date) ?? 0)) bestByDate.set(date, e);
      }
      return [...bestByDate.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-limit)
        .map(([date, e1rm]) => ({ date, e1rm }));
    },
    async getRecentExerciseIds(limit) {
      const lastUsed = new Map<string, string>();
      for (const s of state.sets) {
        const prev = lastUsed.get(s.exerciseId);
        if (!prev || s.loggedAt > prev) lastUsed.set(s.exerciseId, s.loggedAt);
      }
      return [...lastUsed.entries()]
        .sort((a, b) => b[1].localeCompare(a[1]))
        .slice(0, limit)
        .map(([id]) => id);
    },
    async getSetsBetween(fromDate, toDate) {
      const dateById = new Map(
        state.workouts
          .filter((w) => w.finishedAt !== null && w.date >= fromDate && w.date <= toDate)
          .map((w) => [w.id, w.date]),
      );
      return state.sets
        .filter((s) => dateById.has(s.workoutLogId))
        .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))
        .map(
          (s): AnalyticsSet => ({
            exerciseId: s.exerciseId,
            exerciseName: s.exerciseName,
            weightKg: s.weightKg,
            reps: s.reps,
            rpe: s.rpe,
            isPr: s.isPr,
            workoutDate: dateById.get(s.workoutLogId) ?? '',
          }),
        );
    },

    // ── Body ────────────────────────────────────────────────
    async upsertWeight(w) {
      const i = state.weights.findIndex((x) => x.date === w.date);
      if (i >= 0) state.weights[i] = { ...state.weights[i]!, kg: w.kg };
      else state.weights.push(w);
      persist();
    },
    async getWeights(limitDays) {
      return [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).slice(-limitDays);
    },
    async addMeasurement(m) {
      state.measurements.push(m);
      persist();
    },
    async getMeasurements(limit) {
      return [...state.measurements].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
    },

    // ── Food ────────────────────────────────────────────────
    async logFood(f) {
      state.foodLogs.push({ ...f, loggedAt: new Date().toISOString() });
      persist();
    },
    async deleteFoodLog(id) {
      state.foodLogs = state.foodLogs.filter((f) => f.id !== id);
      persist();
    },
    async getFoodLogs(date) {
      return state.foodLogs
        .filter((f) => f.date === date)
        .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
    },
    async getKcalByDate(dates) {
      const out: Record<string, number> = {};
      for (const d of dates) out[d] = 0;
      for (const f of state.foodLogs) {
        if (f.date in out) out[f.date] = (out[f.date] ?? 0) + f.kcal;
      }
      for (const d of dates) out[d] = Math.round(out[d] ?? 0);
      return out;
    },
    async getMacrosByDate(dates) {
      const out: Record<string, DailyMacros> = {};
      for (const d of dates) out[d] = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
      for (const f of state.foodLogs) {
        const day = out[f.date];
        if (!day) continue;
        day.kcal += f.kcal;
        day.protein += f.protein;
        day.carbs += f.carbs;
        day.fat += f.fat;
      }
      for (const d of dates) {
        const day = out[d]!;
        out[d] = {
          kcal: Math.round(day.kcal),
          protein: Math.round(day.protein),
          carbs: Math.round(day.carbs),
          fat: Math.round(day.fat),
        };
      }
      return out;
    },
    async saveFood(item) {
      const i = state.foods.findIndex((f) => f.id === item.id);
      if (i >= 0) state.foods[i] = item;
      else state.foods.push(item);
      persist();
    },
    async getFoodByBarcode(barcode) {
      return state.foods.find((f) => f.barcode === barcode) ?? null;
    },
    async getFood(id) {
      return state.foods.find((f) => f.id === id) ?? null;
    },
    async searchLocalFoods(query, limit) {
      const q = query.toLowerCase();
      return state.foods.filter((f) => f.name.toLowerCase().includes(q)).slice(0, limit);
    },
    async getRecentFoods(limit) {
      const lastUsed = new Map<string, string>();
      for (const f of state.foodLogs) {
        const prev = lastUsed.get(f.foodId);
        if (!prev || f.loggedAt > prev) lastUsed.set(f.foodId, f.loggedAt);
      }
      const ordered = [...lastUsed.entries()].sort((a, b) => b[1].localeCompare(a[1]));
      const out: FoodItem[] = [];
      for (const [foodId] of ordered) {
        const food = state.foods.find((f) => f.id === foodId);
        if (food) out.push(food);
        if (out.length >= limit) break;
      }
      return out;
    },

    // ── Water ───────────────────────────────────────────────
    async getWaterMl(date) {
      return state.water[date] ?? 0;
    },
    async addWater(date, deltaMl) {
      state.water[date] = Math.max(0, (state.water[date] ?? 0) + deltaMl);
      persist();
      return state.water[date] ?? 0;
    },

    // ── Streak ──────────────────────────────────────────────
    async getStreak() {
      return state.streak;
    },
    async setStreak(s) {
      state.streak = s;
      persist();
    },
  };
}
