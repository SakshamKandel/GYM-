import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareMemberDataVersions,
  memberDataRecordId,
  memberDataSyncRequestSchema,
} from '../schemas/memberDataSync';

test('member data conflict order is deterministic and retry stable', () => {
  const first = {
    changedAt: '2026-07-22T10:00:00.000Z',
    mutationId: '00000000-0000-4000-8000-000000000001',
  };
  const second = {
    changedAt: '2026-07-22T10:00:00.000Z',
    mutationId: '00000000-0000-4000-8000-000000000002',
  };

  assert.equal(compareMemberDataVersions(first, first), 0);
  assert.equal(compareMemberDataVersions(first, second), -1);
  assert.equal(compareMemberDataVersions(second, first), 1);
  assert.equal(
    compareMemberDataVersions(
      { ...first, changedAt: '2026-07-22T10:00:01.000Z' },
      second,
    ),
    1,
  );
});

test('daily aggregates use their date as the stable server key', () => {
  assert.equal(
    memberDataRecordId({ entity: 'water', value: { date: '2026-07-22', ml: 2_500 } }),
    '2026-07-22',
  );
});

test('member sync rejects non-custom saved foods at the boundary', () => {
  const parsed = memberDataSyncRequestSchema.safeParse({
    cursor: {
      weight: null,
      measurement: null,
      food: null,
      foodLog: null,
      water: null,
      steps: null,
    },
    mutations: [
      {
        mutationId: '00000000-0000-4000-8000-000000000001',
        changedAt: '2026-07-22T10:00:00.000Z',
        deleted: false,
        record: {
          entity: 'food',
          value: {
            id: 'off:123',
            name: 'Remote catalog food',
            brand: null,
            source: 'off',
            barcode: '123',
            kcalPer100: 100,
            proteinPer100: 10,
            carbsPer100: 10,
            fatPer100: 2,
            servingGrams: null,
            servingLabel: null,
          },
        },
      },
    ],
  });

  assert.equal(parsed.success, false);
});
