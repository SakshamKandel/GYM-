import {
  createReferral,
  redeemInviteCode,
  toRewardsError,
  type RewardsErrorCode,
} from '../../../lib/api/client';
import { useAuth } from '../../../state/auth';

/**
 * Invite mutations — thin, never-throwing wrappers so components stay
 * declarative. Callers reload the list afterwards to reconcile with the
 * server.
 */

function currentToken(): string | null {
  const auth = useAuth.getState();
  return auth.status === 'signedIn' ? auth.token : null;
}

/**
 * null = the friend's email was saved; otherwise a typed code for the friendly
 * line. Nothing is sent to that address — the member passes the invite on
 * themselves.
 */
export async function sendReferral(email: string): Promise<RewardsErrorCode | null> {
  const token = currentToken();
  if (token === null) return 'unauthorized';
  try {
    await createReferral(token, email.trim().toLowerCase());
    return null;
  } catch (err) {
    return toRewardsError(err).code;
  }
}

/**
 * null = the code worked and both discounts are on; otherwise a typed code.
 * (Not named use* — that would read as a React hook to the lint rules.)
 */
export async function applyInviteCode(code: string): Promise<RewardsErrorCode | null> {
  const token = currentToken();
  if (token === null) return 'unauthorized';
  const trimmed = code.trim();
  if (trimmed.length === 0) return 'invalid';
  try {
    await redeemInviteCode(token, trimmed);
    return null;
  } catch (err) {
    return toRewardsError(err).code;
  }
}
