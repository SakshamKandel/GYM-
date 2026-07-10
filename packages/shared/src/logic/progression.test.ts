import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerHooks } from 'node:module';
import type { ProgressionInput, ProgressionResult, ProgressionSession } from './progression.ts';

// progression.ts imports its sibling helpers (./pr, ./units) without extensions —
// the repo-wide source idiom, and required because the app tsconfigs do not enable
// allowImportingTsExtensions. Node's type stripping needs explicit extensions at
// runtime, so bridge relative specifiers to their .ts files for this test process
// only (node --test isolates each file in its own process).
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

const { suggestProgression } = await import('./progression.ts');

/** Narrow a nullable result without relying on assert.ok's assertion signature. */
function must(value: ProgressionResult | null): ProgressionResult {
  if (value === null) throw new Error('expected a suggestion, got null');
  return value;
}

/** [weightKg, reps, rpe] tuples → one session. */
function session(date: string, sets: Array<[number, number, number | null]>): ProgressionSession {
  return { date, sets: sets.map(([weightKg, reps, rpe]) => ({ weightKg, reps, rpe })) };
}

function input(sessions: ProgressionSession[], extra: Partial<ProgressionInput> = {}): ProgressionInput {
  return { exerciseId: 'ex1', exerciseName: 'Bench Press', sessions, ...extra };
}

describe('suggestProgression — empty and thin history', () => {
  it('returns null with no sessions', () => {
    assert.equal(suggestProgression(input([])), null);
  });
  it('returns null when every set is junk (zero reps / negative weight)', () => {
    const r = suggestProgression(input([session('2026-07-01', [[100, 0, null], [-5, 8, null]])]));
    assert.equal(r, null);
  });
  it('a single session suggests repeating it as a baseline', () => {
    const r = must(suggestProgression(input([session('2026-07-01', [[60, 10, 7]])])));
    assert.equal(r.action, 'hold');
    assert.equal(r.targetWeightKg, 60);
    assert.equal(r.targetRepsMin, 8);
    assert.equal(r.targetRepsMax, 12);
    assert.equal(r.reason, 'Only one session logged — repeat 60 kg x 8–12 to set a baseline');
  });
  it('never changes exercise selection — echoes id and name', () => {
    const r = must(suggestProgression(input([session('2026-07-01', [[60, 10, 7]])])));
    assert.equal(r.exerciseId, 'ex1');
    assert.equal(r.exerciseName, 'Bench Press');
  });
});

describe('suggestProgression — increase', () => {
  const topped = [
    session('2026-06-24', [[100, 10, 7], [100, 10, 7], [100, 9, 8]]),
    session('2026-07-01', [[100, 12, 7], [100, 12, 7], [100, 12, 7]]),
  ];
  it('all sets at the top of the range at RPE <= 8 adds the increment', () => {
    const r = must(suggestProgression(input(topped)));
    assert.equal(r.action, 'increase');
    assert.equal(r.targetWeightKg, 102.5);
    assert.equal(r.targetRepsMin, 8);
    assert.equal(r.targetRepsMax, 12);
    assert.equal(r.reason, 'Hit 3x12 @ RPE 7 last time — +2.5 kg');
  });
  it('missing RPE counts as passing for increase (reason drops the RPE part)', () => {
    const r = must(
      suggestProgression(
        input([
          session('2026-06-24', [[100, 10, null]]),
          session('2026-07-01', [[100, 12, null], [100, 12, null], [100, 12, null]]),
        ]),
      ),
    );
    assert.equal(r.action, 'increase');
    assert.equal(r.reason, 'Hit 3x12 last time — +2.5 kg');
  });
  it('respects a configurable increment', () => {
    const r = must(suggestProgression(input(topped, { incrementKg: 1.25 })));
    assert.equal(r.targetWeightKg, 101.25);
    assert.equal(r.reason, 'Hit 3x12 @ RPE 7 last time — +1.25 kg');
  });
  it('respects a template rep range', () => {
    const r = must(
      suggestProgression(
        input(
          [
            session('2026-06-24', [[140, 8, 8]]),
            session('2026-07-01', [[140, 10, 7], [140, 10, 7]]),
          ],
          { repRangeMin: 6, repRangeMax: 10 },
        ),
      ),
    );
    assert.equal(r.action, 'increase');
    assert.equal(r.targetWeightKg, 142.5);
    assert.equal(r.reason, 'Hit 2x10 @ RPE 7 last time — +2.5 kg');
  });
  it('formats the reason in lb for lb users while keeping targetWeightKg canonical', () => {
    const r = must(suggestProgression(input(topped, { unitPref: 'lb' })));
    assert.equal(r.targetWeightKg, 102.5);
    assert.equal(r.reason, 'Hit 3x12 @ RPE 7 last time — +5.5 lb');
  });
  it('average RPE above 8 blocks the increase even at top reps', () => {
    const r = must(
      suggestProgression(
        input([
          session('2026-06-24', [[100, 11, 8]]),
          session('2026-07-01', [[100, 12, 8.5], [100, 12, 9]]),
        ]),
      ),
    );
    assert.equal(r.action, 'hold');
    assert.equal(r.targetWeightKg, 100);
  });
});

describe('suggestProgression — hold', () => {
  it('missing the bottom of the range holds the weight', () => {
    const r = must(
      suggestProgression(
        input([
          session('2026-06-24', [[100, 9, 8]]),
          session('2026-07-01', [[100, 8, 8], [100, 7, 9]]),
        ]),
      ),
    );
    assert.equal(r.action, 'hold');
    assert.equal(r.targetWeightKg, 100);
    assert.equal(r.reason, 'Missed the rep target last time — hold 100 kg and own the 8–12 range');
  });
  it('average RPE >= 9.5 holds the weight even inside the range', () => {
    const r = must(
      suggestProgression(
        input([
          session('2026-06-24', [[100, 9, 8]]),
          session('2026-07-01', [[100, 10, 9.5], [100, 9, 9.5]]),
        ]),
      ),
    );
    assert.equal(r.action, 'hold');
    assert.equal(r.targetWeightKg, 100);
    assert.equal(r.reason, 'RPE 9.5 last time — hold 100 kg and recover before adding weight');
  });
  it('missing RPE never triggers the RPE hold — mid-range defaults to add-reps', () => {
    const r = must(
      suggestProgression(
        input([
          session('2026-06-24', [[100, 8, null]]),
          session('2026-07-01', [[100, 10, null], [100, 9, null]]),
        ]),
      ),
    );
    assert.equal(r.action, 'hold');
    assert.equal(r.targetWeightKg, 100);
    assert.equal(r.reason, 'In the 8–12 range — add reps before adding weight');
  });
  it('averages only the non-null RPEs', () => {
    // RPEs [8, null, 9] average 8.5 — blocks increase, below the 9.5 hold floor.
    const r = must(
      suggestProgression(
        input([
          session('2026-06-24', [[100, 10, 7]]),
          session('2026-07-01', [[100, 12, 8], [100, 12, null], [100, 12, 9]]),
        ]),
      ),
    );
    assert.equal(r.action, 'hold');
    assert.equal(
      r.reason,
      'RPE 8.5 at the top of the 8–12 range — hold 100 kg and recover before adding weight',
    );
  });
});

describe('suggestProgression — stall and deload', () => {
  const flat = (dates: string[]) => dates.map((d) => session(d, [[100, 10, 8], [100, 9, 8]]));
  it('three sessions with no e1RM progress suggest a ~10% deload', () => {
    const r = must(suggestProgression(input(flat(['2026-06-17', '2026-06-24', '2026-07-01']))));
    assert.equal(r.action, 'deload');
    assert.equal(r.targetWeightKg, 90); // 100 * 0.9 on the 2.5 grid
    assert.equal(r.reason, 'No e1RM progress in 3 sessions — deload ~10% and rebuild');
  });
  it('reports the full stall length when it runs longer than 3 sessions', () => {
    const r = must(
      suggestProgression(input(flat(['2026-06-10', '2026-06-17', '2026-06-24', '2026-07-01']))),
    );
    assert.equal(r.action, 'deload');
    assert.equal(r.reason, 'No e1RM progress in 4 sessions — deload ~10% and rebuild');
  });
  it('rounds the deload target to the increment grid', () => {
    const sets: Array<[number, number, number | null]> = [[102.5, 10, 8]];
    const r = must(
      suggestProgression(
        input([session('2026-06-17', sets), session('2026-06-24', sets), session('2026-07-01', sets)], {
          incrementKg: 5,
        }),
      ),
    );
    // 102.5 * 0.9 = 92.25 → nearest 5 kg step = 90
    assert.equal(r.targetWeightKg, 90);
  });
  it('falls back to the raw 10% cut when grid rounding would not reduce the weight', () => {
    const sets: Array<[number, number, number | null]> = [[5, 10, 8]];
    const r = must(
      suggestProgression(
        input([session('2026-06-17', sets), session('2026-06-24', sets), session('2026-07-01', sets)]),
      ),
    );
    assert.equal(r.action, 'deload');
    assert.equal(r.targetWeightKg, 4.5); // 5 * 0.9; the 2.5 grid would bounce back to 5
  });
  it('an e1RM improvement in the window breaks the stall', () => {
    const r = must(
      suggestProgression(
        input([
          session('2026-06-17', [[100, 8, 8]]),
          session('2026-06-24', [[100, 10, 8]]), // e1RM up — no stall
          session('2026-07-01', [[100, 10, 8]]),
        ]),
      ),
    );
    assert.equal(r.action, 'hold');
    assert.equal(r.reason, 'In the 8–12 range — add reps before adding weight');
  });
  it('rep progress above the 12-rep e1RM cap is not a stall (high-rep ranges)', () => {
    // epley1Rm caps reps at 12; a capped score would be flat across these
    // sessions and mis-fire a deload on textbook double progression.
    const r = must(
      suggestProgression(
        input(
          [
            session('2026-06-17', [[20, 12, 7]]),
            session('2026-06-24', [[20, 13, 7]]),
            session('2026-07-01', [[20, 14, 7]]),
          ],
          { repRangeMin: 12, repRangeMax: 15 },
        ),
      ),
    );
    assert.equal(r.action, 'hold');
    assert.equal(r.reason, 'In the 12–15 range — add reps before adding weight');
  });
  it('topping a high-rep range after progressing above the cap earns the increase', () => {
    const r = must(
      suggestProgression(
        input(
          [
            session('2026-06-17', [[20, 13, 7]]),
            session('2026-06-24', [[20, 14, 7]]),
            session('2026-07-01', [[20, 15, 7], [20, 15, 7]]),
          ],
          { repRangeMin: 12, repRangeMax: 15 },
        ),
      ),
    );
    assert.equal(r.action, 'increase');
    assert.equal(r.targetWeightKg, 22.5);
  });
  it('a flat top-of-range history at low RPE earns the increase, not a false deload', () => {
    // 100x12 (top of the 8–12 range) at RPE 7 for three sessions running: e1RM
    // is flat, but capping the rep range at low effort is not a stall — the
    // lifter has earned the weight jump, so Rule 2 (increase) wins over Rule 1.
    const sets: Array<[number, number, number | null]> = [[100, 12, 7]];
    const r = must(
      suggestProgression(
        input([session('2026-06-17', sets), session('2026-06-24', sets), session('2026-07-01', sets)]),
      ),
    );
    assert.equal(r.action, 'increase');
    assert.equal(r.targetWeightKg, 102.5);
  });
});

describe('suggestProgression — bodyweight', () => {
  it('topping the range at bodyweight progresses reps, not load', () => {
    const r = must(
      suggestProgression(
        input([
          session('2026-06-24', [[0, 10, 7], [0, 9, 7]]),
          session('2026-07-01', [[0, 12, 7], [0, 12, 7], [0, 12, 7]]),
        ]),
      ),
    );
    assert.equal(r.action, 'increase');
    assert.equal(r.targetWeightKg, 0);
    assert.equal(r.targetRepsMin, 10);
    assert.equal(r.targetRepsMax, 14);
    assert.equal(r.reason, 'Hit 3x12 at bodyweight — aim for 10–14 reps next time');
  });
  it('mid-range bodyweight work holds and keeps building reps', () => {
    const r = must(
      suggestProgression(
        input([
          session('2026-06-24', [[0, 8, null]]),
          session('2026-07-01', [[0, 10, null], [0, 9, null]]),
        ]),
      ),
    );
    assert.equal(r.action, 'hold');
    assert.equal(r.targetWeightKg, 0);
    assert.equal(r.reason, 'Bodyweight work — build toward 2x12 before raising the target');
  });
  it('flat bodyweight history never deloads (e1RM of 0 kg is meaningless)', () => {
    const sets: Array<[number, number, number | null]> = [[0, 10, 8]];
    const r = must(
      suggestProgression(
        input([session('2026-06-17', sets), session('2026-06-24', sets), session('2026-07-01', sets)]),
      ),
    );
    assert.notEqual(r.action, 'deload');
    assert.equal(r.targetWeightKg, 0);
  });
});

describe('suggestProgression — input robustness', () => {
  it('re-sorts sessions so the most recent is evaluated even when passed newest-first', () => {
    const r = must(
      suggestProgression(
        input([
          session('2026-07-01', [[100, 12, 7], [100, 12, 7]]), // most recent, passed first
          session('2026-06-24', [[100, 9, 8]]),
        ]),
      ),
    );
    assert.equal(r.action, 'increase');
    assert.equal(r.targetWeightKg, 102.5);
  });
  it('ignores junk sets inside otherwise valid sessions', () => {
    const r = must(
      suggestProgression(
        input([
          session('2026-06-24', [[100, 10, 7]]),
          session('2026-07-01', [[100, 12, 7], [100, 0, null], [-1, 12, 7]]),
        ]),
      ),
    );
    assert.equal(r.action, 'increase');
    assert.equal(r.reason, 'Hit 1x12 @ RPE 7 last time — +2.5 kg');
  });
  it('a non-positive increment falls back to the 2.5 kg default', () => {
    const r = must(
      suggestProgression(
        input(
          [
            session('2026-06-24', [[100, 10, 7]]),
            session('2026-07-01', [[100, 12, 7]]),
          ],
          { incrementKg: 0 },
        ),
      ),
    );
    assert.equal(r.targetWeightKg, 102.5);
  });
});
