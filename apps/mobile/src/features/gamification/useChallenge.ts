import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  getChallenge,
  joinChallenge,
  toGamificationError,
  type Challenge,
  type ChallengeJoinErrorCode,
} from '../../lib/api/social';
import { useAuth } from '../../state/auth';

/**
 * The caller's active coach challenge for the current month (or null).
 * Reloaded on screen focus — cheap single GET, no poll (the number moves at
 * most once a day). Failures keep the last-known challenge quietly; the
 * card simply doesn't render until the first successful load.
 */

export interface ChallengeData {
  challenge: Challenge | null;
  reload: () => void;
  /** Opt into the current challenge; caller reloads on success. */
  joinCurrentChallenge: () => Promise<ChallengeJoinErrorCode | null>;
}

export function useChallenge(): ChallengeData {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (status === 'signedOut') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets local state when the account signs out; guarded by the status check.
      setChallenge(null);
    }
  }, [status]);

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null) return;
    void (async () => {
      try {
        const next = await getChallenge(token);
        // A session change mid-fetch means this response belongs to the
        // previous account — never render it.
        const current = useAuth.getState();
        if (current.status !== 'signedIn' || current.token !== token) return;
        if (mounted.current) setChallenge(next);
      } catch (err) {
        if (toGamificationError(err).code === 'unauthorized') {
          void useAuth.getState().refresh();
        }
        // Otherwise keep the last-known challenge quietly.
      }
    })();
  }, [status, token]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const joinCurrentChallenge = useCallback(async (): Promise<ChallengeJoinErrorCode | null> => {
    if (token === null || challenge === null) return 'not_found';
    return joinChallenge(token, challenge.id);
  }, [token, challenge]);

  return { challenge, reload, joinCurrentChallenge };
}
