import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  getCoachMessages,
  sendCoachMessage,
  toCoachError,
  type CoachMessage,
  type CoachThreadKind,
} from '../../lib/api/client';
import { useAuth } from '../../state/auth';

/**
 * One async coach thread (coach_chat or support). Loads on focus, polls
 * lightly while the thread is open (support is now human-async — an admin
 * can reply from the staff console while the member is sitting on this
 * screen, so focus-only loading would leave the reply invisible until they
 * navigate away and back), and appends optimistically on send. Offline
 * tolerant: a failed load keeps the last-known messages and flips `stale` so
 * the screen shows a quiet retry row instead of a blocking error. A failed
 * send rolls the optimistic bubble back.
 *
 * The AI Greece reply is generated SERVER-SIDE (the Groq key never ships in the
 * app). While the send round-trips — which is when the server generates the
 * reply — a transient "typing" coach bubble shows so the member sees Greece is
 * thinking; it's swapped for the real reply when the server responds.
 *
 * Mirrors useBuddyChatThread's poll shape (features/buddy/hooks.ts).
 */

/** Local-only optimistic id prefix so we can reconcile against server rows. */
const OPTIMISTIC_PREFIX = 'local-';
/** Transient "Greece is typing" bubble id — never persisted, never optimistic. */
const TYPING_PREFIX = 'typing-';
/** Foreground poll cadence while a thread is open — same as buddy DMs. */
const THREAD_POLL_MS = 12_000;

export interface CoachThread {
  /**
   * The thread, oldest → newest. While a reply is generating this includes a
   * transient coach "typing" bubble (id prefixed `typing-`) so the member sees
   * Greece is thinking; it's swapped for the real reply on send completion.
   */
  messages: CoachMessage[];
  /** First load with nothing cached yet. */
  loading: boolean;
  /** Latest load failed; we're showing the last-known thread. */
  stale: boolean;
  /** A send is in flight (disable the send button, show a spinner). */
  sending: boolean;
  /** The on-device coach reply is currently generating (typing indicator). */
  generating: boolean;
  /** Whether this account may send (Elite). Reads UI-only; server re-checks. */
  reload: () => void;
  /** Returns true on success. Never throws — errors surface as `sendError`. */
  send: (body: string) => Promise<boolean>;
  /** Last send failure code, or null. Cleared on the next successful send. */
  sendError: 'forbidden' | 'network' | null;
}

function isOptimistic(m: CoachMessage): boolean {
  return m.id.startsWith(OPTIMISTIC_PREFIX);
}

function isTyping(m: CoachMessage): boolean {
  return m.id.startsWith(TYPING_PREFIX);
}

/**
 * True for the transient "Greece is typing" bubble. Exported so the thread view
 * can render the animated indicator for it without re-hardcoding the id prefix.
 */
export function isTypingMessage(m: CoachMessage): boolean {
  return isTyping(m);
}

export function useCoachThread(kind: CoachThreadKind): CoachThread {
  const token = useAuth((s) => s.token);
  const status = useAuth((s) => s.status);

  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sendError, setSendError] = useState<'forbidden' | 'network' | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A fresh account must never inherit the previous account's thread.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (status === 'signedOut') {
      setMessages([]);
      loadedFor.current = null;
    }
  }, [status]);

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null) return;
    void (async () => {
      if (loadedFor.current !== token) setLoading(true);
      try {
        const next = await getCoachMessages(kind, token);
        if (!mounted.current) return;
        // Keep any still-in-flight optimistic bubbles ahead of the server set.
        // The transient "typing" bubble is UI-only and must never survive a
        // reload, so it's excluded here.
        setMessages((prev) => {
          const pending = prev.filter((m) => isOptimistic(m) && !isTyping(m));
          return [...next, ...pending];
        });
        loadedFor.current = token;
        setStale(false);
      } catch (err) {
        if (toCoachError(err).code === 'unauthorized') {
          void useAuth.getState().refresh();
        }
        if (mounted.current) setStale(true);
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
  }, [kind, status, token]);

  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setInterval> | null = null;

      const startTimer = () => {
        if (timer === null) timer = setInterval(reload, THREAD_POLL_MS);
      };
      const stopTimer = () => {
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };

      reload();
      startTimer();

      // Same AppState guard as useBuddyChatThread: pause polling while
      // backgrounded, refresh immediately and resume on return to foreground
      // — this is how a staff support reply (or a coach_chat one) shows up
      // without the member having to leave and re-open the screen.
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          reload();
          startTimer();
        } else {
          stopTimer();
        }
      });

      return () => {
        stopTimer();
        sub.remove();
      };
    }, [reload]),
  );

  const send = useCallback(
    async (raw: string): Promise<boolean> => {
      const body = raw.trim();
      if (body.length === 0 || token === null || status !== 'signedIn') return false;

      const now = Date.now();
      const optimistic: CoachMessage = {
        id: `${OPTIMISTIC_PREFIX}${now}`,
        kind,
        sender: 'user',
        body,
        createdAt: new Date(now).toISOString(),
        readByUser: true,
      };
      // Transient coach bubble shown while Greece "thinks" — swapped for the
      // real reply on completion, and stripped on any failure/reload.
      const typing: CoachMessage = {
        id: `${TYPING_PREFIX}${now}`,
        kind,
        sender: 'coach',
        body: '···',
        createdAt: new Date(now + 1).toISOString(),
        readByUser: true,
      };
      setMessages((prev) => [...prev, optimistic, typing]);
      setSending(true);
      setGenerating(true);
      setSendError(null);

      try {
        // The server generates Greece's reply in context while this round-trips
        // (the Groq key lives on the server). The typing bubble shows until it
        // responds with the real [user, coachReply] pair.
        const inserted = await sendCoachMessage(kind, body, token);
        if (mounted.current) {
          // Swap the optimistic user + typing bubbles for the server's real
          // [user, coachReply] pair. A focus reload landing mid-round-trip can
          // have already merged in the persisted real user row, so also drop any
          // existing row whose id is in `inserted` to avoid a duplicate key.
          const insertedIds = new Set(inserted.map((m) => m.id));
          setMessages((prev) => [
            ...prev.filter(
              (m) =>
                m.id !== optimistic.id && m.id !== typing.id && !insertedIds.has(m.id),
            ),
            ...inserted,
          ]);
        }
        return true;
      } catch (err) {
        const code = toCoachError(err).code;
        if (mounted.current) {
          // Roll the optimistic + typing bubbles back — the send didn't land.
          setMessages((prev) =>
            prev.filter((m) => m.id !== optimistic.id && m.id !== typing.id),
          );
          setSendError(code === 'forbidden' ? 'forbidden' : 'network');
          if (code === 'unauthorized') void useAuth.getState().refresh();
        }
        return false;
      } finally {
        if (mounted.current) {
          setSending(false);
          setGenerating(false);
        }
      }
    },
    [kind, status, token],
  );

  return { messages, loading, stale, sending, generating, reload, send, sendError };
}
