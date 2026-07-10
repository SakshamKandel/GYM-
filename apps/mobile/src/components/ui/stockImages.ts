/**
 * Typed registry of the bundled stock photography in assets/images/stock/.
 * License: Unsplash — free for commercial use, no attribution required
 * (see manifest.json there for full descriptions and suggested uses).
 *
 * Metro can only bundle assets referenced by LITERAL require() calls,
 * hence this explicit table. Add new photos here, never require() photos
 * ad-hoc in screens.
 */
export const stockImages = {
  /** Low-angle man setting up a barbell deadlift on dark charcoal tiles — moody hero shot, great for text overlay. */
  heroBarbell: require('../../../assets/images/stock/hero-barbell.jpg'),
  /** Legs and strapped hands gripping a loaded barbell mid-deadlift setup — dark, empty floor space at left. */
  deadliftDark: require('../../../assets/images/stock/deadlift-dark.jpg'),
  /** Top-down view of a strapped hand gripping a barbell on near-black flooring — graphic, lots of dark negative space. */
  barbellGripOverhead: require('../../../assets/images/stock/barbell-grip-overhead.jpg'),
  /** Dramatic B&W rear view of a man doing pull-ups on a rig — portrait orientation, intense. */
  pullupsBw: require('../../../assets/images/stock/pullups-bw.jpg'),
  /** B&W rear view of a woman back-squatting a loaded barbell against black — landscape, powerful. */
  squatWomanBw: require('../../../assets/images/stock/squat-woman-bw.jpg'),
  /** Moody B&W side profile of a focused woman with a barbell on her shoulders — portrait, cinematic. */
  womanSquatPortraitBw: require('../../../assets/images/stock/woman-squat-portrait-bw.jpg'),
  /** Woman pressing a barbell overhead at a rack against a dark brick wall — strong and clean. */
  overheadPressWoman: require('../../../assets/images/stock/overhead-press-woman.jpg'),
  /** Close-up of a man lifting dumbbells off a rack — charcoal tones, shallow depth of field. */
  dumbbellRackGrab: require('../../../assets/images/stock/dumbbell-rack-grab.jpg'),
  /** Rows of black dumbbells in a bright daylight gym — airy and clean. */
  gymDumbbells: require('../../../assets/images/stock/gym-dumbbells.jpg'),
  /** Bright white modern gym with black-and-red bikes and racks, no people — red accents match the app palette. */
  gymInteriorBright: require('../../../assets/images/stock/gym-interior-bright.jpg'),
  /** B&W empty gym with treadmill rows and city windows — calm and premium. */
  gymEmptyBw: require('../../../assets/images/stock/gym-empty-bw.jpg'),
  /** Sprinter in starting blocks on a red track in bright sun — red surface echoes the accent color. */
  runnerTrack: require('../../../assets/images/stock/runner-track.jpg'),
  /** Three runners silhouetted against a deep blue dawn sky — aspirational cardio mood. */
  runnersSilhouetteBlue: require('../../../assets/images/stock/runners-silhouette-blue.jpg'),
  /** Legs in orange-grey sneakers running up concrete stairs — literal step-climbing motif. */
  runningStairs: require('../../../assets/images/stock/running-stairs.jpg'),
  /** Woman doing crunches on a black mat in front of bright windows — energetic daylight. */
  situpsWoman: require('../../../assets/images/stock/situps-woman.jpg'),
  /** Woman in a low-lunge yoga pose by the sea at sunset — serene recovery mood. */
  yoga: require('../../../assets/images/stock/yoga.jpg'),
  /** Overhead flat-lay of a colorful vegan bowl on grey wood — vibrant food shot. */
  foodBowl: require('../../../assets/images/stock/food-bowl.jpg'),
  /** Rustic flat-lay of a blue bowl with eggs, greens and avocado — warm food shot. */
  foodHealthy: require('../../../assets/images/stock/food-healthy.jpg'),
} as const;

export type StockImageKey = keyof typeof stockImages;

/**
 * Overall brightness of each photo (from manifest.json). 'dark' photos take
 * white overlay text almost anywhere; 'bright' photos need text kept inside
 * the PhotoCard bottom scrim.
 */
export const stockImageTone: Record<StockImageKey, 'dark' | 'bright'> = {
  heroBarbell: 'dark',
  deadliftDark: 'dark',
  barbellGripOverhead: 'dark',
  pullupsBw: 'dark',
  squatWomanBw: 'dark',
  womanSquatPortraitBw: 'dark',
  overheadPressWoman: 'dark',
  dumbbellRackGrab: 'dark',
  gymDumbbells: 'bright',
  gymInteriorBright: 'bright',
  gymEmptyBw: 'dark',
  runnerTrack: 'bright',
  runnersSilhouetteBlue: 'dark',
  runningStairs: 'bright',
  situpsWoman: 'bright',
  yoga: 'dark',
  foodBowl: 'bright',
  foodHealthy: 'bright',
};
