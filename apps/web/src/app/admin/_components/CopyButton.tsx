'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/console';

/**
 * Copy a value and say so.
 *
 * The console hands out things that only matter once they are somewhere else: a
 * password reset link, a member code, an order number to quote on the phone.
 * Copying them was a button that looked identical before and after, and when
 * the clipboard was refused — an insecure origin, a locked-down browser — it
 * looked identical then too, so the operator pasted whatever had been in the
 * clipboard from an hour before.
 *
 * Here the label reports what happened, in place, and a refusal says what to do
 * instead rather than nothing at all. The button reserves room for the longer
 * of its two labels so a row of controls does not twitch when one is used.
 */
export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  size = 'sm',
  variant = 'ghost',
  disabled = false,
  onCopied,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'primary' | 'dark';
  disabled?: boolean;
  /** Called after a successful copy, e.g. to report it somewhere else. */
  onCopied?: () => void;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
      onCopied?.();
      timer.current = setTimeout(() => setState('idle'), 2500);
    } catch {
      // Clipboard refused. The value is still on screen to select by hand, so
      // the honest thing is to say that rather than pretend it worked.
      setState('failed');
      timer.current = setTimeout(() => setState('idle'), 6000);
    }
  }, [value, onCopied]);

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => void copy()}
        style={{ minWidth: `calc(${Math.max(label.length, copiedLabel.length)}ch + 32px)` }}
      >
        {state === 'copied' ? copiedLabel : label}
      </Button>
      {/* Empty at rest so the region exists before the first message does. */}
      <span
        role="status"
        aria-live="polite"
        style={{ fontSize: 12, color: 'var(--gt-danger)' }}
      >
        {state === 'failed' ? 'Could not copy. Select the text and copy it.' : ''}
      </span>
    </span>
  );
}
