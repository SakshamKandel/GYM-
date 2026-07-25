import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AI_TIP_MAX_VARIETY, type AiTipRequestInput } from '@gym/shared';

import { getAiTip } from '../api/client';
import { useAuth } from '../../state/auth';

/**
 * Where the words on the card came from.
 *  - 'coach' the model wrote them from the member's numbers.
 *  - 'fixed' we wrote them (the goal-safety note), so the screen must NOT
 *    caption them as written by an AI coach.
 */
export type TipSource = 'coach' | 'fixed';

type TipState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; text: string; source: TipSource }
  | { status: 'error' };

/**
 * Focus-refresh TTL: tab refocus within this window reuses the tip already on
 * screen instead of asking for a new one (every tab switch used to be a fresh
 * model call). Module-level so it also survives screen remounts. The manual
 * "New tip" tap is NOT throttled, it always fetches.
 */
const TIP_TTL_MS = 30 * 60 * 1000;
let lastTipFetchAt = 0;

export interface AiTipOptions {
  /**
   * Hold the request until the caller's own numbers have settled. A screen
   * whose payload is assembled from several local reads that resolve one after
   * another would otherwise ask for a tip per read, and every one of those is a
   * real model call. While this is false the hook simply stays idle, which the
   * cards already render as the same loading state.
   *
   * Defaults to true, so a caller with nothing to wait for behaves as before.
   */
  ready?: boolean;
}

/**
 * Fetch a short coach tip. The caller passes a builder for the CLOSED payload
 * (card kind plus the member's training and body numbers) so the tip refreshes
 * when those numbers change. Nothing the member typed is ever included.
 *
 * Generation runs server-side, so a tip needs a signed-in token. Signed-out
 * members simply get no tip and the card stays quiet.
 *
 * Freshness: the first tip for a given set of numbers is cached so re-renders
 * do not re-ask. "New tip" bumps a variety counter that rides along as a plain
 * number, and the server appends it to its own prompt so the next answer takes
 * a different angle. Screen refocus does the same, but only after the TTL.
 *
 * Ordering: every request carries a monotonic sequence and only the newest may
 * write state. Without it, two calls started moments apart (numbers landing, or
 * a "New tip" tap over a request still in flight) showed whichever ANSWERED
 * last, which is not the same thing as the freshest.
 */
export function useAiTip(
  buildInput: () => AiTipRequestInput,
  deps: unknown[],
  options?: AiTipOptions,
): {
  state: TipState;
  refresh: () => void;
} {
  const token = useAuth((s) => s.token);
  const [state, setState] = useState<TipState>({ status: 'idle' });
  const [variety, setVariety] = useState(0);
  const cache = useRef<Map<string, { text: string; source: TipSource }>>(new Map());
  const inputKey = JSON.stringify(buildInput());
  const ready = options?.ready ?? true;
  // Newest request wins; bumped by EVERY attempt, cache hits included.
  const requestSequence = useRef(0);

  const fetchTip = useCallback(async () => {
    const sequence = ++requestSequence.current;
    if (token === null) {
      // No account, so no access to the server's key. Degrade quietly.
      setState({ status: 'error' });
      return;
    }
    const input = buildInput();
    // Only the first tip (variety 0) is cached, so re-renders do not re-ask.
    // Any refresh or focus (variety > 0) always fetches fresh.
    const key = JSON.stringify(input);
    if (variety === 0) {
      const cached = cache.current.get(key);
      if (cached) {
        setState({ status: 'done', text: cached.text, source: cached.source });
        return;
      }
    }
    setState({ status: 'loading' });
    const outcome = await getAiTip({ ...input, variety }, token);
    // A newer request started while this one was in flight — its answer is the
    // one the member must end up reading.
    if (sequence !== requestSequence.current) return;
    if (outcome.kind === 'unavailable') {
      setState({ status: 'error' });
      return;
    }
    const source: TipSource = outcome.kind === 'fixed' ? 'fixed' : 'coach';
    if (variety === 0) cache.current.set(key, { text: outcome.text, source });
    lastTipFetchAt = Date.now();
    setState({ status: 'done', text: outcome.text, source });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey, token, variety]);

  useEffect(() => {
    if (!ready) return;
    void fetchTip();
  }, [fetchTip, ready]);

  // Revisiting the screen brings a fresh tip, but only once the TTL has
  // lapsed, so rapid tab-hopping reuses what is already on screen. The very
  // first focus is skipped because the mount effect above already loaded it.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      if (Date.now() - lastTipFetchAt < TIP_TTL_MS) return;
      setVariety(nextVariety);
    }, []),
  );

  return { state, refresh: () => setVariety(nextVariety) };
}

/** Wrap rather than climb forever, so the counter stays inside its bounds. */
function nextVariety(current: number): number {
  return current >= AI_TIP_MAX_VARIETY ? 1 : current + 1;
}
