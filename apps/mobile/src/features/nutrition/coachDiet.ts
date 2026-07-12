import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { Tier } from '@gym/shared';
import { getMyCoachDiet, type CoachDietPlanRow, type CoachInfo } from '../../lib/api/client';
import { useAuth } from '../../state/auth';

/**
 * Food tab's "Coach diet plan" card + /coach-diet screen (SCALE-UP-PLAN §4.3).
 * Same shape as features/training/coachWorkouts.ts's useCoachWorkouts — loads
 * on focus while signed in, collapses the server's discriminated locked/ok
 * result into one render-ready state.
 */
export type CoachDietSection =
  /** Signed out, or the first load for this session hasn't resolved yet — render nothing. */
  | { kind: 'hidden' }
  /** The first fetch for this session failed (e.g. opened offline) and never
   *  produced a good snapshot — surface a message + retry instead of leaving
   *  the screen on an infinite skeleton. */
  | { kind: 'error'; retry: () => void }
  | { kind: 'locked'; requiredTier: Tier }
  | { kind: 'no-coach' }
  | { kind: 'ready'; plans: CoachDietPlanRow[]; coach: CoachInfo };

export function useCoachDiet(): CoachDietSection {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const [snap, setSnap] = useState<{ token: string; section: CoachDietSection } | null>(null);
  // Read inside reload() without making reload's identity depend on snap —
  // needed to know "did this session ever get a good response" without
  // re-subscribing useFocusEffect (which would re-fire reload) on every
  // snapshot change.
  const snapRef = useRef(snap);
  snapRef.current = snap;

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null) return;
    void (async () => {
      const result = await getMyCoachDiet(token);
      if (useAuth.getState().token !== token) return; // a sign-out/in raced this fetch

      if (result.kind === 'locked') {
        setSnap({ token, section: { kind: 'locked', requiredTier: result.requiredTier } });
      } else if (result.kind === 'ok') {
        setSnap({
          token,
          section: result.coach
            ? { kind: 'ready', plans: result.plans, coach: result.coach }
            : { kind: 'no-coach' },
        });
      } else {
        // 'unavailable' (offline/malformed). If this session already has a
        // good snapshot, keep it up quietly. Otherwise (e.g. /coach-diet
        // opened while offline, before any successful fetch) surface a
        // retry affordance rather than staying on 'hidden' forever.
        const prior = snapRef.current;
        const hasGoodSnapshot =
          prior !== null && prior.token === token && prior.section.kind !== 'error';
        if (!hasGoodSnapshot) {
          setSnap({ token, section: { kind: 'error', retry: reload } });
        }
      }
    })();
  }, [status, token]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const valid = snap !== null && snap.token === token;
  return valid ? snap.section : { kind: 'hidden' };
}
