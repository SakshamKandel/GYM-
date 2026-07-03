import { useCallback, useEffect, useRef, useState } from 'react';

import { groqChat, type GroqMessage } from './groq';

type TipState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; text: string }
  | { status: 'error' };

/**
 * Fetch a short AI tip from Groq. The prompt is built by the caller via a
 * function so the tip refreshes when the inputs change. Results are cached
 * per-prompt-string to avoid redundant calls on re-renders.
 */
export function useAiTip(buildPrompt: () => GroqMessage[], deps: unknown[]): {
  state: TipState;
  refresh: () => void;
} {
  const [state, setState] = useState<TipState>({ status: 'idle' });
  const cache = useRef<Map<string, string>>(new Map());
  const promptKey = JSON.stringify(buildPrompt());

  const fetchTip = useCallback(async () => {
    const messages = buildPrompt();
    const key = JSON.stringify(messages);
    const cached = cache.current.get(key);
    if (cached) {
      setState({ status: 'done', text: cached });
      return;
    }
    setState({ status: 'loading' });
    const text = await groqChat(messages, { temperature: 0.8, maxTokens: 150 });
    if (text) {
      cache.current.set(key, text);
      setState({ status: 'done', text });
    } else {
      setState({ status: 'error' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptKey]);

  useEffect(() => {
    void fetchTip();
  }, [fetchTip]);

  return { state, refresh: () => void fetchTip() };
}
