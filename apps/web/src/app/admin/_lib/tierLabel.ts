import { GM_TIERS, type Tier } from '@gym/shared';

/**
 * The ONE place the console turns a membership tier into words an operator
 * reads. Names come from the GM_TIERS catalog in @gym/shared, so the console,
 * the app and the site all spell a tier the same way.
 *
 * Display copy ONLY — ranking and entitlement rules live in @gym/shared and are
 * enforced by the API. Underscore-prefixed folder, so Next never treats this as
 * a route. Mirrors the staffRoleLabel.ts pattern next door.
 *
 * Before this, screens printed the raw identifier ('gold') or hand-capitalised
 * it, which put a database value in front of someone deciding about money.
 */
export const TIER_LABELS: Record<Tier, string> = {
  starter: GM_TIERS.find((t) => t.tier === 'starter')?.name ?? 'Starter',
  silver: GM_TIERS.find((t) => t.tier === 'silver')?.name ?? 'Silver',
  gold: GM_TIERS.find((t) => t.tier === 'gold')?.name ?? 'Gold',
  elite: GM_TIERS.find((t) => t.tier === 'elite')?.name ?? 'Elite',
};

/**
 * A tier name for a value that came off the wire. Anything unrecognised passes
 * through untouched rather than being swallowed, so an operator still sees
 * something instead of a blank.
 */
export function tierLabel(raw: string): string {
  return raw in TIER_LABELS ? TIER_LABELS[raw as Tier] : raw;
}
