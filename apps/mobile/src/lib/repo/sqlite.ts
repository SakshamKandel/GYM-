import * as SQLite from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';
import {
  compareMemberDataVersions,
  EMPTY_MEMBER_DATA_SYNC_CURSOR,
  epley1Rm,
  memberDataMutationSchema,
  memberDataRecordId,
  memberDataSyncCursorSchema,
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
  WorkoutLog,
} from '@gym/shared';
import {
  assertAnonymousOwnerId,
  assertUsableOwnerId,
  isAnonymousOwnerId,
  LEGACY_QUARANTINE_OWNER_ID,
  ownerIdForAnonymousSession,
} from './ownership';
import { notifyMemberDataChanged } from './memberDataTrigger';
import type { AnalyticsSet, Repo, RepoStore, WorkoutSyncFailure } from './types';
import { parseWorkoutBlueprintJson, serializeWorkoutBlueprint } from './workoutBlueprint';

/** Offline-first native store (CLAUDE.md rule 5): every write lands here first. */

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS repo_meta (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS training_catalog_cache (
  owner_id TEXT PRIMARY KEY, catalog_json TEXT NOT NULL, fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workout_logs (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, date TEXT NOT NULL, plan_workout_id TEXT,
  name TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, duration_sec INTEGER,
  synced_at TEXT, sync_error TEXT, sync_failed_at TEXT, PRIMARY KEY (owner_id, id)
);
CREATE TABLE IF NOT EXISTS workout_session_blueprints (
  owner_id TEXT NOT NULL, workout_log_id TEXT NOT NULL, blueprint_json TEXT NOT NULL,
  PRIMARY KEY (owner_id, workout_log_id)
);
CREATE TABLE IF NOT EXISTS set_logs (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, workout_log_id TEXT NOT NULL, exercise_id TEXT NOT NULL,
  exercise_name TEXT NOT NULL, set_no INTEGER NOT NULL, weight_kg REAL NOT NULL,
  reps INTEGER NOT NULL, rpe REAL, is_pr INTEGER NOT NULL DEFAULT 0, logged_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX IF NOT EXISTS idx_sets_workout ON set_logs(workout_log_id);
CREATE INDEX IF NOT EXISTS idx_sets_exercise ON set_logs(exercise_id, logged_at);
CREATE TABLE IF NOT EXISTS weight_logs (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, date TEXT NOT NULL, kg REAL NOT NULL,
  PRIMARY KEY (owner_id, date)
);
CREATE TABLE IF NOT EXISTS measurements (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, date TEXT NOT NULL, waist_cm REAL, chest_cm REAL,
  arm_cm REAL, hip_cm REAL, thigh_cm REAL, PRIMARY KEY (owner_id, id)
);
CREATE TABLE IF NOT EXISTS foods (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, brand TEXT, source TEXT NOT NULL,
  barcode TEXT, kcal_per_100 REAL NOT NULL, protein_per_100 REAL NOT NULL,
  carbs_per_100 REAL NOT NULL, fat_per_100 REAL NOT NULL,
  serving_grams REAL, serving_label TEXT,
  fiber_per_100 REAL, sugar_per_100 REAL, sodium_per_100 REAL,
  nutri_score TEXT, nova_group INTEGER, PRIMARY KEY (owner_id, id)
);
CREATE INDEX IF NOT EXISTS idx_foods_barcode ON foods(barcode);
CREATE TABLE IF NOT EXISTS food_logs (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, date TEXT NOT NULL, meal TEXT NOT NULL, food_id TEXT NOT NULL,
  food_name TEXT NOT NULL, grams REAL NOT NULL, kcal REAL NOT NULL,
  protein REAL NOT NULL, carbs REAL NOT NULL, fat REAL NOT NULL, logged_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX IF NOT EXISTS idx_food_logs_date ON food_logs(date);
CREATE TABLE IF NOT EXISTS water_logs (
  owner_id TEXT NOT NULL, date TEXT NOT NULL, ml INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, date)
);
CREATE TABLE IF NOT EXISTS step_logs (
  owner_id TEXT NOT NULL, date TEXT NOT NULL, steps INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, date)
);
CREATE TABLE IF NOT EXISTS streaks (
  owner_id TEXT NOT NULL, id INTEGER NOT NULL CHECK (id = 1),
  current INTEGER NOT NULL DEFAULT 0, best INTEGER NOT NULL DEFAULT 0, last_workout_date TEXT,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE IF NOT EXISTS food_favorites (
  owner_id TEXT NOT NULL, food_id TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, food_id)
);
CREATE TABLE IF NOT EXISTS member_data_mutations (
  owner_id TEXT NOT NULL, entity TEXT NOT NULL, record_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL, changed_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
  record_json TEXT NOT NULL, PRIMARY KEY (owner_id, entity, record_id)
);
CREATE INDEX IF NOT EXISTS idx_member_data_mutations_owner_changed
  ON member_data_mutations(owner_id, changed_at, mutation_id);
CREATE TABLE IF NOT EXISTS member_data_sync_state (
  owner_id TEXT PRIMARY KEY, cursor_json TEXT NOT NULL
);
`;

const OWNER_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_workouts_owner_started ON workout_logs(owner_id, started_at);
CREATE INDEX IF NOT EXISTS idx_workouts_owner_date ON workout_logs(owner_id, date);
CREATE INDEX IF NOT EXISTS idx_sets_owner_workout ON set_logs(owner_id, workout_log_id);
CREATE INDEX IF NOT EXISTS idx_sets_owner_exercise ON set_logs(owner_id, exercise_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_weights_owner_date ON weight_logs(owner_id, date);
CREATE INDEX IF NOT EXISTS idx_measurements_owner_date ON measurements(owner_id, date);
CREATE INDEX IF NOT EXISTS idx_foods_owner_barcode ON foods(owner_id, barcode);
CREATE INDEX IF NOT EXISTS idx_food_logs_owner_date ON food_logs(owner_id, date);
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
  fiber_per_100: number | null;
  sugar_per_100: number | null;
  sodium_per_100: number | null;
  nutri_score: string | null;
  nova_group: number | null;
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

interface MemberDataMutationRow {
  entity: string;
  record_id: string;
  mutation_id: string;
  changed_at: string;
  deleted: number;
  record_json: string;
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

function toNutriScore(raw: string | null): FoodItem['nutriScore'] {
  return raw === 'a' || raw === 'b' || raw === 'c' || raw === 'd' || raw === 'e' ? raw : null;
}

function toNovaGroup(raw: number | null): FoodItem['novaGroup'] {
  return raw === 1 || raw === 2 || raw === 3 || raw === 4 ? raw : null;
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
    fiberPer100: r.fiber_per_100,
    sugarPer100: r.sugar_per_100,
    sodiumPer100: r.sodium_per_100,
    nutriScore: toNutriScore(r.nutri_score),
    novaGroup: toNovaGroup(r.nova_group),
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

function memberDataMutationFromRow(row: MemberDataMutationRow): MemberDataMutation | null {
  try {
    const parsed = memberDataMutationSchema.safeParse({
      mutationId: row.mutation_id,
      changedAt: row.changed_at,
      deleted: row.deleted === 1,
      record: JSON.parse(row.record_json) as unknown,
    });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function queueMemberDataMutation(
  transaction: SQLite.SQLiteDatabase,
  ownerId: string,
  record: MemberDataRecord,
  deleted = false,
): Promise<void> {
  if (isAnonymousOwnerId(ownerId)) return;
  const mutation = memberDataMutationSchema.parse({
    mutationId: randomUUID(),
    changedAt: new Date().toISOString(),
    deleted,
    record,
  });
  await transaction.runAsync(
    `INSERT INTO member_data_mutations
       (owner_id, entity, record_id, mutation_id, changed_at, deleted, record_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_id, entity, record_id) DO UPDATE SET
       mutation_id=excluded.mutation_id, changed_at=excluded.changed_at,
       deleted=excluded.deleted, record_json=excluded.record_json`,
    ownerId,
    record.entity,
    memberDataRecordId(record),
    mutation.mutationId,
    mutation.changedAt,
    mutation.deleted ? 1 : 0,
    JSON.stringify(mutation.record),
  );
}

async function applyMemberDataChange(
  transaction: SQLite.SQLiteDatabase,
  ownerId: string,
  item: MemberDataChange,
): Promise<void> {
  const { record } = item;
  switch (record.entity) {
    case 'weight':
      if (item.deleted) {
        await transaction.runAsync(
          'DELETE FROM weight_logs WHERE owner_id = ? AND date = ?',
          ownerId,
          record.value.date,
        );
      } else {
        await transaction.runAsync(
          `INSERT INTO weight_logs (owner_id, id, date, kg) VALUES (?,?,?,?)
           ON CONFLICT(owner_id, date) DO UPDATE SET id=excluded.id, kg=excluded.kg`,
          ownerId,
          record.value.id,
          record.value.date,
          record.value.kg,
        );
      }
      return;
    case 'measurement':
      if (item.deleted) {
        await transaction.runAsync(
          'DELETE FROM measurements WHERE owner_id = ? AND id = ?',
          ownerId,
          record.value.id,
        );
      } else {
        await transaction.runAsync(
          `INSERT INTO measurements
             (owner_id,id,date,waist_cm,chest_cm,arm_cm,hip_cm,thigh_cm)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(owner_id,id) DO UPDATE SET date=excluded.date,
             waist_cm=excluded.waist_cm, chest_cm=excluded.chest_cm,
             arm_cm=excluded.arm_cm, hip_cm=excluded.hip_cm, thigh_cm=excluded.thigh_cm`,
          ownerId,
          record.value.id,
          record.value.date,
          record.value.waistCm,
          record.value.chestCm,
          record.value.armCm,
          record.value.hipCm,
          record.value.thighCm,
        );
      }
      return;
    case 'food':
      if (item.deleted) {
        await transaction.runAsync(
          'DELETE FROM foods WHERE owner_id = ? AND id = ?',
          ownerId,
          record.value.id,
        );
      } else {
        const value = record.value;
        await transaction.runAsync(
          `INSERT INTO foods
             (owner_id,id,name,brand,source,barcode,kcal_per_100,protein_per_100,
              carbs_per_100,fat_per_100,serving_grams,serving_label,fiber_per_100,
              sugar_per_100,sodium_per_100,nutri_score,nova_group)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(owner_id,id) DO UPDATE SET name=excluded.name,brand=excluded.brand,
             source=excluded.source,barcode=excluded.barcode,kcal_per_100=excluded.kcal_per_100,
             protein_per_100=excluded.protein_per_100,carbs_per_100=excluded.carbs_per_100,
             fat_per_100=excluded.fat_per_100,serving_grams=excluded.serving_grams,
             serving_label=excluded.serving_label,fiber_per_100=excluded.fiber_per_100,
             sugar_per_100=excluded.sugar_per_100,sodium_per_100=excluded.sodium_per_100,
             nutri_score=excluded.nutri_score,nova_group=excluded.nova_group`,
          ownerId,
          value.id,
          value.name,
          value.brand,
          value.source,
          value.barcode,
          value.kcalPer100,
          value.proteinPer100,
          value.carbsPer100,
          value.fatPer100,
          value.servingGrams,
          value.servingLabel,
          value.fiberPer100 ?? null,
          value.sugarPer100 ?? null,
          value.sodiumPer100 ?? null,
          value.nutriScore ?? null,
          value.novaGroup ?? null,
        );
      }
      return;
    case 'foodLog':
      if (item.deleted) {
        await transaction.runAsync(
          'DELETE FROM food_logs WHERE owner_id = ? AND id = ?',
          ownerId,
          record.value.id,
        );
      } else {
        const value = record.value;
        await transaction.runAsync(
          `INSERT INTO food_logs
             (owner_id,id,date,meal,food_id,food_name,grams,kcal,protein,carbs,fat,logged_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(owner_id,id) DO UPDATE SET date=excluded.date,meal=excluded.meal,
             food_id=excluded.food_id,food_name=excluded.food_name,grams=excluded.grams,
             kcal=excluded.kcal,protein=excluded.protein,carbs=excluded.carbs,
             fat=excluded.fat,logged_at=excluded.logged_at`,
          ownerId,
          value.id,
          value.date,
          value.meal,
          value.foodId,
          value.foodName,
          value.grams,
          value.kcal,
          value.protein,
          value.carbs,
          value.fat,
          item.changedAt,
        );
      }
      return;
    case 'water':
      if (item.deleted) {
        await transaction.runAsync(
          'DELETE FROM water_logs WHERE owner_id = ? AND date = ?',
          ownerId,
          record.value.date,
        );
      } else {
        await transaction.runAsync(
          `INSERT INTO water_logs (owner_id,date,ml) VALUES (?,?,?)
           ON CONFLICT(owner_id,date) DO UPDATE SET ml=excluded.ml`,
          ownerId,
          record.value.date,
          record.value.ml,
        );
      }
      return;
    case 'steps':
      if (item.deleted) {
        await transaction.runAsync(
          'DELETE FROM step_logs WHERE owner_id = ? AND date = ?',
          ownerId,
          record.value.date,
        );
      } else {
        await transaction.runAsync(
          `INSERT INTO step_logs (owner_id,date,steps) VALUES (?,?,?)
           ON CONFLICT(owner_id,date) DO UPDATE SET steps=excluded.steps`,
          ownerId,
          record.value.date,
          record.value.steps,
        );
      }
  }
}

async function tableHasOwnerColumn(
  db: SQLite.SQLiteDatabase,
  table: string,
): Promise<boolean> {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return columns.some((column) => column.name === 'owner_id');
}

/**
 * Upgrade ownerless v1 tables transactionally. Existing rows are copied into
 * a reserved quarantine namespace; they are never guessed to belong to the
 * next account that happens to sign in on this device.
 */
async function migrateOwnerScope(db: SQLite.SQLiteDatabase): Promise<void> {
  const rebuilds: string[] = [];
  const legacy = LEGACY_QUARANTINE_OWNER_ID;

  if (!(await tableHasOwnerColumn(db, 'workout_logs'))) {
    rebuilds.push(`
      CREATE TABLE workout_logs_owner_v2 (
        owner_id TEXT NOT NULL, id TEXT NOT NULL, date TEXT NOT NULL, plan_workout_id TEXT,
        name TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, duration_sec INTEGER,
        synced_at TEXT, sync_error TEXT, sync_failed_at TEXT, PRIMARY KEY (owner_id, id)
      );
      INSERT INTO workout_logs_owner_v2
        (owner_id, id, date, plan_workout_id, name, started_at, finished_at, duration_sec,
         synced_at, sync_error, sync_failed_at)
      SELECT '${legacy}', id, date, plan_workout_id, name, started_at, finished_at, duration_sec,
        synced_at, sync_error, sync_failed_at
      FROM workout_logs;
      DROP TABLE workout_logs;
      ALTER TABLE workout_logs_owner_v2 RENAME TO workout_logs;
    `);
  }
  if (!(await tableHasOwnerColumn(db, 'set_logs'))) {
    rebuilds.push(`
      CREATE TABLE set_logs_owner_v2 (
        owner_id TEXT NOT NULL, id TEXT NOT NULL, workout_log_id TEXT NOT NULL,
        exercise_id TEXT NOT NULL, exercise_name TEXT NOT NULL, set_no INTEGER NOT NULL,
        weight_kg REAL NOT NULL, reps INTEGER NOT NULL, rpe REAL,
        is_pr INTEGER NOT NULL DEFAULT 0, logged_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, id)
      );
      INSERT INTO set_logs_owner_v2
        (owner_id, id, workout_log_id, exercise_id, exercise_name, set_no, weight_kg, reps, rpe, is_pr, logged_at)
      SELECT '${legacy}', id, workout_log_id, exercise_id, exercise_name, set_no, weight_kg, reps, rpe, is_pr, logged_at
      FROM set_logs;
      DROP TABLE set_logs;
      ALTER TABLE set_logs_owner_v2 RENAME TO set_logs;
    `);
  }
  if (!(await tableHasOwnerColumn(db, 'weight_logs'))) {
    rebuilds.push(`
      CREATE TABLE weight_logs_owner_v2 (
        owner_id TEXT NOT NULL, id TEXT NOT NULL, date TEXT NOT NULL, kg REAL NOT NULL,
        PRIMARY KEY (owner_id, date)
      );
      INSERT INTO weight_logs_owner_v2 (owner_id, id, date, kg)
      SELECT '${legacy}', id, date, kg FROM weight_logs;
      DROP TABLE weight_logs;
      ALTER TABLE weight_logs_owner_v2 RENAME TO weight_logs;
    `);
  }
  if (!(await tableHasOwnerColumn(db, 'measurements'))) {
    rebuilds.push(`
      CREATE TABLE measurements_owner_v2 (
        owner_id TEXT NOT NULL, id TEXT NOT NULL, date TEXT NOT NULL,
        waist_cm REAL, chest_cm REAL, arm_cm REAL, hip_cm REAL, thigh_cm REAL,
        PRIMARY KEY (owner_id, id)
      );
      INSERT INTO measurements_owner_v2
        (owner_id, id, date, waist_cm, chest_cm, arm_cm, hip_cm, thigh_cm)
      SELECT '${legacy}', id, date, waist_cm, chest_cm, arm_cm, hip_cm, thigh_cm
      FROM measurements;
      DROP TABLE measurements;
      ALTER TABLE measurements_owner_v2 RENAME TO measurements;
    `);
  }
  if (!(await tableHasOwnerColumn(db, 'foods'))) {
    rebuilds.push(`
      CREATE TABLE foods_owner_v2 (
        owner_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, brand TEXT,
        source TEXT NOT NULL, barcode TEXT, kcal_per_100 REAL NOT NULL,
        protein_per_100 REAL NOT NULL, carbs_per_100 REAL NOT NULL, fat_per_100 REAL NOT NULL,
        serving_grams REAL, serving_label TEXT, fiber_per_100 REAL, sugar_per_100 REAL,
        sodium_per_100 REAL, nutri_score TEXT, nova_group INTEGER,
        PRIMARY KEY (owner_id, id)
      );
      INSERT INTO foods_owner_v2
        (owner_id, id, name, brand, source, barcode, kcal_per_100, protein_per_100,
         carbs_per_100, fat_per_100, serving_grams, serving_label, fiber_per_100,
         sugar_per_100, sodium_per_100, nutri_score, nova_group)
      SELECT '${legacy}', id, name, brand, source, barcode, kcal_per_100, protein_per_100,
        carbs_per_100, fat_per_100, serving_grams, serving_label, fiber_per_100,
        sugar_per_100, sodium_per_100, nutri_score, nova_group
      FROM foods;
      DROP TABLE foods;
      ALTER TABLE foods_owner_v2 RENAME TO foods;
    `);
  }
  if (!(await tableHasOwnerColumn(db, 'food_logs'))) {
    rebuilds.push(`
      CREATE TABLE food_logs_owner_v2 (
        owner_id TEXT NOT NULL, id TEXT NOT NULL, date TEXT NOT NULL, meal TEXT NOT NULL,
        food_id TEXT NOT NULL, food_name TEXT NOT NULL, grams REAL NOT NULL, kcal REAL NOT NULL,
        protein REAL NOT NULL, carbs REAL NOT NULL, fat REAL NOT NULL, logged_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, id)
      );
      INSERT INTO food_logs_owner_v2
        (owner_id, id, date, meal, food_id, food_name, grams, kcal, protein, carbs, fat, logged_at)
      SELECT '${legacy}', id, date, meal, food_id, food_name, grams, kcal, protein, carbs, fat, logged_at
      FROM food_logs;
      DROP TABLE food_logs;
      ALTER TABLE food_logs_owner_v2 RENAME TO food_logs;
    `);
  }
  if (!(await tableHasOwnerColumn(db, 'water_logs'))) {
    rebuilds.push(`
      CREATE TABLE water_logs_owner_v2 (
        owner_id TEXT NOT NULL, date TEXT NOT NULL, ml INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (owner_id, date)
      );
      INSERT INTO water_logs_owner_v2 (owner_id, date, ml)
      SELECT '${legacy}', date, ml FROM water_logs;
      DROP TABLE water_logs;
      ALTER TABLE water_logs_owner_v2 RENAME TO water_logs;
    `);
  }
  if (!(await tableHasOwnerColumn(db, 'step_logs'))) {
    rebuilds.push(`
      CREATE TABLE step_logs_owner_v2 (
        owner_id TEXT NOT NULL, date TEXT NOT NULL, steps INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (owner_id, date)
      );
      INSERT INTO step_logs_owner_v2 (owner_id, date, steps)
      SELECT '${legacy}', date, steps FROM step_logs;
      DROP TABLE step_logs;
      ALTER TABLE step_logs_owner_v2 RENAME TO step_logs;
    `);
  }
  if (!(await tableHasOwnerColumn(db, 'streaks'))) {
    rebuilds.push(`
      CREATE TABLE streaks_owner_v2 (
        owner_id TEXT NOT NULL, id INTEGER NOT NULL CHECK (id = 1),
        current INTEGER NOT NULL DEFAULT 0, best INTEGER NOT NULL DEFAULT 0,
        last_workout_date TEXT, PRIMARY KEY (owner_id, id)
      );
      INSERT INTO streaks_owner_v2 (owner_id, id, current, best, last_workout_date)
      SELECT '${legacy}', id, current, best, last_workout_date FROM streaks;
      DROP TABLE streaks;
      ALTER TABLE streaks_owner_v2 RENAME TO streaks;
    `);
  }

  if (rebuilds.length > 0) {
    await db.withExclusiveTransactionAsync(async (transaction) => {
      for (const sql of rebuilds) await transaction.execAsync(sql);
    });
  }
  await db.execAsync(OWNER_INDEXES);
}

async function loadAnonymousOwnerId(db: SQLite.SQLiteDatabase): Promise<string> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM repo_meta WHERE key = 'anonymous_owner_id'",
  );
  if (row?.value) {
    try {
      assertAnonymousOwnerId(row.value);
      return row.value;
    } catch {
      // Replace corrupt/reserved metadata with a new isolated namespace.
    }
  }
  const ownerId = ownerIdForAnonymousSession(randomUUID());
  await db.runAsync(
    `INSERT INTO repo_meta (key, value) VALUES ('anonymous_owner_id', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ownerId,
  );
  return ownerId;
}

export async function createSqliteRepo(): Promise<RepoStore> {
  const db = await SQLite.openDatabaseAsync('gym-tracker.db');
  await db.execAsync(SCHEMA);

  // Installs that created set_logs before RPE landed lack the column —
  // CREATE TABLE IF NOT EXISTS never alters an existing table.
  const setCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(set_logs)');
  if (!setCols.some((c) => c.name === 'rpe')) {
    await db.execAsync('ALTER TABLE set_logs ADD COLUMN rpe REAL');
  }

  // Same pattern for workout sync: pre-sync installs lack synced_at. NULL means
  // "not yet backed up to the server" — existing history is picked up by the
  // backlog drain on next app start.
  const workoutCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(workout_logs)');
  if (!workoutCols.some((c) => c.name === 'synced_at')) {
    await db.execAsync('ALTER TABLE workout_logs ADD COLUMN synced_at TEXT');
  }
  if (!workoutCols.some((c) => c.name === 'sync_error')) {
    await db.execAsync('ALTER TABLE workout_logs ADD COLUMN sync_error TEXT');
  }
  if (!workoutCols.some((c) => c.name === 'sync_failed_at')) {
    await db.execAsync('ALTER TABLE workout_logs ADD COLUMN sync_failed_at TEXT');
  }

  // Food-quality columns (Nutri-Score / NOVA / fiber / sugar / sodium) landed
  // after launch — older installs' foods table lacks them.
  const foodCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(foods)');
  if (!foodCols.some((c) => c.name === 'fiber_per_100')) {
    await db.execAsync(`
      ALTER TABLE foods ADD COLUMN fiber_per_100 REAL;
      ALTER TABLE foods ADD COLUMN sugar_per_100 REAL;
      ALTER TABLE foods ADD COLUMN sodium_per_100 REAL;
      ALTER TABLE foods ADD COLUMN nutri_score TEXT;
      ALTER TABLE foods ADD COLUMN nova_group INTEGER;
    `);
  }

  await migrateOwnerScope(db);
  let anonymousOwnerId = await loadAnonymousOwnerId(db);

  function createScoped(ownerId: string): Repo {
    assertUsableOwnerId(ownerId);
    return {
    async getTrainingCatalogCache() {
      const row = await db.getFirstAsync<{ catalog_json: string; fetched_at: string }>(
        'SELECT catalog_json, fetched_at FROM training_catalog_cache WHERE owner_id = ?',
        ownerId,
      );
      if (!row) return null;
      try {
        const parsed = trainingCatalogCacheSchema.safeParse({
          catalog: JSON.parse(row.catalog_json) as unknown,
          fetchedAt: row.fetched_at,
        });
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    async saveTrainingCatalogCache(cache: TrainingCatalogCache) {
      const validated = trainingCatalogCacheSchema.parse(cache);
      await db.runAsync(
        `INSERT INTO training_catalog_cache (owner_id, catalog_json, fetched_at)
         VALUES (?, ?, ?)
         ON CONFLICT(owner_id) DO UPDATE SET catalog_json = excluded.catalog_json,
           fetched_at = excluded.fetched_at`,
        ownerId,
        JSON.stringify(validated.catalog),
        validated.fetchedAt,
      );
    },

    // ── Workouts ────────────────────────────────────────────
    async startWorkout(w, blueprint) {
      await db.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync(
          'INSERT INTO workout_logs (owner_id, id, date, plan_workout_id, name, started_at) VALUES (?,?,?,?,?,?)',
          ownerId, w.id, w.date, w.planWorkoutId, w.name, w.startedAt,
        );
        if (blueprint) {
          await transaction.runAsync(
            `INSERT INTO workout_session_blueprints
             (owner_id, workout_log_id, blueprint_json) VALUES (?, ?, ?)`,
            ownerId,
            w.id,
            serializeWorkoutBlueprint(blueprint),
          );
        }
      });
    },
    async finishWorkout(id, finishedAt, durationSec) {
      await db.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync(
          'UPDATE workout_logs SET finished_at = ?, duration_sec = ? WHERE owner_id = ? AND id = ?',
          finishedAt, durationSec, ownerId, id,
        );
        await transaction.runAsync(
          'DELETE FROM workout_session_blueprints WHERE owner_id = ? AND workout_log_id = ?',
          ownerId,
          id,
        );
      });
    },
    async saveWorkoutBlueprint(id, blueprint) {
      await db.runAsync(
        `INSERT INTO workout_session_blueprints (owner_id, workout_log_id, blueprint_json)
         SELECT ?, ?, ? WHERE EXISTS (
           SELECT 1 FROM workout_logs
           WHERE owner_id = ? AND id = ? AND finished_at IS NULL
         )
         ON CONFLICT(owner_id, workout_log_id)
         DO UPDATE SET blueprint_json = excluded.blueprint_json`,
        ownerId,
        id,
        serializeWorkoutBlueprint(blueprint),
        ownerId,
        id,
      );
    },
    async getWorkoutBlueprint(id) {
      const row = await db.getFirstAsync<{ blueprint_json: string }>(
        `SELECT blueprint_json FROM workout_session_blueprints
         WHERE owner_id = ? AND workout_log_id = ?`,
        ownerId,
        id,
      );
      return row ? parseWorkoutBlueprintJson(row.blueprint_json) : null;
    },
    async deleteWorkout(id) {
      await db.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync(
          'DELETE FROM set_logs WHERE owner_id = ? AND workout_log_id = ?', ownerId, id,
        );
        await transaction.runAsync(
          'DELETE FROM workout_session_blueprints WHERE owner_id = ? AND workout_log_id = ?',
          ownerId,
          id,
        );
        await transaction.runAsync(
          'DELETE FROM workout_logs WHERE owner_id = ? AND id = ?', ownerId, id,
        );
      });
    },
    async getWorkout(id) {
      const r = await db.getFirstAsync<WorkoutRow>(
        'SELECT * FROM workout_logs WHERE owner_id = ? AND id = ?', ownerId, id,
      );
      return r ? toWorkout(r) : null;
    },
    async getActiveWorkout() {
      const r = await db.getFirstAsync<WorkoutRow>(
        `SELECT * FROM workout_logs WHERE owner_id = ? AND finished_at IS NULL
         ORDER BY started_at DESC LIMIT 1`,
        ownerId,
      );
      return r ? toWorkout(r) : null;
    },
    async getWorkoutsBetween(fromDate, toDate) {
      const rows = await db.getAllAsync<WorkoutRow>(
        `SELECT * FROM workout_logs WHERE owner_id = ? AND date >= ? AND date <= ?
         AND finished_at IS NOT NULL ORDER BY started_at DESC`,
        ownerId, fromDate, toDate,
      );
      return rows.map(toWorkout);
    },
    async getRecentWorkouts(limit) {
      const rows = await db.getAllAsync<WorkoutRow>(
        `SELECT * FROM workout_logs WHERE owner_id = ? AND finished_at IS NOT NULL
         ORDER BY started_at DESC LIMIT ?`,
        ownerId, limit,
      );
      return rows.map(toWorkout);
    },

    // ── Sets ────────────────────────────────────────────────
    async logSet(s) {
      await db.runAsync(
        'INSERT INTO set_logs (owner_id, id, workout_log_id, exercise_id, exercise_name, set_no, weight_kg, reps, rpe, is_pr, logged_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        ownerId, s.id, s.workoutLogId, s.exerciseId, s.exerciseName, s.setNo,
        s.weightKg, s.reps, s.rpe, s.isPr ? 1 : 0, s.loggedAt,
      );
    },
    async updateSet(s) {
      await db.runAsync(
        `UPDATE set_logs SET weight_kg = ?, reps = ?, rpe = ?, is_pr = ?
         WHERE owner_id = ? AND id = ?`,
        s.weightKg, s.reps, s.rpe, s.isPr ? 1 : 0, ownerId, s.id,
      );
    },
    async deleteSet(id) {
      await db.runAsync('DELETE FROM set_logs WHERE owner_id = ? AND id = ?', ownerId, id);
    },
    async getSetsForWorkout(workoutLogId) {
      const rows = await db.getAllAsync<SetRow>(
        `SELECT * FROM set_logs WHERE owner_id = ? AND workout_log_id = ?
         ORDER BY logged_at ASC`,
        ownerId, workoutLogId,
      );
      return rows.map(toSet);
    },
    async getLastSetsForExercise(exerciseId, excludeWorkoutId) {
      const last = await db.getFirstAsync<{ workout_log_id: string }>(
        `SELECT s.workout_log_id FROM set_logs s
         JOIN workout_logs w ON w.owner_id = s.owner_id AND w.id = s.workout_log_id
         WHERE s.owner_id = ? AND s.exercise_id = ? AND s.workout_log_id != ?
           AND w.finished_at IS NOT NULL
         ORDER BY s.logged_at DESC LIMIT 1`,
        ownerId, exerciseId, excludeWorkoutId,
      );
      if (!last) return [];
      const rows = await db.getAllAsync<SetRow>(
        `SELECT * FROM set_logs WHERE owner_id = ? AND workout_log_id = ?
         AND exercise_id = ? ORDER BY set_no ASC`,
        ownerId, last.workout_log_id, exerciseId,
      );
      return rows.map(toSet);
    },
    async getBestE1Rm(exerciseId, excludeWorkoutId) {
      const rows = await db.getAllAsync<{ weight_kg: number; reps: number }>(
        `SELECT weight_kg, reps FROM set_logs WHERE owner_id = ? AND exercise_id = ?
         AND workout_log_id != ? AND reps <= 12`,
        ownerId, exerciseId, excludeWorkoutId,
      );
      if (rows.length === 0) return null;
      return Math.max(...rows.map((r) => epley1Rm(r.weight_kg, r.reps)));
    },
    async getBestWeight(exerciseId, excludeWorkoutId) {
      const r = await db.getFirstAsync<{ m: number | null }>(
        `SELECT MAX(weight_kg) as m FROM set_logs WHERE owner_id = ? AND exercise_id = ?
         AND workout_log_id != ?`,
        ownerId, exerciseId, excludeWorkoutId,
      );
      return r?.m ?? null;
    },
    async getPrRecords(limit) {
      const rows = await db.getAllAsync<SetRow & { date: string }>(
        `SELECT s.*, w.date as date FROM set_logs s
         JOIN workout_logs w ON w.owner_id = s.owner_id AND w.id = s.workout_log_id
         WHERE s.owner_id = ? AND s.is_pr = 1 ORDER BY s.logged_at DESC LIMIT ?`,
        ownerId, limit,
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
         JOIN workout_logs w ON w.owner_id = s.owner_id AND w.id = s.workout_log_id
         WHERE s.owner_id = ? AND w.date >= ? AND w.date <= ?`,
        ownerId, fromDate, toDate,
      );
      return Math.round(r?.v ?? 0);
    },
    async getE1RmHistory(exerciseId, limit) {
      const rows = await db.getAllAsync<{ date: string; weight_kg: number; reps: number }>(
        `SELECT w.date as date, s.weight_kg, s.reps FROM set_logs s
         JOIN workout_logs w ON w.owner_id = s.owner_id AND w.id = s.workout_log_id
         WHERE s.owner_id = ? AND s.exercise_id = ? AND s.reps <= 12
           AND w.finished_at IS NOT NULL`,
        ownerId, exerciseId,
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
         WHERE owner_id = ? GROUP BY exercise_id ORDER BY last DESC LIMIT ?`,
        ownerId, limit,
      );
      return rows.map((r) => r.exercise_id);
    },
    async getSetsBetween(fromDate, toDate) {
      const rows = await db.getAllAsync<{
        exercise_id: string; exercise_name: string; weight_kg: number;
        reps: number; rpe: number | null; is_pr: number; workout_date: string;
      }>(
        `SELECT s.exercise_id, s.exercise_name, s.weight_kg, s.reps, s.rpe, s.is_pr, w.date as workout_date
         FROM set_logs s
         JOIN workout_logs w ON w.owner_id = s.owner_id AND w.id = s.workout_log_id
         WHERE s.owner_id = ? AND w.finished_at IS NOT NULL AND w.date >= ? AND w.date <= ?
         ORDER BY s.logged_at ASC`,
        ownerId, fromDate, toDate,
      );
      return rows.map(
        (r): AnalyticsSet => ({
          exerciseId: r.exercise_id,
          exerciseName: r.exercise_name,
          weightKg: r.weight_kg,
          reps: r.reps,
          rpe: r.rpe,
          isPr: r.is_pr === 1,
          workoutDate: r.workout_date,
        }),
      );
    },

    // ── Sync (one-way server backup) ────────────────────────
    async getUnsyncedFinishedWorkouts(limit) {
      const workouts = await db.getAllAsync<WorkoutRow>(
        `SELECT * FROM workout_logs
         WHERE owner_id = ? AND finished_at IS NOT NULL AND synced_at IS NULL
           AND sync_error IS NULL
         ORDER BY started_at ASC LIMIT ?`,
        ownerId, limit,
      );
      const out: { workout: WorkoutLog; sets: SetLog[] }[] = [];
      for (const w of workouts) {
        const rows = await db.getAllAsync<SetRow>(
          `SELECT * FROM set_logs WHERE owner_id = ? AND workout_log_id = ?
           ORDER BY logged_at ASC`,
          ownerId, w.id,
        );
        out.push({ workout: toWorkout(w), sets: rows.map(toSet) });
      }
      return out;
    },
    async markWorkoutsSynced(ids, syncedAt) {
      if (ids.length === 0) return;
      const placeholders = ids.map(() => '?').join(',');
      await db.runAsync(
        `UPDATE workout_logs SET synced_at = ?, sync_error = NULL, sync_failed_at = NULL
         WHERE owner_id = ? AND id IN (${placeholders})`,
        syncedAt, ownerId, ...ids,
      );
    },
    async markWorkoutSyncFailed(failure) {
      await db.runAsync(
        `UPDATE workout_logs SET sync_error = ?, sync_failed_at = ?
         WHERE owner_id = ? AND id = ? AND synced_at IS NULL`,
        failure.code,
        failure.failedAt,
        ownerId,
        failure.workoutId,
      );
    },
    async getWorkoutSyncFailures(limit) {
      const rows = await db.getAllAsync<{
        workout_id: string;
        code: string;
        failed_at: string;
      }>(
        `SELECT id AS workout_id, sync_error AS code, sync_failed_at AS failed_at
         FROM workout_logs
         WHERE owner_id = ? AND sync_error IS NOT NULL AND sync_failed_at IS NOT NULL
         ORDER BY sync_failed_at DESC LIMIT ?`,
        ownerId,
        limit,
      );
      return rows
        .filter((row) => row.code === 'invalid_payload')
        .map(
          (row): WorkoutSyncFailure => ({
            workoutId: row.workout_id,
            code: 'invalid_payload',
            failedAt: row.failed_at,
          }),
        );
    },

    // ── Body ────────────────────────────────────────────────
    async getPendingMemberDataMutations(limit) {
      const rows = await db.getAllAsync<MemberDataMutationRow>(
        `SELECT entity, record_id, mutation_id, changed_at, deleted, record_json
         FROM member_data_mutations WHERE owner_id = ?
         ORDER BY changed_at ASC, mutation_id ASC LIMIT ?`,
        ownerId,
        limit,
      );
      return rows
        .map(memberDataMutationFromRow)
        .filter((mutation): mutation is MemberDataMutation => mutation !== null);
    },
    async getMemberDataSyncCursor() {
      const row = await db.getFirstAsync<{ cursor_json: string }>(
        'SELECT cursor_json FROM member_data_sync_state WHERE owner_id = ?',
        ownerId,
      );
      if (!row) return { ...EMPTY_MEMBER_DATA_SYNC_CURSOR };
      try {
        const parsed = memberDataSyncCursorSchema.safeParse(JSON.parse(row.cursor_json) as unknown);
        return parsed.success ? parsed.data : { ...EMPTY_MEMBER_DATA_SYNC_CURSOR };
      } catch {
        return { ...EMPTY_MEMBER_DATA_SYNC_CURSOR };
      }
    },
    async applyMemberDataSyncResponse(response) {
      await db.withExclusiveTransactionAsync(async (transaction) => {
        const pendingRows = await transaction.getAllAsync<MemberDataMutationRow>(
          `SELECT entity, record_id, mutation_id, changed_at, deleted, record_json
           FROM member_data_mutations WHERE owner_id = ?`,
          ownerId,
        );
        const pendingByKey = new Map<string, MemberDataMutation>();
        for (const row of pendingRows) {
          const pending = memberDataMutationFromRow(row);
          if (pending) pendingByKey.set(`${row.entity}:${row.record_id}`, pending);
        }

        if (response.acknowledgedMutationIds.length > 0) {
          const placeholders = response.acknowledgedMutationIds.map(() => '?').join(',');
          await transaction.runAsync(
            `DELETE FROM member_data_mutations
             WHERE owner_id = ? AND mutation_id IN (${placeholders})`,
            ownerId,
            ...response.acknowledgedMutationIds,
          );
        }

        for (const item of response.changes) {
          const recordId = memberDataRecordId(item.record);
          const key = `${item.record.entity}:${recordId}`;
          const pending = pendingByKey.get(key);
          if (pending && compareMemberDataVersions(pending, item) > 0) continue;
          await applyMemberDataChange(transaction, ownerId, item);
          if (pending) {
            await transaction.runAsync(
              `DELETE FROM member_data_mutations
               WHERE owner_id = ? AND entity = ? AND record_id = ?`,
              ownerId,
              item.record.entity,
              recordId,
            );
          }
        }

        await transaction.runAsync(
          `INSERT INTO member_data_sync_state (owner_id, cursor_json) VALUES (?, ?)
           ON CONFLICT(owner_id) DO UPDATE SET cursor_json=excluded.cursor_json`,
          ownerId,
          JSON.stringify(response.cursor),
        );
      });
    },

    async upsertWeight(w) {
      await db.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync(
          `INSERT INTO weight_logs (owner_id, id, date, kg) VALUES (?,?,?,?)
           ON CONFLICT(owner_id, date) DO UPDATE SET id = excluded.id, kg = excluded.kg`,
          ownerId,
          w.id,
          w.date,
          w.kg,
        );
        await queueMemberDataMutation(transaction, ownerId, { entity: 'weight', value: w });
      });
      notifyMemberDataChanged();
    },
    async getWeights(limitDays) {
      const rows = await db.getAllAsync<{ id: string; date: string; kg: number }>(
        'SELECT * FROM weight_logs WHERE owner_id = ? ORDER BY date DESC LIMIT ?',
        ownerId, limitDays,
      );
      return rows.reverse().map((r): WeightLog => ({ id: r.id, date: r.date, kg: r.kg }));
    },
    async addMeasurement(m) {
      await db.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync(
          `INSERT INTO measurements
           (owner_id, id, date, waist_cm, chest_cm, arm_cm, hip_cm, thigh_cm)
           VALUES (?,?,?,?,?,?,?,?)`,
          ownerId,
          m.id,
          m.date,
          m.waistCm,
          m.chestCm,
          m.armCm,
          m.hipCm,
          m.thighCm,
        );
        await queueMemberDataMutation(transaction, ownerId, {
          entity: 'measurement',
          value: m,
        });
      });
      notifyMemberDataChanged();
    },
    async getMeasurements(limit) {
      const rows = await db.getAllAsync<{
        id: string; date: string; waist_cm: number | null; chest_cm: number | null;
        arm_cm: number | null; hip_cm: number | null; thigh_cm: number | null;
        // rowid tiebreak: a same-day correction (newer insert) must outrank
        // the row it replaces everywhere "latest per field" is derived.
      }>(
        `SELECT * FROM measurements WHERE owner_id = ?
         ORDER BY date DESC, rowid DESC LIMIT ?`,
        ownerId, limit,
      );
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
      await db.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync(
          `INSERT INTO food_logs
           (owner_id, id, date, meal, food_id, food_name, grams, kcal, protein, carbs, fat, logged_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          ownerId,
          f.id,
          f.date,
          f.meal,
          f.foodId,
          f.foodName,
          f.grams,
          f.kcal,
          f.protein,
          f.carbs,
          f.fat,
          new Date().toISOString(),
        );
        await queueMemberDataMutation(transaction, ownerId, { entity: 'foodLog', value: f });
      });
      notifyMemberDataChanged();
    },
    async logFoodBatch(logs) {
      if (logs.length === 0) return;
      const loggedAt = new Date().toISOString();
      // Fixes B19 — one exclusive transaction, so a failure partway through
      // (e.g. a duplicate id) rolls the WHOLE batch back instead of leaving
      // a half-copied day with no indication anything went wrong.
      await db.withExclusiveTransactionAsync(async (transaction) => {
        for (const f of logs) {
          await transaction.runAsync(
            `INSERT INTO food_logs
             (owner_id, id, date, meal, food_id, food_name, grams, kcal, protein, carbs, fat, logged_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            ownerId, f.id, f.date, f.meal, f.foodId, f.foodName, f.grams,
            f.kcal, f.protein, f.carbs, f.fat, loggedAt,
          );
          await queueMemberDataMutation(transaction, ownerId, {
            entity: 'foodLog',
            value: f,
          });
        }
      });
      notifyMemberDataChanged();
    },
    async deleteFoodLog(id) {
      let found = false;
      await db.withExclusiveTransactionAsync(async (transaction) => {
        const row = await transaction.getFirstAsync<FoodLogRow>(
          'SELECT * FROM food_logs WHERE owner_id = ? AND id = ?',
          ownerId,
          id,
        );
        if (!row) return;
        found = true;
        await transaction.runAsync(
          'DELETE FROM food_logs WHERE owner_id = ? AND id = ?',
          ownerId,
          id,
        );
        await queueMemberDataMutation(
          transaction,
          ownerId,
          { entity: 'foodLog', value: toFoodLog(row) },
          true,
        );
      });
      if (found) notifyMemberDataChanged();
    },
    async getFoodLogs(date) {
      const rows = await db.getAllAsync<FoodLogRow>(
        'SELECT * FROM food_logs WHERE owner_id = ? AND date = ? ORDER BY logged_at ASC',
        ownerId, date,
      );
      return rows.map(toFoodLog);
    },
    async getKcalByDate(dates) {
      const out: Record<string, number> = {};
      for (const d of dates) out[d] = 0;
      if (dates.length === 0) return out;
      const placeholders = dates.map(() => '?').join(',');
      const rows = await db.getAllAsync<{ date: string; k: number }>(
        `SELECT date, SUM(kcal) as k FROM food_logs
         WHERE owner_id = ? AND date IN (${placeholders}) GROUP BY date`,
        ownerId, ...dates,
      );
      for (const r of rows) out[r.date] = Math.round(r.k);
      return out;
    },
    async getMacrosByDate(dates) {
      const out: Record<string, DailyMacros> = {};
      for (const d of dates) out[d] = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
      if (dates.length === 0) return out;
      const placeholders = dates.map(() => '?').join(',');
      const rows = await db.getAllAsync<{ date: string; k: number; p: number; c: number; f: number }>(
        `SELECT date, SUM(kcal) as k, SUM(protein) as p, SUM(carbs) as c, SUM(fat) as f
         FROM food_logs WHERE owner_id = ? AND date IN (${placeholders}) GROUP BY date`,
        ownerId, ...dates,
      );
      for (const r of rows) {
        out[r.date] = {
          kcal: Math.round(r.k),
          protein: Math.round(r.p),
          carbs: Math.round(r.c),
          fat: Math.round(r.f),
        };
      }
      return out;
    },
    async saveFood(item) {
      await db.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync(
          `INSERT INTO foods (owner_id, id, name, brand, source, barcode, kcal_per_100, protein_per_100, carbs_per_100, fat_per_100, serving_grams, serving_label,
             fiber_per_100, sugar_per_100, sodium_per_100, nutri_score, nova_group)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(owner_id, id) DO UPDATE SET name=excluded.name, brand=excluded.brand,
             source=excluded.source, barcode=excluded.barcode,
             kcal_per_100=excluded.kcal_per_100, protein_per_100=excluded.protein_per_100,
             carbs_per_100=excluded.carbs_per_100, fat_per_100=excluded.fat_per_100,
             serving_grams=excluded.serving_grams, serving_label=excluded.serving_label,
             fiber_per_100=excluded.fiber_per_100, sugar_per_100=excluded.sugar_per_100,
             sodium_per_100=excluded.sodium_per_100, nutri_score=excluded.nutri_score,
             nova_group=excluded.nova_group`,
          ownerId,
          item.id,
          item.name,
          item.brand,
          item.source,
          item.barcode,
          item.kcalPer100,
          item.proteinPer100,
          item.carbsPer100,
          item.fatPer100,
          item.servingGrams,
          item.servingLabel,
          item.fiberPer100 ?? null,
          item.sugarPer100 ?? null,
          item.sodiumPer100 ?? null,
          item.nutriScore ?? null,
          item.novaGroup ?? null,
        );
        if (item.source === 'custom') {
          await queueMemberDataMutation(transaction, ownerId, {
            entity: 'food',
            value: item,
          });
        }
      });
      if (item.source === 'custom') notifyMemberDataChanged();
    },
    async getFoodByBarcode(barcode) {
      const r = await db.getFirstAsync<FoodRow>(
        'SELECT * FROM foods WHERE owner_id = ? AND barcode = ?', ownerId, barcode,
      );
      return r ? toFood(r) : null;
    },
    async getFood(id) {
      const r = await db.getFirstAsync<FoodRow>(
        'SELECT * FROM foods WHERE owner_id = ? AND id = ?', ownerId, id,
      );
      return r ? toFood(r) : null;
    },
    async searchLocalFoods(query, limit) {
      const rows = await db.getAllAsync<FoodRow>(
        'SELECT * FROM foods WHERE owner_id = ? AND name LIKE ? ORDER BY name LIMIT ?',
        ownerId, `%${query}%`, limit,
      );
      return rows.map(toFood);
    },
    async getRecentFoods(limit) {
      const rows = await db.getAllAsync<FoodRow>(
        `SELECT f.* FROM foods f
         JOIN (SELECT food_id, MAX(logged_at) as last FROM food_logs
               WHERE owner_id = ? GROUP BY food_id) fl
           ON fl.food_id = f.id
         WHERE f.owner_id = ? ORDER BY fl.last DESC LIMIT ?`,
        ownerId, ownerId, limit,
      );
      return rows.map(toFood);
    },
    async toggleFavoriteFood(foodId) {
      const existing = await db.getFirstAsync<{ food_id: string }>(
        'SELECT food_id FROM food_favorites WHERE owner_id = ? AND food_id = ?',
        ownerId, foodId,
      );
      if (existing) {
        await db.runAsync(
          'DELETE FROM food_favorites WHERE owner_id = ? AND food_id = ?', ownerId, foodId,
        );
        return false;
      }
      await db.runAsync(
        `INSERT INTO food_favorites (owner_id, food_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT(owner_id, food_id) DO NOTHING`,
        ownerId, foodId, new Date().toISOString(),
      );
      return true;
    },
    async isFavoriteFood(foodId) {
      const row = await db.getFirstAsync<{ food_id: string }>(
        'SELECT food_id FROM food_favorites WHERE owner_id = ? AND food_id = ?',
        ownerId, foodId,
      );
      return row !== null;
    },
    async getFavoriteFoods(limit) {
      const rows = await db.getAllAsync<FoodRow>(
        `SELECT f.* FROM foods f
         JOIN food_favorites fav ON fav.owner_id = f.owner_id AND fav.food_id = f.id
         WHERE f.owner_id = ? ORDER BY fav.created_at DESC LIMIT ?`,
        ownerId, limit,
      );
      return rows.map(toFood);
    },

    // ── Water ───────────────────────────────────────────────
    async getWaterMl(date) {
      const r = await db.getFirstAsync<{ ml: number }>(
        'SELECT ml FROM water_logs WHERE owner_id = ? AND date = ?', ownerId, date,
      );
      return r?.ml ?? 0;
    },
    async addWater(date, deltaMl) {
      let nextMl = 0;
      await db.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync(
          `INSERT INTO water_logs (owner_id, date, ml) VALUES (?, ?, MAX(0, ?))
           ON CONFLICT(owner_id, date) DO UPDATE SET ml = MAX(0, water_logs.ml + ?)`,
          ownerId,
          date,
          deltaMl,
          deltaMl,
        );
        const row = await transaction.getFirstAsync<{ ml: number }>(
          'SELECT ml FROM water_logs WHERE owner_id = ? AND date = ?',
          ownerId,
          date,
        );
        nextMl = row?.ml ?? 0;
        await queueMemberDataMutation(transaction, ownerId, {
          entity: 'water',
          value: { date, ml: nextMl },
        });
      });
      notifyMemberDataChanged();
      return nextMl;
    },

    // ── Steps ───────────────────────────────────────────────
    async getSteps(date) {
      const r = await db.getFirstAsync<{ steps: number }>(
        'SELECT steps FROM step_logs WHERE owner_id = ? AND date = ?', ownerId, date,
      );
      return r?.steps ?? 0;
    },
    async setSteps(date, steps) {
      const nextSteps = Math.max(0, steps);
      await db.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync(
          `INSERT INTO step_logs (owner_id, date, steps) VALUES (?, ?, ?)
           ON CONFLICT(owner_id, date) DO UPDATE SET steps = excluded.steps`,
          ownerId,
          date,
          nextSteps,
        );
        await queueMemberDataMutation(transaction, ownerId, {
          entity: 'steps',
          value: { date, steps: nextSteps },
        });
      });
      notifyMemberDataChanged();
    },
    async addSteps(date, delta) {
      let nextSteps = 0;
      await db.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync(
          `INSERT INTO step_logs (owner_id, date, steps) VALUES (?, ?, MAX(0, ?))
           ON CONFLICT(owner_id, date) DO UPDATE SET steps = MAX(0, step_logs.steps + ?)`,
          ownerId,
          date,
          delta,
          delta,
        );
        const row = await transaction.getFirstAsync<{ steps: number }>(
          'SELECT steps FROM step_logs WHERE owner_id = ? AND date = ?',
          ownerId,
          date,
        );
        nextSteps = row?.steps ?? 0;
        await queueMemberDataMutation(transaction, ownerId, {
          entity: 'steps',
          value: { date, steps: nextSteps },
        });
      });
      notifyMemberDataChanged();
      return nextSteps;
    },
    async getStepsBetween(startDate, endDate) {
      return db.getAllAsync<{ date: string; steps: number }>(
        `SELECT date, steps FROM step_logs WHERE owner_id = ? AND date >= ? AND date <= ?
         ORDER BY date ASC`,
        ownerId, startDate, endDate,
      );
    },

    // ── Streak ──────────────────────────────────────────────
    async getStreak() {
      const r = await db.getFirstAsync<{
        current: number; best: number; last_workout_date: string | null;
      }>(
        'SELECT current, best, last_workout_date FROM streaks WHERE owner_id = ? AND id = 1',
        ownerId,
      );
      return {
        current: r?.current ?? 0,
        best: r?.best ?? 0,
        lastWorkoutDate: r?.last_workout_date ?? null,
      } satisfies Streak;
    },
    async setStreak(s) {
      await db.runAsync(
        `INSERT INTO streaks (owner_id, id, current, best, last_workout_date)
         VALUES (?, 1, ?, ?, ?)
         ON CONFLICT(owner_id, id) DO UPDATE SET current = excluded.current,
           best = excluded.best, last_workout_date = excluded.last_workout_date`,
        ownerId, s.current, s.best, s.lastWorkoutDate,
      );
    },
    };
  }

  const repos = new Map<string, Repo>();
  return {
    getAnonymousOwnerId() {
      return anonymousOwnerId;
    },
    async setAnonymousOwnerId(ownerId) {
      assertAnonymousOwnerId(ownerId);
      await db.runAsync(
        `INSERT INTO repo_meta (key, value) VALUES ('anonymous_owner_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ownerId,
      );
      anonymousOwnerId = ownerId;
    },
    forOwner(ownerId) {
      assertUsableOwnerId(ownerId);
      const cached = repos.get(ownerId);
      if (cached) return cached;
      const repo = createScoped(ownerId);
      repos.set(ownerId, repo);
      return repo;
    },
    async deleteOwnerData(ownerId) {
      assertUsableOwnerId(ownerId);
      await db.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync('DELETE FROM training_catalog_cache WHERE owner_id = ?', ownerId);
        await transaction.runAsync('DELETE FROM member_data_mutations WHERE owner_id = ?', ownerId);
        await transaction.runAsync('DELETE FROM member_data_sync_state WHERE owner_id = ?', ownerId);
        await transaction.runAsync('DELETE FROM set_logs WHERE owner_id = ?', ownerId);
        await transaction.runAsync(
          'DELETE FROM workout_session_blueprints WHERE owner_id = ?', ownerId,
        );
        await transaction.runAsync('DELETE FROM workout_logs WHERE owner_id = ?', ownerId);
        await transaction.runAsync('DELETE FROM weight_logs WHERE owner_id = ?', ownerId);
        await transaction.runAsync('DELETE FROM measurements WHERE owner_id = ?', ownerId);
        await transaction.runAsync('DELETE FROM food_logs WHERE owner_id = ?', ownerId);
        await transaction.runAsync('DELETE FROM food_favorites WHERE owner_id = ?', ownerId);
        await transaction.runAsync('DELETE FROM foods WHERE owner_id = ?', ownerId);
        await transaction.runAsync('DELETE FROM water_logs WHERE owner_id = ?', ownerId);
        await transaction.runAsync('DELETE FROM step_logs WHERE owner_id = ?', ownerId);
        await transaction.runAsync('DELETE FROM streaks WHERE owner_id = ?', ownerId);
      });
      repos.delete(ownerId);
    },
  };
}
