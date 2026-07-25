import type { Tier } from '@gym/shared';
import { GM_TIERS } from '@gym/shared';
import { useAuth } from '../state/auth';

/**
 * The ONE place that turns a tier into words a member can read.
 *
 * `Tier` values are internal slugs ('gold'), and copy that interpolated them
 * raw — or hand-capitalised them with `charAt(0).toUpperCase()` — leaked the
 * identifier into member-facing text. The catalog in @gym/shared already
 * carries the display name, so read it from there and never re-spell it.
 */
export function tierName(tier: Tier): string {
  return GM_TIERS.find((t) => t.tier === tier)?.name ?? 'Starter';
}

/**
 * The tier that gated UI should trust.
 *
 * Signed in → the SERVER-verified account tier (useAuth().user.tier); the
 * local profile tier is an upgrade-only mirror that is known to drift ABOVE
 * the server's value, so it must never win while a server value exists.
 * Signed out → Starter. Paid access always needs a server-verified account;
 * stale local profile data can never mint an entitlement.
 *
 * Subscribes to BOTH stores, so components re-render the moment either
 * changes — e.g. a paywall purchase adopting the server response, a coach
 * granting a tier picked up by refresh(), or a signed-out local preview.
 */
export function useEffectiveTier(): Tier {
  const serverTier = useAuth((s) => s.user?.tier ?? null);
  return serverTier ?? 'starter';
}

/**
 * Non-hook twin for logic paths (store actions, hooks' load functions).
 * Same rule: the server tier wins while signed in; signed-out callers are
 * always Starter. Callers that need reactivity must use useEffectiveTier.
 */
export function effectiveTierNow(): Tier {
  return useAuth.getState().user?.tier ?? 'starter';
}
