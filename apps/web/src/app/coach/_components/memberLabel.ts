/**
 * How a member is named anywhere in the coach console.
 *
 * The platform rule is that coach and member contact details stay inside the
 * app — the business earns nothing once a pair moves off it. An email address
 * printed beside a name is the shortcut that makes leaving trivial, so the
 * console shows a display name and nothing else. When a member has not set a
 * name yet, the fallback is a neutral word, never their address.
 *
 * The admin console is a separate, properly permissioned surface and still
 * shows real addresses; this helper is only for coach-facing screens.
 */
export function memberLabel(displayName: string | null | undefined): string {
  return displayName?.trim() || 'Member';
}

/** First letter for a monogram avatar, derived from the display name only. */
export function memberInitial(displayName: string | null | undefined): string {
  return memberLabel(displayName).charAt(0).toUpperCase();
}
