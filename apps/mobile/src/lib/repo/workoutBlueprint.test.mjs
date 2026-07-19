import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseWorkoutBlueprintJson,
  serializeWorkoutBlueprint,
} from './workoutBlueprint.ts';

const blueprint = {
  exercises: [
    {
      exerciseId: 'bench-press',
      exerciseName: 'Bench Press',
      equipment: 'barbell',
      targetSets: 4,
      repRange: '6-8',
      restSec: 150,
    },
    {
      exerciseId: 'coach:plan:item',
      exerciseName: 'Tempo Push-up',
      equipment: null,
      targetSets: 3,
      repRange: null,
      restSec: 60,
    },
  ],
};

describe('active-workout blueprint storage', () => {
  it('round-trips every exercise target needed after an app restart', () => {
    assert.deepEqual(parseWorkoutBlueprintJson(serializeWorkoutBlueprint(blueprint)), blueprint);
  });

  it('rejects malformed or unsafe persisted values instead of crashing hydration', () => {
    assert.equal(parseWorkoutBlueprintJson('{broken'), null);
    assert.equal(parseWorkoutBlueprintJson('{"exercises":[{"targetSets":0}]}'), null);
    assert.equal(parseWorkoutBlueprintJson('{"exercises":"not-an-array"}'), null);
  });
});
