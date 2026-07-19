import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
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
import {
  assertAnonymousOwnerId,
  assertUsableOwnerId,
  isAnonymousOwnerId,
  ownerIdForAnonymousSession,
} from './ownership';
import type { AnalyticsSet, Repo, RepoStore } from './types';

/**
 * Web/QA implementation — same contract as SQLite, backed by an in-memory
 * store persisted to AsyncStorage (localStorage on web) as one JSON blob.
 * expo-sqlite's web support is alpha; this keeps browser QA rock-solid.
 */

interface OwnerMemoryState {
  workouts: WorkoutLog[];
  sets: (SetLog & { date?: string })[];
  weights: WeightLog[];
  measurements: Measurement[];
  foods: FoodItem[];
  foodLogs: (FoodLog & { loggedAt: string })[];
  water: Record<string, number>;
  steps: Record<string, number>;
  streak: Streak;
  /** Ids of workouts already backed up to the server (mirrors sqlite synced_at). */
  syncedWorkoutIds: string[];
}

interface MemoryStoreState {
  version: 2;
  anonymousOwnerId: string;
  owners: Record<string, OwnerMemoryState>;
}

const KEY = 'gym-tracker-db-v2';
const LEGACY_KEY = 'gym-tracker-db-v1';
const LEGACY_QUARANTINE_KEY = 'gym-tracker-db-legacy-quarantine-v1';

function emptyOwnerState(): OwnerMemoryState {
  return {
    workouts: [],
    sets: [],
    weights: [],
    measurements: [],
    foods: [],
    foodLogs: [],
    water: {},
    steps: {},
    streak: { current: 0, best: 0, lastWorkoutDate: null },
    syncedWorkoutIds: [],
  };
}

function createScopedMemoryRepo(state: OwnerMemoryState, persist: () => void): Repo {
  /* Owner state and persistence are supplied by the versioned store below. */
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

    // ── Sync (one-way server backup) ────────────────────────
    async getUnsyncedFinishedWorkouts(limit) {
      const synced = new Set(state.syncedWorkoutIds);
      return state.workouts
        .filter((w) => w.finishedAt !== null && !synced.has(w.id))
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .slice(0, limit)
        .map((workout) => ({
          workout,
          sets: state.sets
            .filter((s) => s.workoutLogId === workout.id)
            .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt)),
        }));
    },
    async markWorkoutsSynced(ids, _syncedAt) {
      const synced = new Set(state.syncedWorkoutIds);
      for (const id of ids) synced.add(id);
      state.syncedWorkoutIds = [...synced];
      persist();
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
      // Insertion-index tiebreak mirrors sqlite's `date DESC, rowid DESC`:
      // same-day corrections (newer inserts) come first.
      return state.measurements
        .map((m, i) => ({ m, i }))
        .sort((a, b) => b.m.date.localeCompare(a.m.date) || b.i - a.i)
        .slice(0, limit)
        .map(({ m }) => m);
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

    // ── Steps ───────────────────────────────────────────────
    async getSteps(date) {
      return state.steps[date] ?? 0;
    },
    async setSteps(date, steps) {
      state.steps[date] = Math.max(0, steps);
      persist();
    },
    async addSteps(date, delta) {
      state.steps[date] = Math.max(0, (state.steps[date] ?? 0) + delta);
      persist();
      return state.steps[date] ?? 0;
    },
    async getStepsBetween(startDate, endDate) {
      return Object.entries(state.steps)
        .filter(([date]) => date >= startDate && date <= endDate)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, steps]) => ({ date, steps }));
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

function isMemoryStoreState(value: unknown): value is MemoryStoreState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 2 &&
    typeof candidate.anonymousOwnerId === 'string' &&
    isAnonymousOwnerId(candidate.anonymousOwnerId) &&
    typeof candidate.owners === 'object' &&
    candidate.owners !== null
  );
}

async function quarantineLegacyMemoryStore(): Promise<void> {
  const legacy = await AsyncStorage.getItem(LEGACY_KEY);
  if (legacy === null) return;
  // Copy-before-remove: a failed quarantine write leaves the original intact.
  await AsyncStorage.setItem(LEGACY_QUARANTINE_KEY, legacy);
  await AsyncStorage.removeItem(LEGACY_KEY);
}

export async function createMemoryRepo(): Promise<RepoStore> {
  const initialAnonymousOwnerId = ownerIdForAnonymousSession(randomUUID());
  let store: MemoryStoreState = {
    version: 2,
    anonymousOwnerId: initialAnonymousOwnerId,
    owners: {},
  };

  try {
    await quarantineLegacyMemoryStore();
    const raw = await AsyncStorage.getItem(KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (isMemoryStoreState(parsed)) store = parsed;
    }
  } catch {
    // Corrupt/unavailable storage starts isolated instead of exposing v1 data.
  }

  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  function persist(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      void AsyncStorage.setItem(KEY, JSON.stringify(store));
    }, 150);
  }
  async function persistNow(): Promise<void> {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    await AsyncStorage.setItem(KEY, JSON.stringify(store));
  }

  const repos = new Map<string, Repo>();
  function ownerState(ownerId: string): OwnerMemoryState {
    const existing = store.owners[ownerId];
    if (existing) return existing;
    const created = emptyOwnerState();
    store.owners[ownerId] = created;
    persist();
    return created;
  }

  return {
    getAnonymousOwnerId() {
      return store.anonymousOwnerId;
    },
    async setAnonymousOwnerId(ownerId) {
      assertAnonymousOwnerId(ownerId);
      store.anonymousOwnerId = ownerId;
      await persistNow();
    },
    forOwner(ownerId) {
      assertUsableOwnerId(ownerId);
      const cached = repos.get(ownerId);
      if (cached) return cached;
      const repo = createScopedMemoryRepo(ownerState(ownerId), persist);
      repos.set(ownerId, repo);
      return repo;
    },
    async deleteOwnerData(ownerId) {
      assertUsableOwnerId(ownerId);
      const existing = store.owners[ownerId];
      if (existing) {
        Object.assign(existing, emptyOwnerState());
        delete store.owners[ownerId];
      }
      repos.delete(ownerId);
      await persistNow();
    },
  };
}
