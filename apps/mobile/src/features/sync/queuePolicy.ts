/** Pure policy for a server-invalid workout batch. */
export type InvalidBatchDecision =
  | { kind: 'isolate'; retryWorkoutId: string }
  | { kind: 'quarantine'; workoutId: string }
  | { kind: 'stop' };

/**
 * A multi-row 400 is narrowed to the oldest row. A single-row 400 is
 * quarantined locally, never marked synced. Empty input stops defensively.
 */
export function decideInvalidWorkoutBatch(
  workoutIds: readonly string[],
): InvalidBatchDecision {
  const oldest = workoutIds[0];
  if (!oldest) return { kind: 'stop' };
  return workoutIds.length > 1
    ? { kind: 'isolate', retryWorkoutId: oldest }
    : { kind: 'quarantine', workoutId: oldest };
}
