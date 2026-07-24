import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getReferrals, toRewardsError, type Referral } from '../../../lib/api/client';
import { isCurrentSessionRequest } from '../../../lib/sessionRequest';
import { useAuth } from '../../../state/auth';

/**
 * The signed-in user's sent invites, reloaded on every screen focus.
 * Ephemeral component state (not persisted) — the list is cheap to refetch
 * and only rendered on the dedicated /invite screen. Failures keep the
 * last-known list and flip `stale` so the screen shows a quiet retry row.
 */

export interface ReferralsData {
  referrals: Referral[];
  /** True when the latest refresh failed and we're showing the last known state. */
  stale: boolean;
  /** True only for the very first load with nothing fetched yet. */
  loading: boolean;
  reload: () => void;
}

export function useReferrals(): ReferralsData {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const [snapshot, setSnapshot] = useState<{ token: string; referrals: Referral[] } | null>(null);
  const [staleToken, setStaleToken] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null) return;
    const request = { token, sequence: ++requestSequence.current };
    void (async () => {
      setLoadingToken(token);
      try {
        const next = await getReferrals(token);
        // The session changed while the fetch was in flight (sign-out or
        // account switch) — a late response must not render the previous
        // account's invites.
        const current = useAuth.getState();
        if (
          !mounted.current ||
          current.status !== 'signedIn' ||
          !isCurrentSessionRequest(request, {
            token: current.token,
            sequence: requestSequence.current,
          })
        ) return;
        setSnapshot({ token, referrals: next });
        setStaleToken(null);
      } catch (err) {
        const current = useAuth.getState();
        if (
          !mounted.current ||
          current.status !== 'signedIn' ||
          !isCurrentSessionRequest(request, {
            token: current.token,
            sequence: requestSequence.current,
          })
        ) return;
        if (toRewardsError(err).code === 'unauthorized') {
          void useAuth.getState().refresh();
        }
        setStaleToken(token);
      } finally {
        const current = useAuth.getState();
        if (
          mounted.current &&
          current.status === 'signedIn' &&
          isCurrentSessionRequest(request, {
            token: current.token,
            sequence: requestSequence.current,
          })
        ) setLoadingToken(null);
      }
    })();
  }, [status, token]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const referrals = snapshot?.token === token ? snapshot.referrals : [];
  const stale = token !== null && staleToken === token;
  const loading = token !== null && snapshot?.token !== token && loadingToken === token;
  return { referrals, stale, loading, reload };
}
