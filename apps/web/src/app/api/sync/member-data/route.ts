import {
  memberFoodLogs,
  memberFoods,
  memberMeasurements,
  memberStepLogs,
  memberWaterLogs,
  memberWeightLogs,
} from '@gym/db';
import {
  memberDataRecordId,
  memberDataSyncRequestSchema,
  memberDataSyncResponseSchema,
  type MemberDataChange,
  type MemberDataCursorPoint,
  type MemberDataEntity,
  type MemberDataMutation,
  type MemberDataRecord,
  type MemberDataSyncCursor,
} from '@gym/shared';
import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

const PULL_LIMIT_PER_ENTITY = 100;

type VersionedMutation = Pick<MemberDataMutation, 'mutationId' | 'changedAt' | 'deleted'>;

function versionFields(mutation: VersionedMutation, updatedAt: Date) {
  return {
    clientChangedAt: new Date(mutation.changedAt),
    mutationId: mutation.mutationId,
    deleted: mutation.deleted,
    updatedAt,
  };
}

/** Existing rows change only when the incoming deterministic LWW tuple wins. */
function incomingWins(
  clientChangedAt: { name: string },
  mutationId: { name: string },
  mutation: VersionedMutation,
) {
  return sql`(${sql.identifier(clientChangedAt.name)}, ${sql.identifier(mutationId.name)}) < (${new Date(
    mutation.changedAt,
  )}, ${mutation.mutationId})`;
}

async function applyMutation(accountId: string, mutation: MemberDataMutation): Promise<void> {
  const db = getDb();
  const now = new Date();
  const sync = versionFields(mutation, now);
  const { record } = mutation;

  switch (record.entity) {
    case 'weight': {
      const value = record.value;
      await db
        .insert(memberWeightLogs)
        .values({ accountId, ...value, ...sync })
        .onConflictDoUpdate({
          target: [memberWeightLogs.accountId, memberWeightLogs.date],
          set: { id: value.id, kg: value.kg, ...sync },
          setWhere: incomingWins(
            memberWeightLogs.clientChangedAt,
            memberWeightLogs.mutationId,
            mutation,
          ),
        });
      return;
    }
    case 'measurement': {
      const value = record.value;
      await db
        .insert(memberMeasurements)
        .values({ accountId, ...value, ...sync })
        .onConflictDoUpdate({
          target: [memberMeasurements.accountId, memberMeasurements.id],
          set: { ...value, ...sync },
          setWhere: incomingWins(
            memberMeasurements.clientChangedAt,
            memberMeasurements.mutationId,
            mutation,
          ),
        });
      return;
    }
    case 'food': {
      const value = record.value;
      await db
        .insert(memberFoods)
        .values({
          accountId,
          ...value,
          fiberPer100: value.fiberPer100 ?? null,
          sugarPer100: value.sugarPer100 ?? null,
          sodiumPer100: value.sodiumPer100 ?? null,
          nutriScore: value.nutriScore ?? null,
          novaGroup: value.novaGroup ?? null,
          ...sync,
        })
        .onConflictDoUpdate({
          target: [memberFoods.accountId, memberFoods.id],
          set: {
            ...value,
            fiberPer100: value.fiberPer100 ?? null,
            sugarPer100: value.sugarPer100 ?? null,
            sodiumPer100: value.sodiumPer100 ?? null,
            nutriScore: value.nutriScore ?? null,
            novaGroup: value.novaGroup ?? null,
            ...sync,
          },
          setWhere: incomingWins(memberFoods.clientChangedAt, memberFoods.mutationId, mutation),
        });
      return;
    }
    case 'foodLog': {
      const value = record.value;
      await db
        .insert(memberFoodLogs)
        .values({ accountId, ...value, ...sync })
        .onConflictDoUpdate({
          target: [memberFoodLogs.accountId, memberFoodLogs.id],
          set: { ...value, ...sync },
          setWhere: incomingWins(
            memberFoodLogs.clientChangedAt,
            memberFoodLogs.mutationId,
            mutation,
          ),
        });
      return;
    }
    case 'water': {
      const value = record.value;
      await db
        .insert(memberWaterLogs)
        .values({ accountId, ...value, ...sync })
        .onConflictDoUpdate({
          target: [memberWaterLogs.accountId, memberWaterLogs.date],
          set: { ml: value.ml, ...sync },
          setWhere: incomingWins(
            memberWaterLogs.clientChangedAt,
            memberWaterLogs.mutationId,
            mutation,
          ),
        });
      return;
    }
    case 'steps': {
      const value = record.value;
      await db
        .insert(memberStepLogs)
        .values({ accountId, ...value, ...sync })
        .onConflictDoUpdate({
          target: [memberStepLogs.accountId, memberStepLogs.date],
          set: { steps: value.steps, ...sync },
          setWhere: incomingWins(
            memberStepLogs.clientChangedAt,
            memberStepLogs.mutationId,
            mutation,
          ),
        });
    }
  }
}

function cursorCondition(
  updatedAt: typeof memberWeightLogs.updatedAt,
  recordId: typeof memberWeightLogs.date,
  cursor: MemberDataCursorPoint | null,
) {
  if (cursor === null) return undefined;
  const at = new Date(cursor.serverUpdatedAt);
  return or(gt(updatedAt, at), and(eq(updatedAt, at), gt(recordId, cursor.recordId)));
}

interface EntityPage {
  changes: MemberDataChange[];
  cursor: MemberDataCursorPoint | null;
  hasMore: boolean;
}

function finishPage(
  rows: MemberDataChange[],
  previousCursor: MemberDataCursorPoint | null,
): EntityPage {
  const hasMore = rows.length > PULL_LIMIT_PER_ENTITY;
  const changes = rows.slice(0, PULL_LIMIT_PER_ENTITY);
  const last = changes[changes.length - 1];
  return {
    changes,
    cursor: last
      ? { serverUpdatedAt: last.serverUpdatedAt, recordId: memberDataRecordId(last.record) }
      : previousCursor,
    hasMore,
  };
}

function change(
  row: {
    mutationId: string;
    clientChangedAt: Date;
    deleted: boolean;
    updatedAt: Date;
  },
  record: MemberDataRecord,
): MemberDataChange {
  return {
    mutationId: row.mutationId,
    changedAt: row.clientChangedAt.toISOString(),
    deleted: row.deleted,
    record,
    serverUpdatedAt: row.updatedAt.toISOString(),
  };
}

async function pullWeight(accountId: string, cursor: MemberDataCursorPoint | null) {
  const rows = await getDb()
    .select()
    .from(memberWeightLogs)
    .where(and(eq(memberWeightLogs.accountId, accountId), cursorCondition(memberWeightLogs.updatedAt, memberWeightLogs.date, cursor)))
    .orderBy(asc(memberWeightLogs.updatedAt), asc(memberWeightLogs.date))
    .limit(PULL_LIMIT_PER_ENTITY + 1);
  return finishPage(
    rows.map((row) =>
      change(row, { entity: 'weight', value: { id: row.id, date: row.date, kg: row.kg } }),
    ),
    cursor,
  );
}

async function pullMeasurements(accountId: string, cursor: MemberDataCursorPoint | null) {
  const rows = await getDb()
    .select()
    .from(memberMeasurements)
    .where(and(eq(memberMeasurements.accountId, accountId), cursorCondition(memberMeasurements.updatedAt, memberMeasurements.id, cursor)))
    .orderBy(asc(memberMeasurements.updatedAt), asc(memberMeasurements.id))
    .limit(PULL_LIMIT_PER_ENTITY + 1);
  return finishPage(
    rows.map((row) =>
      change(row, {
        entity: 'measurement',
        value: {
          id: row.id,
          date: row.date,
          waistCm: row.waistCm,
          chestCm: row.chestCm,
          armCm: row.armCm,
          hipCm: row.hipCm,
          thighCm: row.thighCm,
        },
      }),
    ),
    cursor,
  );
}

async function pullFoods(accountId: string, cursor: MemberDataCursorPoint | null) {
  const rows = await getDb()
    .select()
    .from(memberFoods)
    .where(and(eq(memberFoods.accountId, accountId), cursorCondition(memberFoods.updatedAt, memberFoods.id, cursor)))
    .orderBy(asc(memberFoods.updatedAt), asc(memberFoods.id))
    .limit(PULL_LIMIT_PER_ENTITY + 1);
  return finishPage(
    rows.map((row) =>
      change(row, {
        entity: 'food',
        value: {
          id: row.id,
          name: row.name,
          brand: row.brand,
          source: 'custom',
          barcode: row.barcode,
          kcalPer100: row.kcalPer100,
          proteinPer100: row.proteinPer100,
          carbsPer100: row.carbsPer100,
          fatPer100: row.fatPer100,
          servingGrams: row.servingGrams,
          servingLabel: row.servingLabel,
          fiberPer100: row.fiberPer100,
          sugarPer100: row.sugarPer100,
          sodiumPer100: row.sodiumPer100,
          nutriScore: row.nutriScore,
          novaGroup:
            row.novaGroup === 1 || row.novaGroup === 2 || row.novaGroup === 3 || row.novaGroup === 4
              ? row.novaGroup
              : null,
        },
      }),
    ),
    cursor,
  );
}

async function pullFoodLogs(accountId: string, cursor: MemberDataCursorPoint | null) {
  const rows = await getDb()
    .select()
    .from(memberFoodLogs)
    .where(and(eq(memberFoodLogs.accountId, accountId), cursorCondition(memberFoodLogs.updatedAt, memberFoodLogs.id, cursor)))
    .orderBy(asc(memberFoodLogs.updatedAt), asc(memberFoodLogs.id))
    .limit(PULL_LIMIT_PER_ENTITY + 1);
  return finishPage(
    rows.map((row) =>
      change(row, {
        entity: 'foodLog',
        value: {
          id: row.id,
          date: row.date,
          meal: row.meal,
          foodId: row.foodId,
          foodName: row.foodName,
          grams: row.grams,
          kcal: row.kcal,
          protein: row.protein,
          carbs: row.carbs,
          fat: row.fat,
        },
      }),
    ),
    cursor,
  );
}

async function pullWater(accountId: string, cursor: MemberDataCursorPoint | null) {
  const rows = await getDb()
    .select()
    .from(memberWaterLogs)
    .where(and(eq(memberWaterLogs.accountId, accountId), cursorCondition(memberWaterLogs.updatedAt, memberWaterLogs.date, cursor)))
    .orderBy(asc(memberWaterLogs.updatedAt), asc(memberWaterLogs.date))
    .limit(PULL_LIMIT_PER_ENTITY + 1);
  return finishPage(
    rows.map((row) => change(row, { entity: 'water', value: { date: row.date, ml: row.ml } })),
    cursor,
  );
}

async function pullSteps(accountId: string, cursor: MemberDataCursorPoint | null) {
  const rows = await getDb()
    .select()
    .from(memberStepLogs)
    .where(and(eq(memberStepLogs.accountId, accountId), cursorCondition(memberStepLogs.updatedAt, memberStepLogs.date, cursor)))
    .orderBy(asc(memberStepLogs.updatedAt), asc(memberStepLogs.date))
    .limit(PULL_LIMIT_PER_ENTITY + 1);
  return finishPage(
    rows.map((row) =>
      change(row, { entity: 'steps', value: { date: row.date, steps: row.steps } }),
    ),
    cursor,
  );
}

function groupSubmittedRecordIds(mutations: MemberDataMutation[]): Record<MemberDataEntity, string[]> {
  const grouped: Record<MemberDataEntity, Set<string>> = {
    weight: new Set(),
    measurement: new Set(),
    food: new Set(),
    foodLog: new Set(),
    water: new Set(),
    steps: new Set(),
  };
  for (const mutation of mutations) {
    grouped[mutation.record.entity].add(memberDataRecordId(mutation.record));
  }
  return {
    weight: [...grouped.weight],
    measurement: [...grouped.measurement],
    food: [...grouped.food],
    foodLog: [...grouped.foodLog],
    water: [...grouped.water],
    steps: [...grouped.steps],
  };
}

/** Return current winners for submitted keys, even when they precede the pull cursor. */
async function resolvedSubmittedChanges(
  accountId: string,
  mutations: MemberDataMutation[],
): Promise<MemberDataChange[]> {
  const ids = groupSubmittedRecordIds(mutations);
  const [weights, measurements, foods, foodLogs, water, steps] = await Promise.all([
    ids.weight.length === 0
      ? []
      : getDb().select().from(memberWeightLogs).where(and(eq(memberWeightLogs.accountId, accountId), inArray(memberWeightLogs.date, ids.weight))),
    ids.measurement.length === 0
      ? []
      : getDb().select().from(memberMeasurements).where(and(eq(memberMeasurements.accountId, accountId), inArray(memberMeasurements.id, ids.measurement))),
    ids.food.length === 0
      ? []
      : getDb().select().from(memberFoods).where(and(eq(memberFoods.accountId, accountId), inArray(memberFoods.id, ids.food))),
    ids.foodLog.length === 0
      ? []
      : getDb().select().from(memberFoodLogs).where(and(eq(memberFoodLogs.accountId, accountId), inArray(memberFoodLogs.id, ids.foodLog))),
    ids.water.length === 0
      ? []
      : getDb().select().from(memberWaterLogs).where(and(eq(memberWaterLogs.accountId, accountId), inArray(memberWaterLogs.date, ids.water))),
    ids.steps.length === 0
      ? []
      : getDb().select().from(memberStepLogs).where(and(eq(memberStepLogs.accountId, accountId), inArray(memberStepLogs.date, ids.steps))),
  ]);

  return [
    ...weights.map((row) =>
      change(row, { entity: 'weight', value: { id: row.id, date: row.date, kg: row.kg } }),
    ),
    ...measurements.map((row) =>
      change(row, {
        entity: 'measurement',
        value: {
          id: row.id,
          date: row.date,
          waistCm: row.waistCm,
          chestCm: row.chestCm,
          armCm: row.armCm,
          hipCm: row.hipCm,
          thighCm: row.thighCm,
        },
      }),
    ),
    ...foods.map((row) =>
      change(row, {
        entity: 'food',
        value: {
          id: row.id,
          name: row.name,
          brand: row.brand,
          source: 'custom',
          barcode: row.barcode,
          kcalPer100: row.kcalPer100,
          proteinPer100: row.proteinPer100,
          carbsPer100: row.carbsPer100,
          fatPer100: row.fatPer100,
          servingGrams: row.servingGrams,
          servingLabel: row.servingLabel,
          fiberPer100: row.fiberPer100,
          sugarPer100: row.sugarPer100,
          sodiumPer100: row.sodiumPer100,
          nutriScore: row.nutriScore,
          novaGroup:
            row.novaGroup === 1 || row.novaGroup === 2 || row.novaGroup === 3 || row.novaGroup === 4
              ? row.novaGroup
              : null,
        },
      }),
    ),
    ...foodLogs.map((row) =>
      change(row, {
        entity: 'foodLog',
        value: {
          id: row.id,
          date: row.date,
          meal: row.meal,
          foodId: row.foodId,
          foodName: row.foodName,
          grams: row.grams,
          kcal: row.kcal,
          protein: row.protein,
          carbs: row.carbs,
          fat: row.fat,
        },
      }),
    ),
    ...water.map((row) =>
      change(row, { entity: 'water', value: { date: row.date, ml: row.ml } }),
    ),
    ...steps.map((row) =>
      change(row, { entity: 'steps', value: { date: row.date, steps: row.steps } }),
    ),
  ];
}

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'sync/member-data',
    limit: 240,
    windowMs: 60 * 60 * 1_000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = memberDataSyncRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { cursor, mutations } = parsed.data;

  // Each row is independently idempotent. If a request fails halfway, the
  // client receives no acknowledgements and safely retries the entire batch.
  for (const mutation of mutations) await applyMutation(user.id, mutation);

  const [weight, measurement, food, foodLog, water, steps, resolved] = await Promise.all([
    pullWeight(user.id, cursor.weight),
    pullMeasurements(user.id, cursor.measurement),
    pullFoods(user.id, cursor.food),
    pullFoodLogs(user.id, cursor.foodLog),
    pullWater(user.id, cursor.water),
    pullSteps(user.id, cursor.steps),
    resolvedSubmittedChanges(user.id, mutations),
  ]);

  const nextCursor: MemberDataSyncCursor = {
    weight: weight.cursor,
    measurement: measurement.cursor,
    food: food.cursor,
    foodLog: foodLog.cursor,
    water: water.cursor,
    steps: steps.cursor,
  };

  // Submitted-key winners may duplicate the cursor page. Keep one canonical
  // copy per entity/key, preferring the newest deterministic version.
  const byRecord = new Map<string, MemberDataChange>();
  for (const item of [
    ...weight.changes,
    ...measurement.changes,
    ...food.changes,
    ...foodLog.changes,
    ...water.changes,
    ...steps.changes,
    ...resolved,
  ]) {
    byRecord.set(`${item.record.entity}:${memberDataRecordId(item.record)}`, item);
  }

  const response = memberDataSyncResponseSchema.parse({
    ok: true,
    acknowledgedMutationIds: mutations.map((mutation) => mutation.mutationId),
    changes: [...byRecord.values()],
    cursor: nextCursor,
    hasMore:
      weight.hasMore ||
      measurement.hasMore ||
      food.hasMore ||
      foodLog.hasMore ||
      water.hasMore ||
      steps.hasMore,
  });
  return json(response, 200);
}
