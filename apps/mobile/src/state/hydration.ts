import { useEffect, useState } from 'react';
import { useAuth } from './auth';
import { useProfile } from './profile';

let isHydratedGlobally = false;

function checkStores(): boolean {
  if (isHydratedGlobally) return true;
  const ready = useAuth.persist.hasHydrated() && useProfile.persist.hasHydrated();
  if (ready) isHydratedGlobally = true;
  return ready;
}

/**
 * True once both persisted stores (auth + profile) have rehydrated from
 * AsyncStorage. Route gates must wait for this — otherwise a signed-in user
 * gets a flash-redirect to the sign-in screen on every cold start.
 */
export function useStoresHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => checkStores());

  useEffect(() => {
    if (hydrated) return;
    const check = () => {
      if (checkStores()) {
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
