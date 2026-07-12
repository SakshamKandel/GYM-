import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { Tier } from '@gym/shared';
import { getMyCoachWorkouts, type CoachInfo, type CoachWorkoutRow } from '../../lib/api/client';
import { useAuth } from '../../state/auth';

/**
 * Train tab's "From your coach" section (SCALE-UP-PLAN §4.3). Loads on focus
 * while signed in — same pattern as features/mentorship/hooks.ts's
 * useMyCoach, one step further: the server's discriminated locked/ok result
 * collapses into a single render-ready state so the section component never
 * touches the raw API result.
 *
 * NOT wired into pushRefresh's push→refresh map on purpose (that file is
 * off-limits for this workstream) — focus-reload is the same mechanism the
 * rest of the mentorship surfaces already rely on, so a coach's new/updated
 * workout shows up the moment the member returns to this tab.
 */
export type CoachWorkoutsSection =
  /** Signed out, or the first load for this session hasn't resolved yet — render nothing. */
  | { kind: 'hidden' }
  | { kind: 'locked'; requiredTier: Tier }
  | { kind: 'no-coach' }
  | { kind: 'ready'; workouts: CoachWorkoutRow[]; coach: CoachInfo };

export function useCoachWorkouts(): CoachWorkoutsSection {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const [snap, setSnap] = useState<{ token: string; section: CoachWorkoutsSection } | null>(null);

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null) return;
    void (async () => {
      const result = await getMyCoachWorkouts(token);
      if (useAuth.getState().token !== token) return; // a sign-out/in raced this fetch

      if (result.kind === 'locked') {
        setSnap({ token, section: { kind: 'locked', requiredTier: result.requiredTier } });
      } else if (result.kind === 'ok') {
        setSnap({
          token,
          section: result.coach
            ? { kind: 'ready', workouts: result.workouts, coach: result.coach }
            : { kind: 'no-coach' },
        });
      }
      // 'unavailable' (offline/malformed) — keep the last-known snapshot quietly.
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
