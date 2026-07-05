import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerHooks } from 'node:module';

// plausibility.ts imports sibling helpers (./pr, ./badges) without extensions —
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

const { checkWorkoutPlausibility } = await import('./plausibility.ts');

describe('checkWorkoutPlausibility — absolute bounds', () => {
  it('a set over 400 kg trips absolute bounds', () => {
    const result = checkWorkoutPlausibility({
      sets: [{ weightKg: 401, reps: 1, exerciseId: 'e1', exerciseName: 'Deadlift' }],
      bodyweightKg: null,
      priorBestE1Rm: {},
    });
    assert.equal(result.ranked, false);
    assert.equal(result.reason, 'absolute_bounds');
  });

  it('exactly 400 kg is still plausible (boundary inclusive to the limit)', () => {
    const result = checkWorkoutPlausibility({
      sets: [{ weightKg: 400, reps: 1, exerciseId: 'e1', exerciseName: 'Deadlift' }],
      bodyweightKg: null,
      priorBestE1Rm: {},
    });
    assert.equal(result.ranked, true);
  });

  it('a set over 100 reps trips absolute bounds', () => {
    const result = checkWorkoutPlausibility({
      sets: [{ weightKg: 20, reps: 101, exerciseId: 'e1', exerciseName: 'Bicep Curl' }],
      bodyweightKg: null,
      priorBestE1Rm: {},
    });
    assert.equal(result.ranked, false);
    assert.equal(result.reason, 'absolute_bounds');
  });

  it('exactly 100 reps is still plausible', () => {
    const result = checkWorkoutPlausibility({
      sets: [{ weightKg: 20, reps: 100, exerciseId: 'e1', exerciseName: 'Bicep Curl' }],
      bodyweightKg: null,
      priorBestE1Rm: {},
    });
    assert.equal(result.ranked, true);
  });

  it('a big-lift e1RM over 4x bodyweight trips absolute bounds', () => {
    // bodyweight 70kg, cap = 280kg e1RM. 275kg x1 = 275 e1RM (under cap)... use a clearer overshoot.
    const result = checkWorkoutPlausibility({
      sets: [{ weightKg: 300, reps: 1, exerciseId: 'e1', exerciseName: 'Barbell Squat' }],
      bodyweightKg: 70,
      priorBestE1Rm: {},
    });
    assert.equal(result.ranked, false);
    assert.equal(result.reason, 'absolute_bounds');
  });

  it('a big-lift within 4x bodyweight is plausible', () => {
    const result = checkWorkoutPlausibility({
      sets: [{ weightKg: 200, reps: 1, exerciseId: 'e1', exerciseName: 'Barbell Squat' }], // 200 = 2.86x70
      bodyweightKg: 70,
      priorBestE1Rm: {},
    });
    assert.equal(result.ranked, true);
  });

  it('bodyweight-relative cap only applies to canonical big lifts, not accessories', () => {
    // 300kg leg press at 70kg bodyweight (4.3x) is not one of the four tracked lifts, so no cap applies.
    const result = checkWorkoutPlausibility({
      sets: [{ weightKg: 300, reps: 1, exerciseId: 'e1', exerciseName: 'Leg Press' }],
      bodyweightKg: 70,
      priorBestE1Rm: {},
    });
    assert.equal(result.ranked, true);
  });

  it('null bodyweight skips the bodyweight-relative check entirely', () => {
    const result = checkWorkoutPlausibility({
      sets: [{ weightKg: 350, reps: 1, exerciseId: 'e1', exerciseName: 'Barbell Squat' }],
      bodyweightKg: null,
      priorBestE1Rm: {},
    });
    assert.equal(result.ranked, true);
  });
});

describe('checkWorkoutPlausibility — velocity', () => {
  it('a session e1RM more than 1.2x the rolling 90-day best trips velocity', () => {
    const result = checkWorkoutPlausibility({
      sets: [{ weightKg: 130, reps: 1, exerciseId: 'squat-1', exerciseName: 'Barbell Squat' }], // e1RM 130
      bodyweightKg: null,
      priorBestE1Rm: { 'squat-1': { best: 100, sessions: 5 } }, // cap = 120
    });
    assert.equal(result.ranked, false);
    assert.equal(result.reason, 'velocity');
  });

  it('exactly 1.2x the prior best is still plausible (boundary)', () => {
    const result = checkWorkoutPlausibility({
      sets: [{ weightKg: 120, reps: 1, exerciseId: 'squat-1', exerciseName: 'Barbell Squat' }], // e1RM 120
      bodyweightKg: null,
      priorBestE1Rm: { 'squat-1': { best: 100, sessions: 5 } },
    });
    assert.equal(result.ranked, true);
  });

  it('velocity check is skipped with fewer than 3 prior sessions', () => {
    const result = checkWorkoutPlausibility({
      sets: [{ weightKg: 200, reps: 1, exerciseId: 'squat-1', exerciseName: 'Barbell Squat' }], // huge jump
      bodyweightKg: null,
      priorBestE1Rm: { 'squat-1': { best: 100, sessions: 2 } }, // below the 3-session minimum
    });
    assert.equal(result.ranked, true);
  });

  it('exactly 3 prior sessions is enough to trigger the velocity check', () => {
    const result = checkWorkoutPlausibility({
      sets: [{ weightKg: 200, reps: 1, exerciseId: 'squat-1', exerciseName: 'Barbell Squat' }],
      bodyweightKg: null,
      priorBestE1Rm: { 'squat-1': { best: 100, sessions: 3 } },
    });
    assert.equal(result.ranked, false);
    assert.equal(result.reason, 'velocity');
  });

  it('an exercise with no prior history is never flagged by velocity', () => {
    const result = checkWorkoutPlausibility({
      sets: [{ weightKg: 200, reps: 1, exerciseId: 'brand-new', exerciseName: 'Cable Fly' }],
      bodyweightKg: null,
      priorBestE1Rm: {},
    });
    assert.equal(result.ranked, true);
  });

  it('velocity is evaluated per-exercise — one lift spiking does not flag an unrelated lift', () => {
    const result = checkWorkoutPlausibility({
      sets: [
        { weightKg: 200, reps: 1, exerciseId: 'squat-1', exerciseName: 'Barbell Squat' }, // spikes
        { weightKg: 60, reps: 5, exerciseId: 'bench-1', exerciseName: 'Bench Press' }, // normal
      ],
      bodyweightKg: null,
      priorBestE1Rm: {
        'squat-1': { best: 100, sessions: 5 },
        'bench-1': { best: 65, sessions: 5 },
      },
    });
    assert.equal(result.ranked, false);
    assert.equal(result.reason, 'velocity');
  });

  it('a normal novice +10kg jump on a light lift exceeds the multiple cap but not the absolute margin, so it is not flagged', () => {
    // prior best e1RM 46.7 (40kg x5), new session 50kg x5 -> e1RM ~58.3.
    // 58.3 > 1.2 x 46.7 (56) but 58.3 - 46.7 = 11.6kg, under the 15kg margin.
    const result = checkWorkoutPlausibility({
      sets: [{ weightKg: 50, reps: 5, exerciseId: 'squat-1', exerciseName: 'Barbell Squat' }],
      bodyweightKg: null,
      priorBestE1Rm: { 'squat-1': { best: 46.7, sessions: 5 } },
    });
    assert.equal(result.ranked, true);
  });

  it('a jump that clears BOTH the multiple cap and the absolute margin is still flagged', () => {
    const result = checkWorkoutPlausibility({
      sets: [{ weightKg: 200, reps: 1, exerciseId: 'squat-1', exerciseName: 'Barbell Squat' }], // e1RM 200
      bodyweightKg: null,
      priorBestE1Rm: { 'squat-1': { best: 100, sessions: 5 } }, // 200 > 120 (multiple) and 200 > 115 (margin)
    });
    assert.equal(result.ranked, false);
    assert.equal(result.reason, 'velocity');
  });

  it('a jump that clears the absolute margin but not the multiple cap (heavy lifter) is not flagged', () => {
    // prior best e1RM 300, new session e1RM 320: within 1.2x (360) but over the 15kg margin (315).
    const result = checkWorkoutPlausibility({
      sets: [{ weightKg: 320, reps: 1, exerciseId: 'squat-1', exerciseName: 'Barbell Squat' }],
      bodyweightKg: null,
      priorBestE1Rm: { 'squat-1': { best: 300, sessions: 5 } },
    });
    assert.equal(result.ranked, true);
  });
});

describe('checkWorkoutPlausibility — layering', () => {
  it('absolute bounds take priority when both layers would trip', () => {
    const result = checkWorkoutPlausibility({
      sets: [{ weightKg: 500, reps: 1, exerciseId: 'squat-1', exerciseName: 'Barbell Squat' }],
      bodyweightKg: null,
      priorBestE1Rm: { 'squat-1': { best: 100, sessions: 5 } },
    });
    assert.equal(result.reason, 'absolute_bounds');
  });

  it('a clean, ordinary workout is fully plausible', () => {
    const result = checkWorkoutPlausibility({
      sets: [
        { weightKg: 100, reps: 5, exerciseId: 'squat-1', exerciseName: 'Barbell Squat' },
        { weightKg: 60, reps: 8, exerciseId: 'bench-1', exerciseName: 'Bench Press' },
      ],
      bodyweightKg: 80,
      priorBestE1Rm: {
        'squat-1': { best: 115, sessions: 10 },
        'bench-1': { best: 70, sessions: 10 },
      },
    });
    assert.equal(result.ranked, true);
    assert.equal(result.reason, null);
  });
});
