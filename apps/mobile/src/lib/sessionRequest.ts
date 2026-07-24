/**
 * Identity captured when an account-bound request starts. The monotonically
 * increasing sequence also rejects an older request for the same session.
 */
export interface SessionRequestIdentity {
  token: string;
  sequence: number;
}

/** Current identity at the moment an async result wants to update UI state. */
export interface CurrentSessionRequestIdentity {
  token: string | null;
  sequence: number;
}

/**
 * Account-bound responses may update local state only while both their bearer
 * token and request sequence are still current.
 */
export function isCurrentSessionRequest(
  request: SessionRequestIdentity,
  current: CurrentSessionRequestIdentity,
): boolean {
  return request.token === current.token && request.sequence === current.sequence;
}
