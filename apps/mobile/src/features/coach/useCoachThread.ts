import { useCallback, useEffect, useRef, useState } from 'react';
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
 * One async coach thread (coach_chat or support). Loads on focus, appends
 * optimistically on send, and is offline-tolerant: a failed load keeps the
 * last-known messages and flips `stale` so the screen shows a quiet retry row
 * instead of a blocking error. A failed send rolls the optimistic bubble back.
 *
 * No real-time — messaging here is deliberately async (the auto-ack makes the
 * thread feel answered until a real coach reply lands).
 */

/** Local-only optimistic id prefix so we can reconcile against server rows. */
const OPTIMISTIC_PREFIX = 'local-';

export interface CoachThread {
  messages: CoachMessage[];
  /** First load with nothing cached yet. */
  loading: boolean;
  /** Latest load failed; we're showing the last-known thread. */
  stale: boolean;
  /** A send is in flight (disable the send button, show a spinner). */
  sending: boolean;
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

export function useCoachThread(kind: CoachThreadKind): CoachThread {
  const token = useAuth((s) => s.token);
  const status = useAuth((s) => s.status);

  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [sending, setSending] = useState(false);
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
        setMessages((prev) => {
          const pending = prev.filter(isOptimistic);
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

      const optimistic: CoachMessage = {
        id: `${OPTIMISTIC_PREFIX}${Date.now()}`,
        kind,
        sender: 'user',
        body,
        createdAt: new Date().toISOString(),
        readByUser: true,
      };
      setMessages((prev) => [...prev, optimistic]);
      setSending(true);
      setSendError(null);

      try {
        const inserted = await sendCoachMessage(kind, body, token);
        if (mounted.current) {
          // Swap the optimistic bubble for the server's [user, autoAck] pair.
          setMessages((prev) => [...prev.filter((m) => m.id !== optimistic.id), ...inserted]);
        }
        return true;
      } catch (err) {
        const code = toCoachError(err).code;
        if (mounted.current) {
          // Roll the optimistic bubble back — the send didn't land.
          setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
          setSendError(code === 'forbidden' ? 'forbidden' : 'network');
          if (code === 'unauthorized') void useAuth.getState().refresh();
        }
        return false;
      } finally {
        if (mounted.current) setSending(false);
      }
    },
    [kind, status, token],
  );

  return { messages, loading, stale, sending, reload, send, sendError };
}
