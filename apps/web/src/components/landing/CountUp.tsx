'use client';

import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  /** Target value (integer or float — formatting is the caller's job). */
  value: number;
  /** Animation length in ms (default 900). */
  duration?: number;
  /** Renders the interpolated value — defaults to Math.round + toLocaleString. */
  format?: (value: number) => string;
  className?: string;
}

const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

/**
 * Animated numeral: counts from the previously displayed value to `value`
 * whenever `value` changes (first render counts up from 0 once the element is
 * on screen). Respects prefers-reduced-motion by jumping straight to the
 * target. Rendered inside a <span>; wrap in Oswald (--font-numeric) styles.
 */
export function CountUp({ value, duration = 900, format, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const fromRef = useRef(0);
  const frameRef = useRef(0);
  const [display, setDisplay] = useState(0);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setArmed(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setArmed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!armed) return;
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || duration <= 0) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }

    const from = fromRef.current;
    const start = performance.now();
    cancelAnimationFrame(frameRef.current);

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const next = from + (value - from) * easeOutQuint(progress);
      setDisplay(next);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [armed, value, duration]);

  return (
    <span ref={ref} className={className}>
      {format ? format(display) : Math.round(display).toLocaleString()}
    </span>
  );
}
