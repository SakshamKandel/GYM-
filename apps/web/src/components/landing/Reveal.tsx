'use client';

import {
  createElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

type RevealTag = 'div' | 'section' | 'article' | 'span' | 'li' | 'header' | 'figure' | 'aside';

export type RevealVariant = 'up' | 'fade' | 'scale' | 'left' | 'right';

interface RevealProps {
  children: ReactNode;
  /** Rendered element — defaults to div. */
  as?: RevealTag;
  variant?: RevealVariant;
  /** Stagger delay in ms, applied via --lp-delay. */
  delay?: number;
  className?: string;
  style?: CSSProperties;
  /** IntersectionObserver threshold (default 0.18). */
  threshold?: number;
  id?: string;
  'aria-label'?: string;
}

/**
 * Scroll-reveal wrapper for the landing surfaces. Pairs with the .lp-reveal
 * rules in motion.css: hidden until ~18% visible, then reveals once and stays.
 * No-JS / no-IntersectionObserver environments render fully visible, and
 * prefers-reduced-motion is honoured in CSS (content is never hidden).
 */
export function Reveal({
  children,
  as = 'div',
  variant = 'up',
  delay = 0,
  className,
  style,
  threshold = 0.18,
  id,
  'aria-label': ariaLabel,
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    if (node.getBoundingClientRect().top < window.innerHeight * 0.9) {
      // Already on screen at mount (above the fold) — reveal immediately so
      // the page never opens with blank space.
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        }
      },
      { threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return createElement(
    as,
    {
      ref,
      id,
      'aria-label': ariaLabel,
      className: className ? `lp-reveal ${className}` : 'lp-reveal',
      style: delay > 0 ? { ...style, '--lp-delay': `${delay}ms` } : style,
      'data-variant': variant,
      'data-shown': shown ? 'true' : 'false',
    },
    children,
  );
}
