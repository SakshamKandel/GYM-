import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getReferrals, toRewardsError, type Referral } from '../../../lib/api/client';
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
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadedOnce = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A fresh account must never see the previous account's invites.
  useEffect(() => {
    if (status === 'signedOut') {
      loadedOnce.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets local state when the account signs out; guarded by the status check.
      setReferrals([]);
    }
  }, [status]);

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null) return;
    void (async () => {
      if (!loadedOnce.current) setLoading(true);
      try {
        const next = await getReferrals(token);
        // The session changed while the fetch was in flight (sign-out or
        // account switch) — a late response must not render the previous
        // account's invites.
        const current = useAuth.getState();
        if (current.status !== 'signedIn' || current.token !== token) return;
        if (!mounted.current) return;
        setReferrals(next);
        loadedOnce.current = true;
        setStale(false);
      } catch (err) {
        if (toRewardsError(err).code === 'unauthorized') {
          void useAuth.getState().refresh();
        }
        if (mounted.current) setStale(true);
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
  }, [status, token]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return { referrals, stale, loading, reload };
}
