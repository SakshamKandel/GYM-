import { createReferral, toRewardsError, type RewardsErrorCode } from '../../../lib/api/client';
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

/** null = invite recorded; otherwise a typed error code for the friendly line. */
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
