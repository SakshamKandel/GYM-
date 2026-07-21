import { useEffect } from 'react';

interface Props {
  onDone: () => void;
  size?: number;
}

/**
 * Web fallback for PrCelebration — Skia canvas particles don't run on web,
 * so this safely fires onDone immediately without loading Skia native modules.
 */
export function PrCelebration({ onDone }: Props) {
  useEffect(() => {
    onDone();
  }, [onDone]);

  return null;
}
