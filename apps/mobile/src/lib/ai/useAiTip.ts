import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { getAiTip, type AiTipMessage } from '../api/client';
import { useAuth } from '../../state/auth';

type TipState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; text: string }
  | { status: 'error' };

/**
 * Focus-refresh TTL: tab refocus within this window reuses the tip already on
 * screen instead of refiring the LLM call (every tab switch was a Groq hit).
 * Module-level so it also survives screen remounts. Manual "New tip" refresh
 * is NOT throttled — it always fetches.
 */
const TIP_TTL_MS = 30 * 60 * 1000;
let lastTipFetchAt = 0;

/**
 * Fetch a short AI tip. The prompt is built by the caller via a function so the
 * tip refreshes when the inputs change. Generation runs SERVER-SIDE (the Groq
 * key never ships in the app), so a tip needs a signed-in token — signed-out
 * users simply get no tip (the card shows a quiet "unavailable" line).
 *
 * Freshness: the very first tip for a given prompt is cached so re-renders don't
 * re-hit the API. Manual refresh always bumps an internal nonce that FORCES a
 * brand-new fact (bypassing the cache and nudging the model for variety).
 * Screen refocus does the same, but only once the 30-minute TTL has lapsed —
 * within the TTL the tip already on screen is reused.
 */
export function useAiTip(buildPrompt: () => AiTipMessage[], deps: unknown[]): {
  state: TipState;
  refresh: () => void;
} {
  const token = useAuth((s) => s.token);
  const [state, setState] = useState<TipState>({ status: 'idle' });
  const [nonce, setNonce] = useState(0);
  const cache = useRef<Map<string, string>>(new Map());
  const promptKey = JSON.stringify(buildPrompt());

  const fetchTip = useCallback(async () => {
    if (token === null) {
      // No account → no server key access. Degrade quietly, don't call.
      setState({ status: 'error' });
      return;
    }
    const messages = buildPrompt();
    // Only the first-load tip (nonce 0) is cached, so re-renders don't spam the
    // API. Any refresh/focus (nonce > 0) always fetches fresh.
    const key = JSON.stringify(messages);
    if (nonce === 0) {
      const cached = cache.current.get(key);
      if (cached) {
        setState({ status: 'done', text: cached });
        return;
      }
    }
    // After the first tip, append a variety nudge so the model reliably serves
    // a DIFFERENT fact instead of replaying its favourite line.
    const outgoing: AiTipMessage[] =
      nonce === 0
        ? messages
        : messages.map((m, i) =>
            i === 0 && m.role === 'system'
              ? {
                  ...m,
                  content: `${m.content} Give a DIFFERENT, fresh fact from any before — variety #${nonce}.`,
                }
              : m,
          );
    setState({ status: 'loading' });
    const text = await getAiTip(outgoing, token);
    if (text) {
      if (nonce === 0) cache.current.set(key, text);
      lastTipFetchAt = Date.now();
      setState({ status: 'done', text });
    } else {
      setState({ status: 'error' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptKey, token, nonce]);

  useEffect(() => {
    void fetchTip();
  }, [fetchTip]);

  // Revisiting the screen surfaces a fresh fact — but only after the TTL has
  // lapsed, so rapid tab-hopping reuses the tip instead of refiring the call.
  // Skip the very first focus — the mount effect above already loaded the
  // initial tip.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      if (Date.now() - lastTipFetchAt < TIP_TTL_MS) return;
      setNonce((n) => n + 1);
    }, []),
  );

  return { state, refresh: () => setNonce((n) => n + 1) };
}
