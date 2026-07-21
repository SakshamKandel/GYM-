export interface ShowActiveWorkoutInput {
  workoutName: string;
  elapsedLabel: string;
}

export interface UpdateRestInput {
  workoutName: string;
  restRemainingLabel: string | null;
  elapsedLabel: string;
}

/** Ongoing workout notifications are an Android-only enhancement. */
export async function showActiveWorkout(_input: ShowActiveWorkoutInput): Promise<void> {}

export async function updateRest(_input: UpdateRestInput): Promise<void> {}

export async function clearActiveWorkout(): Promise<void> {}
