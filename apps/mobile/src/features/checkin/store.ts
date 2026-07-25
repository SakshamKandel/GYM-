import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { CoachApiError, getCoachMessages } from '../../lib/api/client';
import { mmkvStorage } from '../../lib/mmkvStorage';
import { useAuth } from '../../state/auth';
import { CheckInApiError, getAssignedCoachName, getCheckIns, type ServerCheckIn } from './api';

/**
 * Weekly coach check-in state.
 *
 * `lastCheckInAt` (the newest check-in's yyyy-mm-dd date) is persisted so the
 * due-state works offline; hydrateCheckIns() reconciles it with the server
 * (GET /api/check-ins?limit=1) so a reinstall or a second device never nags
 * for a check-in the coach already has. The latest server row, the coach's
 * reply text and whether a coach is assigned at all live in memory only —
 * they re-resolve on the next hydrate.
 *
 * The persisted state is fingerprinted to an account id: an account switch on
 * the same device resets it, so one member's cadence never leaks to another.
 */

export interface CoachReply {
  body: string;
  createdAt: string;
}

interface CheckInState {
  /** Date (yyyy-mm-dd) of the newest check-in, or null when never checked in. */
  lastCheckInAt: string | null;
  /** The account the persisted due-state belongs to. */
  accountId: string | null;
  /** Newest server check-in row (memory only — set by hydrate or a POST). */
  latest: ServerCheckIn | null;
  /** The coach's reply to `latest`, resolved from the coach thread. */
  coachReply: CoachReply | null;
  /**
   * Where a check-in actually goes, resolved from GET /api/me/coach:
   *  - `{ known: false }`     — not looked up yet (or the lookup failed).
   *  - `{ known: true, name }` — an active coach; `name` may be '' if unnamed.
   *  - `{ known: true, name: null }` — no coach reads these check-ins.
   * The card only claims a coach was told when `name` is a real assignment.
   */
  coachStatus: { known: false } | { known: true; name: string | null };

  /** Adopt the row a successful POST returned (server-confirmed only). */
  recordCheckIn: (row: ServerCheckIn) => void;
}

export const useCheckIn = create<CheckInState>()(
  persist(
    (set) => ({
      lastCheckInAt: null,
      accountId: null,
      latest: null,
      coachReply: null,
      coachStatus: { known: false },

      recordCheckIn: (row) => set({ latest: row, lastCheckInAt: row.date, coachReply: null }),
    }),
    {
      name: 'gym-tracker-checkin-v1',
      storage: createJSONStorage(() => mmkvStorage),
      // Only the due-state persists; server rows re-hydrate fresh.
      partialize: (s) => ({ lastCheckInAt: s.lastCheckInAt, accountId: s.accountId }),
    },
  ),
);

let hydrateInFlight = false;

/**
 * Reconcile due-state + coach reply with the server. Fire-and-forget: no-ops
 * when signed out or mid-flight, and swallows every failure — offline, the
 * persisted `lastCheckInAt` keeps the card working locally.
 *
 * The coach's reply routes through the existing coach message thread
 * (contract §3: the reply IS a coachMessages row, referenced by the check-in's
 * coachReplyMessageId), so its text is resolved from GET /api/coach/messages —
 * readable by any signed-in tier — with zero new server surface.
 */
export async function hydrateCheckIns(): Promise<void> {
  if (hydrateInFlight) return;
  const auth = useAuth.getState();
  if (auth.status !== 'signedIn' || !auth.token || !auth.user) return;
  hydrateInFlight = true;
  try {
    // Account switch on this device — the previous account's due-state must
    // neither suppress nor trigger this account's card.
    if (useCheckIn.getState().accountId !== auth.user.id) {
      useCheckIn.setState({
        accountId: auth.user.id,
        lastCheckInAt: null,
        latest: null,
        coachReply: null,
        coachStatus: { known: false },
      });
    }

    // Who reads this member's check-ins. Resolved BEFORE the check-in list so
    // an account with no check-ins yet (the early return below) still gets an
    // honest "sent" screen on its very first submit. Its own try/catch: a
    // failed lookup leaves `known: false`, which reads as "we don't know" and
    // never as "you have no coach".
    try {
      const name = await getAssignedCoachName(auth.token);
      useCheckIn.setState({ coachStatus: { known: true, name } });
    } catch (err) {
      if (err instanceof CheckInApiError && err.code === 'unauthorized') throw err;
      // Offline or a hiccup — keep whatever we last knew.
    }

    const rows = await getCheckIns(auth.token, 1);
    const latest = rows[0];
    if (latest === undefined) return; // no server check-ins yet — stays due

    const prev = useCheckIn.getState().lastCheckInAt;
    useCheckIn.setState({
      latest,
      // Keep whichever is newer — a just-POSTed local date must never regress.
      lastCheckInAt: prev !== null && prev > latest.date ? prev : latest.date,
    });

    if (latest.coachReplyMessageId !== null) {
      const messages = await getCoachMessages('coach_chat', auth.token);
      const reply = messages.find(
        (m) => m.id === latest.coachReplyMessageId && m.sender === 'coach',
      );
      useCheckIn.setState({
        coachReply: reply ? { body: reply.body, createdAt: reply.createdAt } : null,
      });
    } else {
      useCheckIn.setState({ coachReply: null });
    }
  } catch (err) {
    // A 401 means the cached session may be dead — hand it to the auth
    // store's guarded refresh (health-probe-gated, stale-token safe).
    const unauthorized =
      (err instanceof CheckInApiError || err instanceof CoachApiError) &&
      err.code === 'unauthorized';
    if (unauthorized) void useAuth.getState().refresh();
    // Otherwise offline — the persisted local due-state covers it.
  } finally {
    hydrateInFlight = false;
  }
}
