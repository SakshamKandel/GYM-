import { trainingBucket, type MuscleGroup } from '../../lib/muscleMap';
import { stockImages, type StockImageKey } from '../ui/stockImages';

/**
 * Picks the Train-tab hero photo from the bundled stock set based on what the
 * user is about to train. Dark-toned photos only — the scrim plus a dark image
 * keeps white overlay text comfortably above 4.5:1 in the lower two-thirds of
 * the frame (per stockImageTone in ui/stockImages.ts).
 *
 * Pure mapping, no state — the same workout always shows the same photo. The
 * push/pull/legs bucket lives in lib/muscleMap so Home's hero picks alike.
 */

export function trainHeroImageKey(muscle: MuscleGroup | null, active: boolean): StockImageKey {
  if (active) return 'barbellGripOverhead';
  switch (trainingBucket(muscle)) {
    case 'pull':
      return 'pullupsBw';
    case 'legs':
      return 'squatWomanBw';
    case 'press':
      return 'overheadPressWoman';
    default:
      return 'heroBarbell';
  }
}

export function trainHeroImage(muscle: MuscleGroup | null, active: boolean) {
  return stockImages[trainHeroImageKey(muscle, active)];
}
