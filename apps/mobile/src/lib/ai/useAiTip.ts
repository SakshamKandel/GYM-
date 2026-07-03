import { useCallback, useEffect, useRef, useState } from 'react';

import { getAiTip, type AiTipMessage } from '../api/client';
import { useAuth } from '../../state/auth';

type TipState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; text: string }
  | { status: 'error' };

/**
 * Fetch a short AI tip. The prompt is built by the caller via a function so the
 * tip refreshes when the inputs change. Generation runs SERVER-SIDE (the Groq
 * key never ships in the app), so a tip needs a signed-in token — signed-out
 * users simply get no tip (the card shows a quiet "unavailable" line). Results
 * are cached per-prompt-string to avoid redundant calls on re-renders.
 */
export function useAiTip(buildPrompt: () => AiTipMessage[], deps: unknown[]): {
  state: TipState;
  refresh: () => void;
} {
  const token = useAuth((s) => s.token);
  const [state, setState] = useState<TipState>({ status: 'idle' });
  const cache = useRef<Map<string, string>>(new Map());
  const promptKey = JSON.stringify(buildPrompt());

  const fetchTip = useCallback(async () => {
    if (token === null) {
      // No account → no server key access. Degrade quietly, don't call.
      setState({ status: 'error' });
      return;
    }
    const messages = buildPrompt();
    const key = JSON.stringify(messages);
    const cached = cache.current.get(key);
    if (cached) {
      setState({ status: 'done', text: cached });
      return;
    }
    setState({ status: 'loading' });
    const text = await getAiTip(messages, token);
    if (text) {
      cache.current.set(key, text);
      setState({ status: 'done', text });
    } else {
      setState({ status: 'error' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptKey, token]);

  useEffect(() => {
    void fetchTip();
  }, [fetchTip]);

  return { state, refresh: () => void fetchTip() };
}
