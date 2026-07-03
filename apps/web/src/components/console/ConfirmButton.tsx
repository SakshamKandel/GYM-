'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';

/**
 * Two-step destructive button. First click arms it (label swaps to the
 * confirm text, turns danger-red); a second click within `armMs` (default 3s)
 * fires `onConfirm`. If the window lapses or focus leaves, it disarms — so a
 * stray click can never delete. `busy` disables and shows `busyLabel` while the
 * async action runs. Use for suspend / delete / revoke actions.
 */
export function ConfirmButton({
  label,
  confirmLabel = 'Confirm',
  busyLabel = 'Working…',
  onConfirm,
  busy = false,
  armMs = 3000,
  size = 'md',
}: {
  label: string;
  confirmLabel?: string;
  busyLabel?: string;
  onConfirm: () => void;
  busy?: boolean;
  armMs?: number;
  size?: 'sm' | 'md';
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function disarm() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setArmed(false);
  }

  function handleClick() {
    if (busy) return;
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), armMs);
      return;
    }
    disarm();
    onConfirm();
  }

  return (
    <Button
      variant={armed ? 'danger' : 'ghost'}
      size={size}
      disabled={busy}
      onClick={handleClick}
      onBlur={disarm}
    >
      {busy ? busyLabel : armed ? confirmLabel : label}
    </Button>
  );
}
