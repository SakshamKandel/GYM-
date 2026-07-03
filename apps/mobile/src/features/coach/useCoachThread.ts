import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  getCoachMessages,
  sendCoachMessage,
  toCoachError,
  type CoachMessage,
  type CoachThreadKind,
} from '../../lib/api/client';
import { coachReplyAI } from '../../lib/ai/groq';
import { useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';

/**
 * One async coach thread (coach_chat or support). Loads on focus, appends
 * optimistically on send, and is offline-tolerant: a failed load keeps the
 * last-known messages and flips `stale` so the screen shows a quiet retry row
 * instead of a blocking error. A failed send rolls the optimistic bubble back.
 *
 * The AI Greece reply is generated ON-DEVICE (coachReplyAI, bundled Groq key)
 * the moment the user sends, and handed to the server to persist — so it works
 * with no server key set. While it generates, a transient "typing" coach bubble
 * shows so the member sees Greece is thinking. If generation returns null we
 * still persist the user message and let the server auto-ack.
 *
 * No real-time otherwise — messaging here is deliberately async.
 */

/** Local-only optimistic id prefix so we can reconcile against server rows. */
const OPTIMISTIC_PREFIX = 'local-';
/** Transient "Greece is typing" bubble id — never persisted, never optimistic. */
const TYPING_PREFIX = 'typing-';

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

export function useCoachThread(kind: CoachThreadKind): CoachThread {
  const token = useAuth((s) => s.token);
  const status = useAuth((s) => s.status);
  // Name for Greece's persona: the local profile is canonical; the account's
  // display name is the fallback for a fresh, not-yet-onboarded profile.
  const profileName = useProfile((s) => s.displayName);
  const authName = useAuth((s) => s.user?.displayName ?? '');
  const coachName = profileName.trim() || authName;

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
      reload();
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

      // Generate Greece's reply on-device (bundled Groq key). Include the just
      // -sent user turn so the model answers it. Prior turns are the current
      // thread minus our own transient bubbles. Never throws — null means the
      // server will fall back to its own reply / auto-ack.
      const history = [
        ...messages
          .filter((m) => !isTyping(m))
          .map((m) => ({ sender: m.sender, body: m.body })),
        { sender: 'user' as const, body },
      ];
      const reply = await coachReplyAI(kind, coachName, history);
      if (mounted.current) setGenerating(false);

      try {
        const inserted = await sendCoachMessage(kind, body, token, reply ?? undefined);
        if (mounted.current) {
          // Swap the optimistic user + typing bubbles for the server's real
          // [user, coachReply] pair.
          setMessages((prev) => [
            ...prev.filter((m) => m.id !== optimistic.id && m.id !== typing.id),
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
    [kind, status, token, coachName, messages],
  );

  return { messages, loading, stale, sending, generating, reload, send, sendError };
}
