import { z } from 'zod';

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoTimestampSchema = z.string().datetime({ offset: true });
const recordIdSchema = z.string().min(1).max(128);
const finiteNonNegativeSchema = z.number().finite().min(0);

export const memberDataEntitySchema = z.enum([
  'weight',
  'measurement',
  'food',
  'foodLog',
  'water',
  'steps',
]);

export type MemberDataEntity = z.infer<typeof memberDataEntitySchema>;

const weightRecordSchema = z
  .object({
    entity: z.literal('weight'),
    value: z
      .object({
        id: recordIdSchema,
        date: isoDateSchema,
        kg: z.number().finite().min(20).max(500),
      })
      .strict(),
  })
  .strict();

const measurementValueSchema = z
  .object({
    id: recordIdSchema,
    date: isoDateSchema,
    waistCm: z.number().finite().min(20).max(400).nullable(),
    chestCm: z.number().finite().min(20).max(400).nullable(),
    armCm: z.number().finite().min(5).max(150).nullable(),
    hipCm: z.number().finite().min(20).max(400).nullable(),
    thighCm: z.number().finite().min(10).max(250).nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.waistCm !== null ||
      value.chestCm !== null ||
      value.armCm !== null ||
      value.hipCm !== null ||
      value.thighCm !== null,
    'at least one measurement is required',
  );

const measurementRecordSchema = z
  .object({
    entity: z.literal('measurement'),
    value: measurementValueSchema,
  })
  .strict();

const customFoodValueSchema = z
  .object({
    id: recordIdSchema,
    name: z.string().trim().min(1).max(200),
    brand: z.string().trim().max(160).nullable(),
    source: z.literal('custom'),
    barcode: z.string().trim().min(1).max(64).nullable(),
    kcalPer100: finiteNonNegativeSchema.max(2_000),
    proteinPer100: finiteNonNegativeSchema.max(100),
    carbsPer100: finiteNonNegativeSchema.max(100),
    fatPer100: finiteNonNegativeSchema.max(100),
    servingGrams: z.number().finite().positive().max(10_000).nullable(),
    servingLabel: z.string().trim().min(1).max(120).nullable(),
    fiberPer100: finiteNonNegativeSchema.max(100).nullable().optional(),
    sugarPer100: finiteNonNegativeSchema.max(100).nullable().optional(),
    sodiumPer100: finiteNonNegativeSchema.max(100_000).nullable().optional(),
    nutriScore: z.enum(['a', 'b', 'c', 'd', 'e']).nullable().optional(),
    novaGroup: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable().optional(),
  })
  .strict();

const foodRecordSchema = z
  .object({
    entity: z.literal('food'),
    value: customFoodValueSchema,
  })
  .strict();

const foodLogRecordSchema = z
  .object({
    entity: z.literal('foodLog'),
    value: z
      .object({
        id: recordIdSchema,
        date: isoDateSchema,
        meal: z.enum(['breakfast', 'lunch', 'dinner', 'snacks']),
        foodId: recordIdSchema,
        foodName: z.string().trim().min(1).max(200),
        grams: z.number().finite().positive().max(100_000),
        kcal: finiteNonNegativeSchema.max(100_000),
        protein: finiteNonNegativeSchema.max(10_000),
        carbs: finiteNonNegativeSchema.max(10_000),
        fat: finiteNonNegativeSchema.max(10_000),
      })
      .strict(),
  })
  .strict();

const waterRecordSchema = z
  .object({
    entity: z.literal('water'),
    value: z
      .object({
        date: isoDateSchema,
        ml: z.number().int().min(0).max(100_000),
      })
      .strict(),
  })
  .strict();

const stepsRecordSchema = z
  .object({
    entity: z.literal('steps'),
    value: z
      .object({
        date: isoDateSchema,
        steps: z.number().int().min(0).max(1_000_000),
      })
      .strict(),
  })
  .strict();

export const memberDataRecordSchema = z.discriminatedUnion('entity', [
  weightRecordSchema,
  measurementRecordSchema,
  foodRecordSchema,
  foodLogRecordSchema,
  waterRecordSchema,
  stepsRecordSchema,
]);

export type MemberDataRecord = z.infer<typeof memberDataRecordSchema>;

export const memberDataMutationSchema = z
  .object({
    mutationId: z.string().uuid(),
    changedAt: isoTimestampSchema,
    deleted: z.boolean(),
    record: memberDataRecordSchema,
  })
  .strict();

export type MemberDataMutation = z.infer<typeof memberDataMutationSchema>;

export const memberDataCursorPointSchema = z
  .object({
    serverUpdatedAt: isoTimestampSchema,
    recordId: recordIdSchema,
  })
  .strict();

export type MemberDataCursorPoint = z.infer<typeof memberDataCursorPointSchema>;

export const memberDataSyncCursorSchema = z
  .object({
    weight: memberDataCursorPointSchema.nullable(),
    measurement: memberDataCursorPointSchema.nullable(),
    food: memberDataCursorPointSchema.nullable(),
    foodLog: memberDataCursorPointSchema.nullable(),
    water: memberDataCursorPointSchema.nullable(),
    steps: memberDataCursorPointSchema.nullable(),
  })
  .strict();

export type MemberDataSyncCursor = z.infer<typeof memberDataSyncCursorSchema>;

export const EMPTY_MEMBER_DATA_SYNC_CURSOR: MemberDataSyncCursor = {
  weight: null,
  measurement: null,
  food: null,
  foodLog: null,
  water: null,
  steps: null,
};

export const memberDataSyncRequestSchema = z
  .object({
    cursor: memberDataSyncCursorSchema,
    mutations: z.array(memberDataMutationSchema).max(100),
  })
  .strict();

export type MemberDataSyncRequest = z.infer<typeof memberDataSyncRequestSchema>;

export const memberDataChangeSchema = memberDataMutationSchema
  .extend({ serverUpdatedAt: isoTimestampSchema })
  .strict();

export type MemberDataChange = z.infer<typeof memberDataChangeSchema>;

export const memberDataSyncResponseSchema = z
  .object({
    ok: z.literal(true),
    acknowledgedMutationIds: z.array(z.string().uuid()).max(100),
    changes: z.array(memberDataChangeSchema).max(1_000),
    cursor: memberDataSyncCursorSchema,
    hasMore: z.boolean(),
  })
  .strict();

export type MemberDataSyncResponse = z.infer<typeof memberDataSyncResponseSchema>;

/** Stable identity used by both the local queue and each server table. */
export function memberDataRecordId(record: MemberDataRecord): string {
  switch (record.entity) {
    case 'weight':
    case 'water':
    case 'steps':
      return record.value.date;
    case 'measurement':
    case 'food':
    case 'foodLog':
      return record.value.id;
  }
}

/**
 * Deterministic conflict order. The timestamp is the primary LWW clock and
 * the UUID is a stable tie-breaker, so retries can never reverse a winner.
 */
export function compareMemberDataVersions(
  a: Pick<MemberDataMutation, 'changedAt' | 'mutationId'>,
  b: Pick<MemberDataMutation, 'changedAt' | 'mutationId'>,
): number {
  const byTime = a.changedAt.localeCompare(b.changedAt);
  return byTime !== 0 ? byTime : a.mutationId.localeCompare(b.mutationId);
}
