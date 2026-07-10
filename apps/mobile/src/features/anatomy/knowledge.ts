import type { MuscleGroup } from '../../lib/muscleMap';

/**
 * Offline anatomy + training knowledge base, one entry per app muscle group.
 * Sources: standard anatomy references (Gray's Anatomy descriptions condensed
 * to plain language) + widely-accepted hypertrophy programming guidance
 * (Schoenfeld 2016-2021 volume/frequency meta-analyses, condensed). Written
 * for gym users, not clinicians — plain words, no citations in-app.
 */

export interface MuscleKnowledge {
  /** Anatomical name shown under the friendly label. */
  anatomicalName: string;
  /** Sub-parts users actually program around (heads/regions). */
  parts: readonly string[];
  /** Where it attaches, in plain words. */
  originInsertion: string;
  /** What it does — the movements it drives. */
  functions: readonly string[];
  /** Programming guidance. */
  training: {
    weeklySets: string;
    repRange: string;
    frequency: string;
    tips: readonly string[];
    mistakes: readonly string[];
  };
}

export const MUSCLE_KNOWLEDGE: Record<MuscleGroup, MuscleKnowledge> = {
  chest: {
    anatomicalName: 'Pectoralis major & minor',
    parts: ['Upper (clavicular head)', 'Middle (sternal head)', 'Lower (costal fibers)'],
    originInsertion:
      'Fans out from your collarbone, breastbone and ribs into the front of the upper-arm bone.',
    functions: [
      'Pushes the arms forward (pressing)',
      'Brings the arms together across the chest (flyes)',
      'Helps raise the arm (upper fibers)',
    ],
    training: {
      weeklySets: '10–20 hard sets',
      repRange: '6–12 for presses · 10–15 for flyes',
      frequency: '2× per week beats 1× at equal volume',
      tips: [
        'Incline pressing biases the upper chest; dips and decline bias the lower fibers.',
        'Full stretch at the bottom of flyes and presses drives most of the growth stimulus.',
        'Squeeze the bar inward ("crush grip") on presses to raise chest activation.',
      ],
      mistakes: [
        'Only flat benching — the upper chest lags without incline work.',
        'Cutting the range short: half-reps skip the stretched position that matters most.',
        'Letting the shoulders roll forward — keep shoulder blades pinched and down.',
      ],
    },
  },
  lats: {
    anatomicalName: 'Latissimus dorsi',
    parts: ['Upper/outer fibers (width)', 'Lower fibers (near the waist)'],
    originInsertion:
      'The largest back muscle — spans from your lower spine and pelvis up into the front of the upper arm.',
    functions: [
      'Pulls the arms down and back (pull-ups, pulldowns)',
      'Drives rowing motions with the elbows close',
      'Stabilizes the spine in heavy lifts',
    ],
    training: {
      weeklySets: '10–20 hard sets (shared with mid-back rows)',
      repRange: '6–12 heavy pulls · 10–15 pulldowns/pullovers',
      frequency: '2× per week',
      tips: [
        'Vertical pulls (pull-ups, pulldowns) bias width; a neutral close grip lets the lats work through the longest range.',
        'Think "elbows to hips", not "hands to chest" — the lats move the upper arm.',
        'Pullovers and straight-arm pulldowns isolate the lats without biceps fatigue.',
      ],
      mistakes: [
        'Swinging for reps — momentum robs the lats of tension.',
        'Pulling with the arms: if the biceps burn first, slow down and re-cue the elbows.',
        'Ignoring the stretch at the top of a pulldown or pull-up.',
      ],
    },
  },
  'middle back': {
    anatomicalName: 'Rhomboids & mid trapezius',
    parts: ['Rhomboid major/minor', 'Middle trapezius fibers'],
    originInsertion:
      'Runs from the spine between your shoulder blades onto the inner edge of each blade.',
    functions: [
      'Squeezes the shoulder blades together (rowing)',
      'Holds posture against rounding',
      'Stabilizes the blades during pressing',
    ],
    training: {
      weeklySets: '8–16 hard sets (rows count)',
      repRange: '8–15',
      frequency: '2× per week',
      tips: [
        'Chest-supported rows remove lower-back fatigue and isolate the mid-back.',
        'Pause each rep with the blades fully squeezed for a full second.',
        'Wide-elbow rows (elbows ~60°) hit the mid-back harder than close-elbow rows.',
      ],
      mistakes: [
        'Shrugging during rows — the traps take over when the weight is too heavy.',
        'Rowing to the wrong spot: pull to the lower chest for mid-back, to the waist for lats.',
      ],
    },
  },
  'lower back': {
    anatomicalName: 'Erector spinae',
    parts: ['Spinalis', 'Longissimus', 'Iliocostalis'],
    originInsertion:
      'Two thick columns running the length of your spine, from pelvis to skull.',
    functions: [
      'Straightens and extends the spine (deadlifts, back extensions)',
      'Resists rounding under load',
      'Side-bends and rotates the trunk',
    ],
    training: {
      weeklySets: '6–12 direct sets (deadlifts/squats give plenty indirectly)',
      repRange: '6–10 heavy hinges · 12–20 extensions',
      frequency: '1–2× per week; recovery is slow — leave 48h+ before heavy hinging again',
      tips: [
        'Back extensions with a rounded upper back and tucked chin isolate the erectors safely.',
        'Bracing hard (big breath, tight core) is lower-back training in every compound lift.',
        'Build up range gradually — the lower back rewards patience more than intensity.',
      ],
      mistakes: [
        'Training it to failure often — lower-back fatigue wrecks every other lift for days.',
        'Rounding under maximal load before you have built the capacity for it.',
      ],
    },
  },
  shoulders: {
    anatomicalName: 'Deltoids (+ rotator cuff)',
    parts: ['Front (anterior) head', 'Side (lateral) head', 'Rear (posterior) head', 'Rotator cuff underneath'],
    originInsertion:
      'Caps the shoulder — from collarbone and shoulder blade down to the outside of the upper arm.',
    functions: [
      'Front head: raises the arm forward, assists all pressing',
      'Side head: lifts the arm out sideways (width!)',
      'Rear head: pulls the arm backward, works in all rows',
    ],
    training: {
      weeklySets: '8–12 front (presses count) · 12–20 side · 12–20 rear',
      repRange: '6–10 presses · 12–20+ raises',
      frequency: '2–3× per week — raises recover fast',
      tips: [
        'The side delts make you look wider; prioritize lateral raises if aesthetics matter.',
        'Lean slightly into lateral raises (or use cables) to keep tension at the bottom.',
        'Rear delts respond to high volume: reverse flyes, face pulls, rope pulls to the forehead.',
      ],
      mistakes: [
        'Only pressing — presses barely grow the side and rear heads.',
        'Swinging heavy dumbbells on raises: the traps take over above ~60° of swing.',
        'Skipping rear delts, which unbalances posture and shoulder health.',
      ],
    },
  },
  traps: {
    anatomicalName: 'Trapezius',
    parts: ['Upper (neck slope)', 'Middle (blade squeeze)', 'Lower (blade depression)'],
    originInsertion:
      'A kite-shaped sheet from the base of the skull down the spine, out to the collarbone and shoulder blade.',
    functions: [
      'Upper: shrugs the shoulders, supports carries',
      'Middle: pulls the blades together',
      'Lower: pulls the blades down and rotates them upward overhead',
    ],
    training: {
      weeklySets: '8–15 (deadlifts and rows contribute heavily)',
      repRange: '8–12 shrugs · 10–20 carries/face pulls',
      frequency: '2× per week',
      tips: [
        'Heavy carries (farmer walks) load the traps for time — brutal and effective.',
        'Shrug "up and slightly back", pause at the top; range is short, control matters.',
        'Train the lower traps too (Y-raises, overhead shrugs) for healthy overhead pressing.',
      ],
      mistakes: [
        'Rolling the shoulders during shrugs — adds nothing, irritates the joint.',
        'Using straps for everything: grip-limited holds are free trap work.',
      ],
    },
  },
  biceps: {
    anatomicalName: 'Biceps brachii (+ brachialis)',
    parts: ['Long head (outer, the peak)', 'Short head (inner)', 'Brachialis (underneath)'],
    originInsertion:
      'From the shoulder blade down across two joints into the forearm bone (radius).',
    functions: [
      'Bends the elbow (curls, pulls)',
      'Rotates the palm upward (supination)',
      'Long head assists the front shoulder',
    ],
    training: {
      weeklySets: '8–14 direct sets (rows/pulldowns add more)',
      repRange: '8–15',
      frequency: '2–3× per week — small muscle, fast recovery',
      tips: [
        'Incline curls stretch the long head; preacher curls bias the short head.',
        'Hammer curls grow the brachialis, which pushes the biceps up for visual thickness.',
        'Full supination at the top (rotate pinky up) finishes the contraction.',
      ],
      mistakes: [
        'Swinging the torso — pin the elbows to your sides.',
        'Only curling heavy: the biceps respond well to strict 12–15 rep sets.',
      ],
    },
  },
  triceps: {
    anatomicalName: 'Triceps brachii',
    parts: ['Long head (inner, biggest)', 'Lateral head (outer horseshoe)', 'Medial head (deep)'],
    originInsertion:
      'Three heads — one from the shoulder blade, two from the arm bone — merging into the elbow tip.',
    functions: [
      'Straightens the elbow (all pressing, pushdowns)',
      'Long head also pulls the arm down toward the body',
    ],
    training: {
      weeklySets: '8–14 direct sets (presses add more)',
      repRange: '6–10 close-grip presses/dips · 10–15 extensions',
      frequency: '2–3× per week',
      tips: [
        'The long head only fully stretches with the arm overhead — overhead extensions are non-negotiable for size.',
        'Skullcrushers and JM presses load the triceps heavier than pushdowns.',
        'Lock out fully; the last 15° of extension is where the triceps finish the job.',
      ],
      mistakes: [
        'Only doing pushdowns — they barely train the long head, two-thirds of the muscle.',
        'Flared elbows on close-grip bench turning it into a chest press.',
      ],
    },
  },
  forearms: {
    anatomicalName: 'Forearm flexors & extensors',
    parts: ['Flexors (palm side — grip)', 'Extensors (back side)', 'Brachioradialis (thumb side)'],
    originInsertion:
      'Two dozen small muscles from the elbow bones into the wrist, hand and fingers.',
    functions: [
      'Grip: closing and holding (deadlifts, carries, pulls)',
      'Wrist curls and extension',
      'Brachioradialis assists elbow bending (hammer grip)',
    ],
    training: {
      weeklySets: '4–10 direct sets (heavy pulls without straps count double)',
      repRange: '10–20 wrist work · timed holds for grip',
      frequency: '2–3× per week; very fast recovery',
      tips: [
        'Dead hangs and heavy holds build grip fastest.',
        'Train extensors too (reverse wrist curls) — imbalance causes elbow pain.',
        'Reverse curls hit the brachioradialis and thicken the whole forearm.',
      ],
      mistakes: [
        'Straps on every set: your grip never gets a stimulus.',
        'Flexor-only work leading to golfer’s-elbow-style irritation.',
      ],
    },
  },
  quadriceps: {
    anatomicalName: 'Quadriceps femoris',
    parts: ['Rectus femoris (middle, crosses the hip)', 'Vastus lateralis (outer sweep)', 'Vastus medialis (teardrop)', 'Vastus intermedius (deep)'],
    originInsertion:
      'Four heads from the pelvis and thigh bone, merging through the kneecap into the shin.',
    functions: [
      'Straightens the knee (squats, presses, extensions)',
      'Rectus femoris also flexes the hip',
    ],
    training: {
      weeklySets: '10–18 hard sets',
      repRange: '5–10 squats · 8–15 presses/lunges · 10–20 extensions',
      frequency: '2× per week',
      tips: [
        'Depth grows quads: full-range squats beat heavy half-squats for size.',
        'Heels-elevated squats and hack squats bias the quads over the glutes.',
        'Leg extensions are the only lift that fully shortens the rectus femoris — worth keeping.',
      ],
      mistakes: [
        'Cutting depth as the weight goes up.',
        'Letting the hips shoot back first ("good-morning squat") — shifts the work to glutes and back.',
      ],
    },
  },
  hamstrings: {
    anatomicalName: 'Hamstrings',
    parts: ['Biceps femoris (outer)', 'Semitendinosus & semimembranosus (inner)'],
    originInsertion:
      'From the sit bones (and thigh bone) down behind the knee into the shin bones.',
    functions: [
      'Bends the knee (leg curls)',
      'Extends the hip (RDLs, hinges) — their main strength role',
      'Decelerates the leg when sprinting',
    ],
    training: {
      weeklySets: '8–16 hard sets',
      repRange: '6–10 hinges (RDLs) · 8–15 curls',
      frequency: '2× per week',
      tips: [
        'You need BOTH patterns: a hinge (RDL, good morning) and a curl (seated/lying).',
        'Seated leg curls train the hamstrings at longer length than lying curls — slightly better for growth.',
        'On RDLs, push the hips back and keep the bar dragging on the thighs; feel the stretch, stop before the back rounds.',
      ],
      mistakes: [
        'Treating squats as hamstring work — they contribute almost nothing to hamstring size.',
        'Bouncing the stretch on RDLs instead of controlling it.',
      ],
    },
  },
  glutes: {
    anatomicalName: 'Gluteus maximus, medius & minimus',
    parts: ['Maximus (power)', 'Medius/minimus (side stability)'],
    originInsertion:
      'From the back of the pelvis into the upper thigh bone and IT band.',
    functions: [
      'Extends the hip (standing up, thrusting, sprinting)',
      'Medius keeps the pelvis level on one leg',
      'Rotates and abducts the thigh',
    ],
    training: {
      weeklySets: '8–16 hard sets (squats/deads contribute)',
      repRange: '6–12 thrusts/squats · 10–20 abduction work',
      frequency: '2–3× per week',
      tips: [
        'Hip thrusts load the glutes at full contraction; deep squats and lunges load them at stretch — use both.',
        'Walking lunges and Bulgarian split squats are elite glute builders.',
        'Train the medius (side-lying raises, banded walks) for knee and hip health.',
      ],
      mistakes: [
        'Arching the lower back at the top of thrusts instead of tucking the pelvis.',
        'Squatting shallow and wondering why the glutes never fire.',
      ],
    },
  },
  calves: {
    anatomicalName: 'Gastrocnemius & soleus',
    parts: ['Gastrocnemius (visible diamond, works with straight knee)', 'Soleus (deep, works with bent knee)'],
    originInsertion:
      'From behind the knee and shin down through the Achilles tendon into the heel.',
    functions: [
      'Points the foot / raises the heel (calf raises, jumping, walking)',
      'Soleus is the endurance workhorse; gastroc is the power muscle',
    ],
    training: {
      weeklySets: '8–16 hard sets',
      repRange: '8–12 standing (gastroc) · 12–20 seated (soleus)',
      frequency: '2–4× per week — calves tolerate lots of frequency',
      tips: [
        'Full range: deep stretch at the bottom, pause, full rise, pause. No bouncing.',
        'Standing raises for the gastroc, seated raises for the soleus — you need both.',
        'A 2-second pause at the bottom removes the tendon bounce that steals the work.',
      ],
      mistakes: [
        'Fast partial bounces off the stretch — the Achilles does everything, the muscle nothing.',
        'Training calves once a week and expecting stubborn calves to change.',
      ],
    },
  },
  abdominals: {
    anatomicalName: 'Rectus abdominis, obliques & transverse',
    parts: ['Rectus abdominis (six-pack)', 'Obliques (sides, rotation)', 'Transverse (deep corset)'],
    originInsertion:
      'From the ribs and breastbone down to the pelvis; obliques wrap the waist diagonally.',
    functions: [
      'Curls the trunk (crunch pattern)',
      'Rotates and side-bends (obliques)',
      'Braces the spine under load (transverse + all of it)',
    ],
    training: {
      weeklySets: '6–12 direct sets',
      repRange: '8–15 weighted · 15–25 bodyweight',
      frequency: '2–3× per week',
      tips: [
        'Abs grow like any muscle: add load (cable crunches, weighted leg raises), not just reps.',
        'Visibility is body-fat, size is training — you need both for definition.',
        'Anti-rotation work (Pallof press, suitcase carries) trains the obliques’ real job.',
      ],
      mistakes: [
        'Hundreds of fast sit-ups instead of 10 hard, loaded reps.',
        'Pulling on the neck during crunches.',
      ],
    },
  },
  adductors: {
    anatomicalName: 'Hip adductors',
    parts: ['Adductor magnus (the big one)', 'Longus & brevis', 'Gracilis'],
    originInsertion:
      'From the pubic bone down the inner thigh into the thigh bone.',
    functions: [
      'Pulls the legs together',
      'Adductor magnus is a major hip extender in deep squats — a hidden squat muscle',
    ],
    training: {
      weeklySets: '4–8 direct sets (deep squats train them hard already)',
      repRange: '10–15',
      frequency: '1–2× per week',
      tips: [
        'Deep, wide-stance squats and sumo deadlifts are the best heavy adductor builders.',
        'The adduction machine is fine — use a full stretch and control.',
        'Copenhagen planks bulletproof the groin for sport.',
      ],
      mistakes: [
        'Stretching a strained groin hard instead of strengthening it gradually.',
        'Skipping them entirely — weak adductors cap your squat.',
      ],
    },
  },
  abductors: {
    anatomicalName: 'Glute medius/minimus & TFL',
    parts: ['Gluteus medius', 'Gluteus minimus', 'Tensor fasciae latae'],
    originInsertion:
      'From the outer pelvis into the top of the thigh bone and IT band.',
    functions: [
      'Lifts the leg out sideways',
      'Keeps the pelvis level every single step and on every single-leg exercise',
    ],
    training: {
      weeklySets: '4–8 direct sets',
      repRange: '12–20 · banded work to burn',
      frequency: '2× per week — great as warm-up activation too',
      tips: [
        'Single-leg work (split squats, step-ups) trains them functionally under real load.',
        'Banded lateral walks before squatting wake up the medius and steady the knees.',
        'Lean the torso slightly over the working hip on cable abductions for a stronger stretch.',
      ],
      mistakes: [
        'Only machine abduction with no single-leg strength work.',
        'Letting the hips wobble on lunges — that IS the abductors failing; slow down.',
      ],
    },
  },
  neck: {
    anatomicalName: 'Sternocleidomastoid & deep neck flexors/extensors',
    parts: ['Front (flexors)', 'Sides (SCM)', 'Back (extensors, upper traps)'],
    originInsertion:
      'From breastbone/collarbone and upper spine to the skull.',
    functions: [
      'Nods, tilts and rotates the head',
      'Stabilizes the head under contact and heavy carries',
    ],
    training: {
      weeklySets: '4–8 gentle sets',
      repRange: '15–25 slow reps',
      frequency: '2–3× per week, light and controlled',
      tips: [
        'Start with bodyweight neck curls/extensions lying on a bench; add plates only after weeks of consistency.',
        'Slow tempo, no jerking — the neck rewards patience and punishes ego.',
        'A thicker neck visibly changes your whole frame and protects against whiplash in contact sports.',
      ],
      mistakes: [
        'Loading too fast — neck strains linger for weeks.',
        'Full-speed bridging like a wrestler without years of base.',
      ],
    },
  },
};
