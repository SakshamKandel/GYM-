import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getCoachMessages } from '../../lib/api/client';
import { mmkvStorage } from '../../lib/mmkvStorage';
import { useAuth } from '../../state/auth';
import { getCheckIns, type ServerCheckIn } from './api';

/**
 * Weekly coach check-in state.
 *
 * `lastCheckInAt` (the newest check-in's yyyy-mm-dd date) is persisted so the
 * due-state works offline; hydrateCheckIns() reconciles it with the server
 * (GET /api/check-ins?limit=1) so a reinstall or a second device never nags
 * for a check-in the coach already has. The latest server row and the coach's
 * reply text live in memory only — they re-resolve on the next hydrate.
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
      });
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
  } catch {
    // Offline / expired session — the persisted local due-state covers it.
  } finally {
    hydrateInFlight = false;
  }
}
