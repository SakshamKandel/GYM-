import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import {
  compareMemberDataVersions,
  EMPTY_MEMBER_DATA_SYNC_CURSOR,
  epley1Rm,
  memberDataRecordId,
  memberDataSyncCursorSchema,
  memberDataMutationSchema,
  trainingCatalogCacheSchema,
} from '@gym/shared';
import type {
  DailyMacros,
  FoodItem,
  FoodLog,
  Measurement,
  MemberDataChange,
  MemberDataMutation,
  MemberDataRecord,
  MemberDataSyncCursor,
  PrRecord,
  SetLog,
  Streak,
  TrainingCatalogCache,
  WeightLog,
  WorkoutSessionBlueprint,
  WorkoutLog,
} from '@gym/shared';
import {
  assertAnonymousOwnerId,
  assertUsableOwnerId,
  isAnonymousOwnerId,
  ownerIdForAnonymousSession,
} from './ownership';
import { notifyMemberDataChanged } from './memberDataTrigger';
import type { AnalyticsSet, Repo, RepoStore, WorkoutSyncFailure } from './types';

/**
 * Web/QA implementation — same contract as SQLite, backed by an in-memory
 * store persisted to AsyncStorage (localStorage on web) as one JSON blob.
 * expo-sqlite's web support is alpha; this keeps browser QA rock-solid.
 */

interface OwnerMemoryState {
  trainingCatalog: TrainingCatalogCache | null;
  workouts: WorkoutLog[];
  sets: (SetLog & { date?: string })[];
  weights: WeightLog[];
  measurements: Measurement[];
  foods: FoodItem[];
  foodLogs: (FoodLog & { loggedAt: string })[];
  /** Ids of favorited foods, keyed to the ms timestamp favorited (local-only). */
  favoriteFoodIds: Record<string, number>;
  water: Record<string, number>;
  steps: Record<string, number>;
  streak: Streak;
  /** Ids of workouts already backed up to the server (mirrors sqlite synced_at). */
  syncedWorkoutIds: string[];
  /** Permanently rejected rows stay local but no longer wedge the pending queue. */
  failedWorkoutSyncs: Record<string, WorkoutSyncFailure>;
  /** Restart metadata for active sessions only, keyed by local workout id. */
  workoutBlueprints: Record<string, WorkoutSessionBlueprint>;
  /** One latest local mutation per entity/key; replacing a row coalesces retries. */
  memberDataMutations: Record<string, MemberDataMutation>;
  memberDataCursor: MemberDataSyncCursor;
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
    trainingCatalog: null,
    workouts: [],
    sets: [],
    weights: [],
    measurements: [],
    foods: [],
    foodLogs: [],
    favoriteFoodIds: {},
    water: {},
    steps: {},
    streak: { current: 0, best: 0, lastWorkoutDate: null },
    syncedWorkoutIds: [],
    failedWorkoutSyncs: {},
    workoutBlueprints: {},
    memberDataMutations: {},
    memberDataCursor: { ...EMPTY_MEMBER_DATA_SYNC_CURSOR },
  };
}

function createScopedMemoryRepo(
  state: OwnerMemoryState,
  persist: () => void,
  ownerId: string,
): Repo {
  /* Owner state and persistence are supplied by the versioned store below. */
  function workoutDate(workoutLogId: string): string {
    return state.workouts.find((w) => w.id === workoutLogId)?.date ?? '';
  }

  function finishedWorkoutIds(): Set<string> {
    return new Set(state.workouts.filter((w) => w.finishedAt !== null).map((w) => w.id));
  }

  const syncEnabled = !isAnonymousOwnerId(ownerId);

  function mutationKey(record: MemberDataRecord): string {
    return `${record.entity}:${memberDataRecordId(record)}`;
  }

  function queueMemberData(record: MemberDataRecord, deleted = false): void {
    if (!syncEnabled) return;
    const parsed = memberDataMutationSchema.parse({
      mutationId: randomUUID(),
      changedAt: new Date().toISOString(),
      deleted,
      record,
    });
    state.memberDataMutations[mutationKey(record)] = parsed;
  }

  function applyMemberDataChange(item: MemberDataChange): void {
    const { record } = item;
    switch (record.entity) {
      case 'weight': {
        const index = state.weights.findIndex((entry) => entry.date === record.value.date);
        if (item.deleted) {
          if (index >= 0) state.weights.splice(index, 1);
        } else if (index >= 0) {
          state.weights[index] = record.value;
        } else {
          state.weights.push(record.value);
        }
        return;
      }
      case 'measurement': {
        const index = state.measurements.findIndex((entry) => entry.id === record.value.id);
        if (item.deleted) {
          if (index >= 0) state.measurements.splice(index, 1);
        } else if (index >= 0) {
          state.measurements[index] = record.value;
        } else {
          state.measurements.push(record.value);
        }
        return;
      }
      case 'food': {
        const index = state.foods.findIndex((entry) => entry.id === record.value.id);
        if (item.deleted) {
          if (index >= 0) state.foods.splice(index, 1);
        } else if (index >= 0) {
          state.foods[index] = record.value;
        } else {
          state.foods.push(record.value);
        }
        return;
      }
      case 'foodLog': {
        const index = state.foodLogs.findIndex((entry) => entry.id === record.value.id);
        if (item.deleted) {
          if (index >= 0) state.foodLogs.splice(index, 1);
        } else {
          const next = { ...record.value, loggedAt: item.changedAt };
          if (index >= 0) state.foodLogs[index] = next;
          else state.foodLogs.push(next);
        }
        return;
      }
      case 'water':
        if (item.deleted) delete state.water[record.value.date];
        else state.water[record.value.date] = record.value.ml;
        return;
      case 'steps':
        if (item.deleted) delete state.steps[record.value.date];
        else state.steps[record.value.date] = record.value.steps;
    }
  }

  return {
    async getTrainingCatalogCache() {
      const parsed = trainingCatalogCacheSchema.safeParse(state.trainingCatalog);
      return parsed.success ? parsed.data : null;
    },
    async saveTrainingCatalogCache(cache) {
      state.trainingCatalog = trainingCatalogCacheSchema.parse(cache);
      persist();
    },

    // ── Workouts ────────────────────────────────────────────
    async startWorkout(w, blueprint) {
      state.workouts.push({ ...w, finishedAt: null, durationSec: null });
      if (blueprint) state.workoutBlueprints[w.id] = blueprint;
      persist();
    },
    async finishWorkout(id, finishedAt, durationSec) {
      const w = state.workouts.find((x) => x.id === id);
      if (w) {
        w.finishedAt = finishedAt;
        w.durationSec = durationSec;
      }
      delete state.workoutBlueprints[id];
      persist();
    },
    async saveWorkoutBlueprint(id, blueprint) {
      if (state.workouts.some((workout) => workout.id === id && workout.finishedAt === null)) {
        state.workoutBlueprints[id] = blueprint;
        persist();
      }
    },
    async getWorkoutBlueprint(id) {
      return state.workoutBlueprints[id] ?? null;
    },
    async deleteWorkout(id) {
      state.workouts = state.workouts.filter((w) => w.id !== id);
      state.sets = state.sets.filter((s) => s.workoutLogId !== id);
      delete state.failedWorkoutSyncs[id];
      delete state.workoutBlueprints[id];
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
        .filter(
          (w) =>
            w.finishedAt !== null && !synced.has(w.id) && !(w.id in state.failedWorkoutSyncs),
        )
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
      for (const id of ids) {
        synced.add(id);
        delete state.failedWorkoutSyncs[id];
      }
      state.syncedWorkoutIds = [...synced];
      persist();
    },
    async markWorkoutSyncFailed(failure) {
      state.failedWorkoutSyncs[failure.workoutId] = failure;
      persist();
    },
    async getWorkoutSyncFailures(limit) {
      return Object.values(state.failedWorkoutSyncs)
        .sort((a, b) => b.failedAt.localeCompare(a.failedAt))
        .slice(0, limit);
    },

    async getPendingMemberDataMutations(limit) {
      return Object.values(state.memberDataMutations)
        .sort(
          (a, b) =>
            a.changedAt.localeCompare(b.changedAt) || a.mutationId.localeCompare(b.mutationId),
        )
        .slice(0, limit);
    },
    async getMemberDataSyncCursor() {
      return state.memberDataCursor;
    },
    async applyMemberDataSyncResponse(response) {
      const acknowledged = new Set(response.acknowledgedMutationIds);
      for (const [key, pending] of Object.entries(state.memberDataMutations)) {
        if (acknowledged.has(pending.mutationId)) delete state.memberDataMutations[key];
      }
      for (const item of response.changes) {
        const key = mutationKey(item.record);
        const pending = state.memberDataMutations[key];
        if (pending && compareMemberDataVersions(pending, item) > 0) continue;
        if (pending) delete state.memberDataMutations[key];
        applyMemberDataChange(item);
      }
      state.memberDataCursor = response.cursor;
      persist();
    },

    // ── Body ────────────────────────────────────────────────
    async upsertWeight(w) {
      const i = state.weights.findIndex((x) => x.date === w.date);
      if (i >= 0) state.weights[i] = { ...state.weights[i]!, kg: w.kg };
      else state.weights.push(w);
      queueMemberData({ entity: 'weight', value: w });
      persist();
      notifyMemberDataChanged();
    },
    async getWeights(limitDays) {
      return [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).slice(-limitDays);
    },
    async addMeasurement(m) {
      state.measurements.push(m);
      queueMemberData({ entity: 'measurement', value: m });
      persist();
      notifyMemberDataChanged();
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
      queueMemberData({ entity: 'foodLog', value: f });
      persist();
      notifyMemberDataChanged();
    },
    async logFoodBatch(logs) {
      if (logs.length === 0) return;
      // No I/O between pushes — either every entry lands or (on a thrown
      // validation error before this point) none do, matching sqlite's
      // transactional guarantee for B19.
      const loggedAt = new Date().toISOString();
      state.foodLogs.push(...logs.map((f) => ({ ...f, loggedAt })));
      for (const log of logs) queueMemberData({ entity: 'foodLog', value: log });
      persist();
      notifyMemberDataChanged();
    },
    async deleteFoodLog(id) {
      const existing = state.foodLogs.find((entry) => entry.id === id);
      state.foodLogs = state.foodLogs.filter((f) => f.id !== id);
      if (existing) {
        const { loggedAt: _loggedAt, ...value } = existing;
        queueMemberData({ entity: 'foodLog', value }, true);
      }
      persist();
      if (existing) notifyMemberDataChanged();
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
      if (item.source === 'custom') queueMemberData({ entity: 'food', value: item });
      persist();
      if (item.source === 'custom') notifyMemberDataChanged();
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
    async toggleFavoriteFood(foodId) {
      if (foodId in state.favoriteFoodIds) {
        delete state.favoriteFoodIds[foodId];
        persist();
        return false;
      }
      state.favoriteFoodIds[foodId] = Date.now();
      persist();
      return true;
    },
    async isFavoriteFood(foodId) {
      return foodId in state.favoriteFoodIds;
    },
    async getFavoriteFoods(limit) {
      const ordered = Object.entries(state.favoriteFoodIds).sort((a, b) => b[1] - a[1]);
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
      queueMemberData({ entity: 'water', value: { date, ml: state.water[date] ?? 0 } });
      persist();
      notifyMemberDataChanged();
      return state.water[date] ?? 0;
    },

    // ── Steps ───────────────────────────────────────────────
    async getSteps(date) {
      return state.steps[date] ?? 0;
    },
    async setSteps(date, steps) {
      state.steps[date] = Math.max(0, steps);
      queueMemberData({ entity: 'steps', value: { date, steps: state.steps[date] ?? 0 } });
      persist();
      notifyMemberDataChanged();
    },
    async addSteps(date, delta) {
      state.steps[date] = Math.max(0, (state.steps[date] ?? 0) + delta);
      queueMemberData({ entity: 'steps', value: { date, steps: state.steps[date] ?? 0 } });
      persist();
      notifyMemberDataChanged();
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
      if (isMemoryStoreState(parsed)) {
        store = parsed;
        // v2 stores created before active-session blueprints remain compatible.
        for (const owner of Object.values(store.owners)) {
          const cachedCatalog = trainingCatalogCacheSchema.safeParse(owner.trainingCatalog);
          owner.trainingCatalog = cachedCatalog.success ? cachedCatalog.data : null;
          if (
            typeof owner.workoutBlueprints !== 'object' ||
            owner.workoutBlueprints === null ||
            Array.isArray(owner.workoutBlueprints)
          ) {
            owner.workoutBlueprints = {};
          }
          // Stores created before favorites landed lack the map entirely.
          if (
            typeof owner.favoriteFoodIds !== 'object' ||
            owner.favoriteFoodIds === null ||
            Array.isArray(owner.favoriteFoodIds)
          ) {
            owner.favoriteFoodIds = {};
          }
          if (
            typeof owner.failedWorkoutSyncs !== 'object' ||
            owner.failedWorkoutSyncs === null ||
            Array.isArray(owner.failedWorkoutSyncs)
          ) {
            owner.failedWorkoutSyncs = {};
          }
          if (
            typeof owner.memberDataMutations !== 'object' ||
            owner.memberDataMutations === null ||
            Array.isArray(owner.memberDataMutations)
          ) {
            owner.memberDataMutations = {};
          } else {
            const validMutations: Record<string, MemberDataMutation> = {};
            for (const [key, value] of Object.entries(owner.memberDataMutations)) {
              const parsedMutation = memberDataMutationSchema.safeParse(value);
              if (parsedMutation.success) validMutations[key] = parsedMutation.data;
            }
            owner.memberDataMutations = validMutations;
          }
          const parsedCursor = memberDataSyncCursorSchema.safeParse(owner.memberDataCursor);
          owner.memberDataCursor = parsedCursor.success
            ? parsedCursor.data
            : { ...EMPTY_MEMBER_DATA_SYNC_CURSOR };
        }
      }
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
      const repo = createScopedMemoryRepo(ownerState(ownerId), persist, ownerId);
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
