import { useEffect, useState } from 'react';
import { useAuth } from './auth';
import { useProfile } from './profile';

/**
 * True once both persisted stores (auth + profile) have rehydrated from
 * AsyncStorage. Route gates must wait for this — otherwise a signed-in user
 * gets a flash-redirect to the sign-in screen on every cold start.
 */
export function useStoresHydrated(): boolean {
  const [hydrated, setHydrated] = useState(
    () => useAuth.persist.hasHydrated() && useProfile.persist.hasHydrated(),
  );

  useEffect(() => {
    if (hydrated) return;
    const check = () => {
      if (useAuth.persist.hasHydrated() && useProfile.persist.hasHydrated()) {
        setHydrated(true);
      }
    };
    const unsubAuth = useAuth.persist.onFinishHydration(check);
    const unsubProfile = useProfile.persist.onFinishHydration(check);
    check();
    return () => {
      unsubAuth();
      unsubProfile();
    };
  }, [hydrated]);

  return hydrated;
}
