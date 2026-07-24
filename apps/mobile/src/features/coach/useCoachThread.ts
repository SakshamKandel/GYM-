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
import { isCurrentSessionRequest } from '../../lib/sessionRequest';
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
 * The typing bubble is ONLY honest when an instant reply is actually coming.
 * A member with an assigned HUMAN coach (and a non-Elite support ticket) gets
 * NO auto-reply — the server returns just the user's message and a person
 * answers later. Showing "typing" there implies an instant answer that never
 * comes. We learn this from the send response (`sender:'coach'` present ⇒ an
 * instant reply exists) and suppress the bubble on every subsequent send once
 * a thread is proven human-answered.
 *
 * Poll-driven thread: fetch on open, refresh on an interval, optimistic send.
 */

/** Local-only optimistic id prefix so we can reconcile against server rows. */
const OPTIMISTIC_PREFIX = 'local-';
/** Transient "Greece is typing" bubble id — never persisted, never optimistic. */
const TYPING_PREFIX = 'typing-';
/** Foreground poll cadence while a thread is open. */
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
  sendError: 'coach_unavailable' | 'forbidden' | 'network' | null;
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
  const [sendError, setSendError] = useState<
    'coach_unavailable' | 'forbidden' | 'network' | null
  >(null);
  // Every local snapshot is fingerprinted to the bearer token that produced
  // it. A different account renders an empty thread immediately, before the
  // focus effect has a chance to start its first request.
  const [stateToken, setStateToken] = useState<string | null>(null);
  const stateTokenRef = useRef<string | null>(null);
  const loadSequence = useRef(0);
  const sendSequence = useRef(0);
  // Whether a send yields an instant coach reply. Starts true so the classic
  // AI (Greece / Elite concierge) case shows the typing bubble; a send that
  // comes back with no coach row (human coach owns the reply, or non-Elite
  // support) flips this off so we stop faking an instant answer. Reset per
  // account below alongside the thread.
  const [instantReply, setInstantReply] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadedFor = useRef<string | null>(null);

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null) return;
    if (stateTokenRef.current !== token) {
      stateTokenRef.current = token;
      setStateToken(token);
      setMessages([]);
      setInstantReply(false);
      setStale(false);
      setSending(false);
      setGenerating(false);
      setSendError(null);
      loadedFor.current = null;
    }
    const request = { token, sequence: ++loadSequence.current };
    void (async () => {
      if (loadedFor.current !== token) setLoading(true);
      try {
        const next = await getCoachMessages(kind, token);
        const current = useAuth.getState();
        if (
          !mounted.current ||
          current.status !== 'signedIn' ||
          !isCurrentSessionRequest(request, {
            token: current.token,
            sequence: loadSequence.current,
          })
        ) return;
        // Keep any still-in-flight optimistic bubbles ahead of the server set.
        // The transient "typing" bubble is UI-only and must never survive a
        // reload, so it's excluded here.
        setMessages((prev) => {
          const pending = prev.filter((m) => isOptimistic(m) && !isTyping(m));
          return [...next, ...pending];
        });
        // Seed the typing-bubble honesty from history — without a server flag,
        // this is the only local signal. An AI/Elite thread answers every send
        // instantly, so it never ends on an unanswered user message; if the
        // newest persisted row is the member's own message, a human coach owns
        // this thread and no instant reply is coming, so don't fake a "typing"
        // bubble on the first send. Only ever flips OFF (a proven-instant thread
        // stays truthful); the empty first-message-ever case still needs a
        // server-provided assigned-coach flag to fully close.
        const newest = next[next.length - 1];
        if (newest !== undefined && newest.sender === 'user') setInstantReply(false);
        loadedFor.current = token;
        setStale(false);
      } catch (err) {
        const current = useAuth.getState();
        if (
          !mounted.current ||
          current.status !== 'signedIn' ||
          !isCurrentSessionRequest(request, {
            token: current.token,
            sequence: loadSequence.current,
          })
        ) return;
        if (toCoachError(err).code === 'unauthorized') {
          void useAuth.getState().refresh();
        }
        setStale(true);
      } finally {
        const current = useAuth.getState();
        if (
          mounted.current &&
          current.status === 'signedIn' &&
          isCurrentSessionRequest(request, {
            token: current.token,
            sequence: loadSequence.current,
          })
        ) setLoading(false);
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

      // AppState guard: pause polling while
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

      const ownsState = stateTokenRef.current === token;
      if (!ownsState) {
        stateTokenRef.current = token;
        setStateToken(token);
        setMessages([]);
        setInstantReply(false);
        setStale(false);
        setSendError(null);
        loadedFor.current = null;
      }
      const request = { token, sequence: ++sendSequence.current };

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
      // real reply on completion, and stripped on any failure/reload. Only
      // shown when this thread is known to produce an instant reply; a
      // human-coach (or non-Elite support) thread would never fill it, so we
      // don't fake one there.
      const typing: CoachMessage = {
        id: `${TYPING_PREFIX}${now}`,
        kind,
        sender: 'coach',
        body: '···',
        createdAt: new Date(now + 1).toISOString(),
        readByUser: true,
      };
      const showTyping = ownsState ? instantReply : false;
      setMessages((prev) =>
        showTyping ? [...prev, optimistic, typing] : [...prev, optimistic],
      );
      setSending(true);
      setGenerating(showTyping);
      setSendError(null);

      try {
        // The server generates Greece's reply in context while this round-trips
        // (the Groq key lives on the server). The typing bubble shows until it
        // responds with the real [user, coachReply] pair.
        const inserted = await sendCoachMessage(kind, body, token);
        const current = useAuth.getState();
        if (
          mounted.current &&
          current.status === 'signedIn' &&
          isCurrentSessionRequest(request, {
            token: current.token,
            sequence: sendSequence.current,
          })
        ) {
          // Learn whether this thread actually returns an instant coach reply,
          // so the next send suppresses (or keeps) the typing bubble honestly.
          setInstantReply(inserted.some((m) => m.sender === 'coach'));
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
        const current = useAuth.getState();
        if (
          mounted.current &&
          current.status === 'signedIn' &&
          isCurrentSessionRequest(request, {
            token: current.token,
            sequence: sendSequence.current,
          })
        ) {
          // Roll the optimistic + typing bubbles back — the send didn't land.
          setMessages((prev) =>
            prev.filter((m) => m.id !== optimistic.id && m.id !== typing.id),
          );
          setSendError(
            code === 'coach_unavailable'
              ? 'coach_unavailable'
              : code === 'forbidden'
                ? 'forbidden'
                : 'network',
          );
          if (code === 'unauthorized') void useAuth.getState().refresh();
        }
        return false;
      } finally {
        const current = useAuth.getState();
        if (
          mounted.current &&
          current.status === 'signedIn' &&
          isCurrentSessionRequest(request, {
            token: current.token,
            sequence: sendSequence.current,
          })
        ) {
          setSending(false);
          setGenerating(false);
        }
      }
    },
    [instantReply, kind, status, token],
  );

  const ownsState = token !== null && stateToken === token;
  return {
    messages: ownsState ? messages : [],
    loading: ownsState ? loading : status === 'signedIn' && token !== null,
    stale: ownsState ? stale : false,
    sending: ownsState ? sending : false,
    generating: ownsState ? generating : false,
    reload,
    send,
    sendError: ownsState ? sendError : null,
  };
}
