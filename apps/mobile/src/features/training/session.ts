import { create } from 'zustand';
import type { SetLog, WorkoutLog } from '@gym/shared';
import { checkPr, updateStreak } from '@gym/shared';
import { publishWorkoutActivity } from '../../lib/api/client';
import { nowIso, secondsBetween, todayIso } from '../../lib/dates';
import { getExercise } from '../../lib/exercises';
import { logHaptic, prHaptic, successHaptic, warnHaptic } from '../../lib/haptics';
import { uid } from '../../lib/id';
import { getRepo } from '../../lib/repo';
import { getPlanWorkout } from '../../lib/seed/plans';
import { useAuth } from '../../state/auth';
import { DEFAULT_ADHOC_SETS, DEFAULT_REST_SEC, nextIncompleteIndex } from './logic';

/**
 * Active workout session — a single zustand store so the rest timer keeps
 * ticking while the user scrolls, backgrounds the list, or adds exercises.
 * Everything logged goes straight to the repo; this store mirrors it for
 * instant UI. Rebuilds itself from the repo when resuming (app restart).
 */

export interface SessionExercise {
  exerciseId: string;
  exerciseName: string;
  equipment: string | null;
  targetSets: number;
  repRange: string | null;
  restSec: number;
  /** Sets committed this session, ordered by setNo. */
  loggedSets: SetLog[];
  /** Sets from the most recent previous session (ghost targets). */
  lastSets: SetLog[];
}

export interface RestState {
  totalSec: number;
  remainingSec: number;
  /** Epoch ms — remaining is always derived from this, so ticks never drift. */
  endsAt: number;
}

interface SessionState {
  status: 'idle' | 'active';
  workoutId: string | null;
  workoutName: string;
  startedAt: string | null;
  exercises: SessionExercise[];
  currentIdx: number;
  rest: RestState | null;
  /** Set id that should run its one-time PR flash, then clear. */
  flashSetId: string | null;

  /** Create a workout (or resume the active one). Used by /workout/start. */
  start: (planWorkoutId: string | null) => Promise<void>;
  /** Rebuild from the repo's active workout. False when none exists. */
  hydrate: () => Promise<boolean>;
  setCurrent: (idx: number) => void;
  addExercise: (exerciseId: string) => void;
  /** PR-check, persist, advance the pointer and start the rest timer. */
  commitSet: (weightKg: number, reps: number) => Promise<void>;
  startRest: (sec: number) => void;
  adjustRest: (deltaSec: number) => void;
  skipRest: () => void;
  clearFlash: () => void;
  /** Persist finish + streak. Returns the workout id for the recap route. */
  finish: () => Promise<string | null>;
  discard: () => Promise<void>;
  reset: () => void;
}

let restTimer: ReturnType<typeof setInterval> | null = null;

function stopRestTimer(): void {
  if (restTimer) {
    clearInterval(restTimer);
    restTimer = null;
  }
}

function planExerciseToSession(pe: {
  exerciseId: string;
  exerciseName: string;
  sets: number;
  repRange: string;
  restSec: number;
}): SessionExercise {
  return {
    exerciseId: pe.exerciseId,
    exerciseName: pe.exerciseName,
    equipment: getExercise(pe.exerciseId)?.equipment ?? null,
    targetSets: pe.sets,
    repRange: pe.repRange,
    restSec: pe.restSec,
    loggedSets: [],
    lastSets: [],
  };
}

export const useSession = create<SessionState>()((set, get) => {
  const runRestTimer = (): void => {
    stopRestTimer();
    restTimer = setInterval(() => {
      const r = get().rest;
      if (!r) {
        stopRestTimer();
        return;
      }
      const remaining = Math.ceil((r.endsAt - Date.now()) / 1000);
      if (remaining <= 0) {
        stopRestTimer();
        warnHaptic();
        set({ rest: null });
      } else if (remaining !== r.remainingSec) {
        set({ rest: { ...r, remainingSec: remaining } });
      }
    }, 250);
  };

  return {
    status: 'idle',
    workoutId: null,
    workoutName: '',
    startedAt: null,
    exercises: [],
    currentIdx: 0,
    rest: null,
    flashSetId: null,

    start: async (planWorkoutId) => {
      const repo = await getRepo();
      const active = await repo.getActiveWorkout();
      if (active) {
        // A workout is already running — resume it instead of stacking a new one.
        if (get().workoutId !== active.id || get().status !== 'active') {
          await get().hydrate();
        }
        return;
      }
      const pw = planWorkoutId ? getPlanWorkout(planWorkoutId) : undefined;
      const log: Omit<WorkoutLog, 'finishedAt' | 'durationSec'> = {
        id: uid(),
        date: todayIso(),
        planWorkoutId: pw?.id ?? null,
        name: pw ? pw.name : 'Freestyle',
        startedAt: nowIso(),
      };
      await repo.startWorkout(log);
      const exercises = pw ? pw.exercises.map(planExerciseToSession) : [];
      await Promise.all(
        exercises.map(async (e) => {
          e.lastSets = await repo.getLastSetsForExercise(e.exerciseId, log.id);
        }),
      );
      stopRestTimer();
      set({
        status: 'active',
        workoutId: log.id,
        workoutName: log.name,
        startedAt: log.startedAt,
        exercises,
        currentIdx: 0,
        rest: null,
        flashSetId: null,
      });
    },

    hydrate: async () => {
      const repo = await getRepo();
      const active = await repo.getActiveWorkout();
      if (!active) return false;
      if (get().workoutId === active.id && get().status === 'active') return true;

      const sets = await repo.getSetsForWorkout(active.id);
      const pw = active.planWorkoutId ? getPlanWorkout(active.planWorkoutId) : undefined;
      const byExercise = new Map<string, SessionExercise>();
      if (pw) {
        for (const pe of pw.exercises) byExercise.set(pe.exerciseId, planExerciseToSession(pe));
      }
      for (const s of sets) {
        let ex = byExercise.get(s.exerciseId);
        if (!ex) {
          ex = {
            exerciseId: s.exerciseId,
            exerciseName: s.exerciseName,
            equipment: getExercise(s.exerciseId)?.equipment ?? null,
            targetSets: DEFAULT_ADHOC_SETS,
            repRange: null,
            restSec: DEFAULT_REST_SEC,
            loggedSets: [],
            lastSets: [],
          };
          byExercise.set(s.exerciseId, ex);
        }
        ex.loggedSets.push(s);
      }
      const exercises = [...byExercise.values()];
      for (const e of exercises) e.loggedSets.sort((a, b) => a.setNo - b.setNo);
      await Promise.all(
        exercises.map(async (e) => {
          e.lastSets = await repo.getLastSetsForExercise(e.exerciseId, active.id);
        }),
      );
      let currentIdx = exercises.findIndex((e) => e.loggedSets.length < e.targetSets);
      if (currentIdx < 0) currentIdx = Math.max(0, exercises.length - 1);
      stopRestTimer();
      set({
        status: 'active',
        workoutId: active.id,
        workoutName: active.name,
        startedAt: active.startedAt,
        exercises,
        currentIdx,
        rest: null,
        flashSetId: null,
      });
      return true;
    },

    setCurrent: (idx) => {
      const { exercises } = get();
      if (idx >= 0 && idx < exercises.length) set({ currentIdx: idx });
    },

    addExercise: (exerciseId) => {
      const s = get();
      if (s.status !== 'active') return;
      const existing = s.exercises.findIndex((e) => e.exerciseId === exerciseId);
      if (existing >= 0) {
        set({ currentIdx: existing });
        return;
      }
      const info = getExercise(exerciseId);
      if (!info) return;
      const entry: SessionExercise = {
        exerciseId,
        exerciseName: info.name,
        equipment: info.equipment,
        targetSets: DEFAULT_ADHOC_SETS,
        repRange: null,
        restSec: DEFAULT_REST_SEC,
        loggedSets: [],
        lastSets: [],
      };
      set({ exercises: [...s.exercises, entry], currentIdx: s.exercises.length });
      // Ghost targets arrive in the background — no need to block the tap.
      void (async () => {
        const repo = await getRepo();
        const workoutId = get().workoutId;
        if (!workoutId) return;
        const lastSets = await repo.getLastSetsForExercise(exerciseId, workoutId);
        set({
          exercises: get().exercises.map((e) =>
            e.exerciseId === exerciseId ? { ...e, lastSets } : e,
          ),
        });
      })();
    },

    commitSet: async (weightKg, reps) => {
      const s = get();
      const idx = s.currentIdx;
      const ex = s.exercises[idx];
      if (!ex || !s.workoutId || s.status !== 'active') return;

      const repo = await getRepo();
      // PR check FIRST — history must exclude the workout we're logging into.
      const [bestE1Rm, bestWeight] = await Promise.all([
        repo.getBestE1Rm(ex.exerciseId, s.workoutId),
        repo.getBestWeight(ex.exerciseId, s.workoutId),
      ]);
      const pr = checkPr({
        weightKg,
        reps,
        previousBestE1Rm: bestE1Rm,
        previousBestWeightKg: bestWeight,
      });
      const setLog: SetLog = {
        id: uid(),
        workoutLogId: s.workoutId,
        exerciseId: ex.exerciseId,
        exerciseName: ex.exerciseName,
        setNo: ex.loggedSets.length + 1,
        weightKg,
        reps,
        rpe: null,
        isPr: pr.isPr,
        loggedAt: nowIso(),
      };
      await repo.logSet(setLog);

      // First-ever sets are PRs by definition — celebrate those quietly
      // (tag only); beating real history gets the full stamp + haptic burst.
      const loudPr = pr.isPr && pr.kind !== 'first';
      if (loudPr) prHaptic();
      else logHaptic();

      const exercises = get().exercises.map((e, i) =>
        i === idx ? { ...e, loggedSets: [...e.loggedSets, setLog] } : e,
      );
      const updated = exercises[idx];
      const complete = updated !== undefined && updated.loggedSets.length >= updated.targetSets;
      set({
        exercises,
        currentIdx: complete ? nextIncompleteIndex(exercises, idx) : idx,
        flashSetId: loudPr ? setLog.id : null,
      });
      get().startRest(ex.restSec);
    },

    startRest: (sec) => {
      if (sec <= 0) return;
      set({ rest: { totalSec: sec, remainingSec: sec, endsAt: Date.now() + sec * 1000 } });
      runRestTimer();
    },

    adjustRest: (deltaSec) => {
      const r = get().rest;
      if (!r) return;
      const endsAt = r.endsAt + deltaSec * 1000;
      const remaining = Math.ceil((endsAt - Date.now()) / 1000);
      if (remaining <= 0) {
        stopRestTimer();
        set({ rest: null });
        return;
      }
      set({
        rest: { totalSec: Math.max(r.totalSec, remaining), remainingSec: remaining, endsAt },
      });
    },

    skipRest: () => {
      stopRestTimer();
      set({ rest: null });
    },

    clearFlash: () => {
      if (get().flashSetId !== null) set({ flashSetId: null });
    },

    finish: async () => {
      const s = get();
      if (!s.workoutId || !s.startedAt) return null;
      const repo = await getRepo();
      const finishedAt = nowIso();
      const durationSec = secondsBetween(s.startedAt, finishedAt);
      await repo.finishWorkout(s.workoutId, finishedAt, durationSec);
      const streak = updateStreak(await repo.getStreak(), todayIso());
      await repo.setStreak(streak);

      // Buddy Sync: broadcast the finished session (fire-and-forget — the
      // helper swallows failures; buddies just won't see this one offline).
      const auth = useAuth.getState();
      if (auth.status === 'signedIn' && auth.token) {
        const sets = s.exercises.flatMap((e) => e.loggedSets);
        void publishWorkoutActivity(auth.token, {
          name: s.workoutName || 'Workout',
          date: todayIso(),
          durationSec,
          volumeKg: Math.round(sets.reduce((sum, x) => sum + x.weightKg * x.reps, 0)),
          prCount: sets.filter((x) => x.isPr).length,
        });
      }

      successHaptic();
      const id = s.workoutId;
      get().reset();
      return id;
    },

    discard: async () => {
      const s = get();
      if (!s.workoutId) return;
      const repo = await getRepo();
      await repo.deleteWorkout(s.workoutId);
      get().reset();
    },

    reset: () => {
      stopRestTimer();
      set({
        status: 'idle',
        workoutId: null,
        workoutName: '',
        startedAt: null,
        exercises: [],
        currentIdx: 0,
        rest: null,
        flashSetId: null,
      });
    },
  };
});
