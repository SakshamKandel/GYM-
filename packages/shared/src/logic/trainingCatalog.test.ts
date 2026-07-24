import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TrainingCatalogPlan } from '../types.ts';
import { trainingCatalogSchema } from '../schemas/trainingCatalog.ts';
import {
  selectTrainingPlan,
} from './trainingCatalog.ts';
import { canAccessTrainingPlan, trainingPlanFeature } from './entitlements.ts';

function plan(
  id: string,
  goalType: TrainingCatalogPlan['goalType'],
  daysPerWeek: number,
  isAvailable = true,
): TrainingCatalogPlan {
  return {
    id,
    name: id,
    tierRequired: 'starter',
    goalType,
    weeks: 6,
    daysPerWeek,
    description: '',
    isBranded: false,
    isAvailable,
    workouts: isAvailable
      ? [{ id: `${id}-day`, planId: id, week: 1, day: 1, name: 'Day', exercises: [] }]
      : [],
  };
}

describe('training plan entitlement routing', () => {
  it('maps every DB tier through hasEntitlement-compatible features', () => {
    assert.equal(trainingPlanFeature('starter'), 'training_plans_starter');
    assert.equal(trainingPlanFeature('silver'), 'training_plans_silver');
    assert.equal(trainingPlanFeature('gold'), 'training_plans_gold');
    assert.equal(trainingPlanFeature('elite'), 'training_plans_elite');
  });

  it('enforces each plan requirement without screen-level tier comparisons', () => {
    const requirements = ['starter', 'silver', 'gold', 'elite'] as const;
    const users = ['starter', 'silver', 'gold', 'elite'] as const;
    for (let required = 0; required < requirements.length; required += 1) {
      for (let user = 0; user < users.length; user += 1) {
        assert.equal(
          canAccessTrainingPlan(
            { tier: users[user]! },
            { tierRequired: requirements[required]! },
          ),
          user >= required,
        );
      }
    }
  });
});

describe('selectTrainingPlan', () => {
  it('chooses a real available goal match nearest the requested days', () => {
    const selected = selectTrainingPlan(
      [plan('muscle-5', 'muscle', 5), plan('muscle-3', 'muscle', 3), plan('fat-4', 'fat_loss', 4)],
      'muscle',
      4,
    );
    assert.equal(selected?.id, 'muscle-3');
  });

  it('never selects locked or workout-empty plans', () => {
    const empty = { ...plan('empty', 'strength', 3), workouts: [] };
    const selected = selectTrainingPlan(
      [plan('locked', 'strength', 3, false), empty, plan('fallback', 'muscle', 2)],
      'strength',
      3,
    );
    assert.equal(selected?.id, 'fallback');
  });

  it('returns null when the backend has no usable plan', () => {
    assert.equal(selectTrainingPlan([plan('locked', 'muscle', 3, false)], 'muscle', 3), null);
  });
});

describe('trainingCatalogSchema', () => {
  it('accepts a strict server snapshot', () => {
    const parsed = trainingCatalogSchema.safeParse({
      revision: 'a'.repeat(64),
      generatedAt: '2026-07-22T00:00:00.000Z',
      plans: [plan('live', 'muscle', 3)],
      exercises: [],
    });
    assert.equal(parsed.success, true);
  });

  it('rejects locked plans that leak workout structure', () => {
    const lockedWithContent = { ...plan('locked', 'muscle', 3), isAvailable: false };
    const parsed = trainingCatalogSchema.safeParse({
      revision: 'b'.repeat(64),
      generatedAt: '2026-07-22T00:00:00.000Z',
      plans: [lockedWithContent],
      exercises: [],
    });
    assert.equal(parsed.success, false);
  });
});
