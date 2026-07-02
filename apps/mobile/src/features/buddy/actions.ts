import {
  createReferral,
  endBuddySession,
  inviteBuddy,
  joinBuddySession,
  nudgeBuddy,
  removeBuddy,
  respondToBuddy,
  startBuddySession,
  startTrial,
  toBuddyError,
  type BuddyErrorCode,
  type StartedBuddySession,
  type TrialTier,
} from '../../lib/api/client';
import { todayIso } from '../../lib/dates';
import { useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';
import { useBuddyStore } from './store';

/**
 * Buddy mutations — thin, never-throwing wrappers so components stay
 * declarative. Each returns enough for the caller to update copy;
 * callers reload the list afterwards to reconcile with the server.
 */

function currentToken(): string | null {
  const auth = useAuth.getState();
  return auth.status === 'signedIn' ? auth.token : null;
}

/** null = invite sent; otherwise a typed error code for the friendly line. */
export async function sendInvite(email: string): Promise<BuddyErrorCode | null> {
  const token = currentToken();
  if (token === null) return 'unauthorized';
  try {
    await inviteBuddy(token, email.trim().toLowerCase());
    return null;
  } catch (err) {
    return toBuddyError(err).code;
  }
}

/** Accept or decline an incoming invite. False when the call failed. */
export async function respondInvite(linkId: string, accept: boolean): Promise<boolean> {
  const token = currentToken();
  if (token === null) return false;
  try {
    await respondToBuddy(token, linkId, accept);
    return true;
  } catch {
    return false;
  }
}

/** Unlink a buddy or cancel a pending outgoing invite. */
export async function removeLink(linkId: string): Promise<boolean> {
  const token = currentToken();
  if (token === null) return false;
  try {
    await removeBuddy(token, linkId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Nudge a buddy (1/day/buddy). Marks the local per-day ledger on success —
 * and on 429 too, since that means today's nudge was already spent.
 * Returns true when the button should show the "nudged today" fill.
 */
export async function sendNudge(linkId: string): Promise<boolean> {
  const token = currentToken();
  if (token === null) return false;
  try {
    await nudgeBuddy(token, linkId);
    useBuddyStore.getState().markNudged(linkId, todayIso());
    return true;
  } catch (err) {
    if (toBuddyError(err).code === 'nudge_limit') {
      useBuddyStore.getState().markNudged(linkId, todayIso());
      return true;
    }
    return false;
  }
}

// ── Live Sessions ──────────────────────────────────────────────

/** Start a live workout session. Returns the session or null on failure. */
export async function startLiveSession(
  workoutName: string,
): Promise<StartedBuddySession | null> {
  const token = currentToken();
  if (token === null) return null;
  try {
    return await startBuddySession(token, workoutName.trim());
  } catch {
    return null;
  }
}

/** End a live workout session. Returns true on success. */
export async function endLiveSession(sessionId: string): Promise<boolean> {
  const token = currentToken();
  if (token === null) return false;
  try {
    await endBuddySession(token, sessionId);
    return true;
  } catch {
    return false;
  }
}

/** Join a buddy's live session. Returns null on success, error code on failure. */
export async function joinLiveSession(sessionId: string): Promise<BuddyErrorCode | null> {
  const token = currentToken();
  if (token === null) return 'unauthorized';
  try {
    await joinBuddySession(token, sessionId);
    return null;
  } catch (err) {
    return toBuddyError(err).code;
  }
}

// ── Referrals ──────────────────────────────────────────────────

/** null = referral created; otherwise a typed error code. */
export async function sendReferral(email: string): Promise<BuddyErrorCode | null> {
  const token = currentToken();
  if (token === null) return 'unauthorized';
  try {
    await createReferral(token, email.trim().toLowerCase());
    return null;
  } catch (err) {
    return toBuddyError(err).code;
  }
}

// ── Trial ──────────────────────────────────────────────────────

/** null = trial started; otherwise a typed error code. */
export async function activateTrial(tier: TrialTier): Promise<BuddyErrorCode | null> {
  const token = currentToken();
  if (token === null) return 'unauthorized';
  try {
    await startTrial(token, tier);
    // Apply the trial tier locally so the app unlocks immediately.
    useProfile.getState().update({ tier });
    return null;
  } catch (err) {
    return toBuddyError(err).code;
  }
}
