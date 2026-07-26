'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The console's answer to "did that work?".
 *
 * Most actions here used to end in silence. A reply sent, a status changed, a
 * link copied, a setting saved: the button un-greyed and that was the whole
 * report. Silence reads as failure, so operators clicked again, and clicking a
 * money action twice is not a small thing.
 *
 * This is the smallest fix that covers all of it: one line of text next to the
 * control that caused it, in the operator's own words, gone a few seconds
 * later. Success clears itself because it is a receipt, not a task; failure
 * stays until the next attempt because it is work.
 *
 * It is a live region, so it is announced rather than only drawn — the same
 * confirmation reaches someone who cannot see the button change.
 */

export type FeedbackTone = 'success' | 'error';

export interface Feedback {
  tone: FeedbackTone;
  message: string;
  /** Bumped per report so a repeat of the same message still announces. */
  nonce: number;
}

export interface FeedbackController {
  feedback: Feedback | null;
  /** Report a completed action, e.g. `succeed('Reply sent')`. */
  succeed: (message: string) => void;
  /** Report a refusal in plain words, e.g. `fail('That payout was already paid')`. */
  fail: (message: string) => void;
  clear: () => void;
}

/**
 * `clearSuccessAfterMs` is how long a receipt stays up. Four seconds is long
 * enough to read after looking back at the screen and short enough that it is
 * gone before the next action.
 */
export function useActionFeedback(clearSuccessAfterMs = 4000): FeedbackController {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const nonce = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => stopTimer, [stopTimer]);

  const succeed = useCallback(
    (message: string) => {
      stopTimer();
      setFeedback({ tone: 'success', message, nonce: ++nonce.current });
      timer.current = setTimeout(() => setFeedback(null), clearSuccessAfterMs);
    },
    [clearSuccessAfterMs, stopTimer],
  );

  const fail = useCallback(
    (message: string) => {
      stopTimer();
      setFeedback({ tone: 'error', message, nonce: ++nonce.current });
    },
    [stopTimer],
  );

  const clear = useCallback(() => {
    stopTimer();
    setFeedback(null);
  }, [stopTimer]);

  return { feedback, succeed, fail, clear };
}

/**
 * Draws whatever {@link useActionFeedback} is holding. Renders an empty live
 * region when there is nothing to say, so the region exists before the message
 * does and assistive tech actually announces the first one.
 *
 * `reserveSpace` keeps a line's worth of height at all times for the places
 * this sits directly above a table, where appearing and disappearing would
 * otherwise nudge every row.
 */
export function ActionFeedback({
  feedback,
  reserveSpace = false,
  align = 'left',
}: {
  feedback: Feedback | null;
  reserveSpace?: boolean;
  align?: 'left' | 'right';
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        alignItems: 'center',
        gap: 6,
        minHeight: reserveSpace ? 20 : undefined,
        fontSize: 13,
        lineHeight: '20px',
        color: feedback?.tone === 'error' ? 'var(--gt-danger)' : 'var(--gt-success)',
      }}
    >
      {feedback ? (
        // Keyed by the nonce so a repeat of the identical message replaces the
        // node rather than leaving it untouched. Without that, approving two
        // payments in a row announces the confirmation once: the text never
        // changed, so the live region had nothing to report the second time.
        <span
          key={feedback.nonce}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <span aria-hidden style={{ fontSize: 13, lineHeight: '20px' }}>
            {feedback.tone === 'error' ? '!' : '✓'}
          </span>
          <span>{feedback.message}</span>
        </span>
      ) : null}
    </div>
  );
}
