import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerHooks } from 'node:module';
import { bmr, computeTargets } from './macros.ts';

// activity.ts imports a sibling helper (./macros) without an extension —
// the repo-wide source idiom (see progression.test.ts for the full rationale).
// Bridge relative specifiers to their .ts files for this test process only.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (typeof specifier === 'string' && specifier.startsWith('.') && !specifier.endsWith('.ts')) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw err;
    }
  },
});

const {
  activityCaloriesOut,
  netKcal,
  restingKcal,
  stepsGoal,
  stepsKcal,
  stepsToKm,
  strideMeters,
  workoutKcal,
} = await import('./activity.ts');

const approx = (actual: number, expected: number, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} !~ ${expected}`);

describe('strideMeters', () => {
  it('is ~41.4% of height', () => {
    approx(strideMeters(172), 172 * 0.00414);
    approx(strideMeters(180), 180 * 0.00414);
  });
  it('clamps garbage input to 0', () => {
    assert.equal(strideMeters(-10), 0);
    assert.equal(strideMeters(NaN), 0);
    assert.equal(strideMeters(Number.POSITIVE_INFINITY), 0); // non-finite = missing
  });
  it('caps absurd heights at a plausible stride', () => {
    assert.equal(strideMeters(10_000), 1.2);
  });
});

describe('stepsToKm', () => {
  it('distance = steps x stride / 1000', () => {
    approx(stepsToKm(10_000, 172), (10_000 * 172 * 0.00414) / 1000);
  });
  it('zero for unknown height or bad steps', () => {
    assert.equal(stepsToKm(10_000, 0), 0);
    assert.equal(stepsToKm(-500, 172), 0);
    assert.equal(stepsToKm(NaN, 172), 0);
  });
});

describe('stepsKcal', () => {
  it('0.53 kcal per kg per km, rounded', () => {
    const km = stepsToKm(10_000, 172);
    assert.equal(stepsKcal(10_000, 75, 172), Math.round(0.53 * 75 * km));
  });
  it('zero when any input is missing', () => {
    assert.equal(stepsKcal(0, 75, 172), 0);
    assert.equal(stepsKcal(10_000, NaN, 172), 0);
    assert.equal(stepsKcal(10_000, 75, -1), 0);
  });
});

describe('workoutKcal', () => {
  it('MET 5.0: kcal = 5 x kg x hours', () => {
    assert.equal(workoutKcal(3600, 80), 400);
    assert.equal(workoutKcal(1800, 80), 200);
    assert.equal(workoutKcal(2700, 75), Math.round(5 * 75 * 0.75));
  });
  it('clamps bad duration/weight to 0', () => {
    assert.equal(workoutKcal(-60, 80), 0);
    assert.equal(workoutKcal(3600, NaN), 0);
  });
});

describe('restingKcal', () => {
  it('matches Mifflin-St Jeor bmr()', () => {
    assert.equal(
      restingKcal({ sex: 'male', weightKg: 80, heightCm: 180, age: 30 }),
      bmr('male', 80, 180, 30),
    );
    assert.equal(
      restingKcal({ sex: 'female', weightKg: 80, heightCm: 180, age: 30 }),
      bmr('female', 80, 180, 30),
    );
  });
  it('never goes negative on degenerate input', () => {
    assert.equal(restingKcal({ sex: 'female', weightKg: 0, heightCm: 0, age: 0 }), 0);
  });
});

describe('stepsGoal', () => {
  it('maps activity levels to daily step goals', () => {
    assert.equal(stepsGoal('sedentary'), 6000);
    assert.equal(stepsGoal('light'), 8000);
    assert.equal(stepsGoal('moderate'), 10_000);
    assert.equal(stepsGoal('high'), 12_000);
    assert.equal(stepsGoal('active'), 12_000);
    assert.equal(stepsGoal('very_active'), 12_000);
  });
  it('unknown levels fall back to 8000', () => {
    assert.equal(stepsGoal(''), 8000);
    assert.equal(stepsGoal('couch'), 8000);
  });
});

describe('activityCaloriesOut / netKcal', () => {
  it('sums resting + steps + workout', () => {
    assert.equal(
      activityCaloriesOut({ resting: 1780, stepsKcal: 283, workoutKcal: 400 }),
      2463,
    );
  });
  it('one bad component cannot poison the total', () => {
    assert.equal(activityCaloriesOut({ resting: 1780, stepsKcal: NaN, workoutKcal: -50 }), 1780);
  });
  it('netKcal = eaten - out, deficit stays negative', () => {
    assert.equal(netKcal(2200, 2463), -263);
    assert.equal(netKcal(2500, 2000), 500);
  });
  it('netKcal sanitizes garbage inputs to 0', () => {
    assert.equal(netKcal(NaN, 2000), -2000);
    assert.equal(netKcal(2000, -100), 2000);
  });
});

describe('computeTargets steps wiring', () => {
  it('targets include the step goal for the activity level', () => {
    const t = computeTargets({
      sex: 'male',
      kg: 80,
      heightCm: 180,
      ageYears: 30,
      activity: 'moderate',
      goal: 'muscle',
    });
    assert.equal(t.steps, 10_000);
  });
  it('sedentary users get the lower goal', () => {
    const t = computeTargets({
      sex: 'female',
      kg: 60,
      heightCm: 165,
      ageYears: 25,
      activity: 'sedentary',
      goal: 'fat_loss',
    });
    assert.equal(t.steps, 6000);
  });
});
