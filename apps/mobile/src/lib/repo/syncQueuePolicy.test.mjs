import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideInvalidWorkoutBatch } from '../../features/sync/queuePolicy.ts';

describe('workout sync queue invalid-payload handling', () => {
  it('isolates the oldest row from a rejected batch', () => {
    assert.deepEqual(decideInvalidWorkoutBatch(['oldest', 'later']), {
      kind: 'isolate',
      retryWorkoutId: 'oldest',
    });
  });

  it('quarantines a rejected single row instead of reporting it synced', () => {
    assert.deepEqual(decideInvalidWorkoutBatch(['bad-row']), {
      kind: 'quarantine',
      workoutId: 'bad-row',
    });
  });

  it('stops defensively on an empty batch', () => {
    assert.deepEqual(decideInvalidWorkoutBatch([]), { kind: 'stop' });
  });
});
