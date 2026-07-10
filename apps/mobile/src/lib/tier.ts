import type { Tier } from '@gym/shared';
import { useAuth } from '../state/auth';
import { useProfile } from '../state/profile';

/**
 * The tier that gated UI should trust.
 *
 * Signed in → the SERVER-verified account tier (useAuth().user.tier); the
 * local profile tier is an upgrade-only mirror that is known to drift ABOVE
 * the server's value, so it must never win while a server value exists.
 * Signed out → the local profile tier (the local-first preview behavior).
 *
 * Subscribes to BOTH stores, so components re-render the moment either
 * changes — e.g. a paywall purchase adopting the server response, a coach
 * granting a tier picked up by refresh(), or a signed-out local preview.
 */
export function useEffectiveTier(): Tier {
  const serverTier = useAuth((s) => s.user?.tier ?? null);
  const localTier = useProfile((s) => s.tier);
  return serverTier ?? localTier;
}
