/**
 * Session creation is allowed only for active accounts. Keep this check at
 * every sign-in boundary; `userForToken` also enforces it for existing tokens.
 */
export function canCreateSession(status: string): boolean {
  return status === 'active';
}
