'use client';

/**
 * Marketing motion primitives v3 — built on motion (framer-motion).
 *
 * Everything honors prefers-reduced-motion twice over: MotionConfig
 * (reducedMotion="user", set in Shell) strips transform/layout animation, and
 * the imperative helpers (CountUp, Magnetic, Float, useStepLoop) check
 * useReducedMotion themselves.
 *
 * Primitives:
 *   Reveal       spring fade+rise on scroll into view (stagger via `delay`)
 *   Stagger/Item container-driven stagger grids
 *   WordStagger  word-by-word masked headline reveal (hero display type)
 *   Parallax     scroll-linked vertical drift for phones/photos
 *   Float        gentle idle bob for hero devices
 *   Magnetic     cursor-attracted hover for CTAs
 *   Marquee      edge-faded infinite chip strip (pauses on hover)
 *   CountUp      animated numeral on first view
 *   useInView / useStepLoop / useReducedMotion — hooks
 */
import {
  animate,
  motion,
  useInView as useMotionInView,
  useReducedMotion as useMotionReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';

/* ------------------------------------------------------------------ hooks */

export function useReducedMotion(): boolean {
  return useMotionReducedMotion() ?? false;
}

/**
 * True once the element has entered the viewport (fires once, never resets).
 * Kept for mock screens that sequence their own micro-demos.
 */
export function useInView<T extends Element>(
  margin = '-80px',
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const inView = useMotionInView(ref, { once: true, margin: margin as never });
  return [ref, inView];
}

/**
 * Looping step counter while in view (mock-screen micro-demos).
 * Returns the current step (stays at `freezeAt` when reduced motion is on).
 */
export function useStepLoop(
  steps: number,
  interval = 1600,
  freezeAt = 0,
): [React.RefObject<HTMLDivElement | null>, number] {
  const [ref, inView] = useInView<HTMLDivElement>('0px');
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!inView || reduced) return;
    const id = setInterval(() => setStep((s) => (s + 1) % steps), interval);
    return () => clearInterval(id);
  }, [inView, reduced, steps, interval]);
  return [ref, reduced ? freezeAt : step];
}

/* ----------------------------------------------------------------- spring */

/** The house spring: quick, calm, never bouncy-playful. */
export const SPRING = { type: 'spring', stiffness: 120, damping: 22, mass: 0.9 } as const;
export const SPRING_SOFT = { type: 'spring', stiffness: 90, damping: 20, mass: 1 } as const;

// Each entry is a motion-wrapped DOM tag; the union keeps `as` flexible
// without resorting to `any`.
const MOTION_TAGS: Record<string, ElementType> = {
  div: motion.div,
  section: motion.section,
  figure: motion.figure,
  figcaption: motion.figcaption,
  span: motion.span,
  p: motion.p,
  h1: motion.h1,
  h2: motion.h2,
  h3: motion.h3,
  li: motion.li,
  ul: motion.ul,
  blockquote: motion.blockquote,
};

/* ----------------------------------------------------------------- Reveal */

/**
 * Scroll-reveal wrapper. Children rise + fade in with a spring when scrolled
 * into view. `delay` (ms) staggers siblings.
 */
export function Reveal({
  as = 'div',
  delay = 0,
  className = '',
  children,
  style,
  y = 28,
}: {
  as?: ElementType;
  delay?: number;
  className?: string;
  children: ReactNode;
  style?: CSSProperties;
  /** Rise distance in px. */
  y?: number;
}) {
  const Tag = MOTION_TAGS[as as string] ?? motion.div;
  return (
    <Tag
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-70px' }}
      transition={{ ...SPRING, delay: delay / 1000 }}
      className={className}
      style={style}
    >
      {children}
    </Tag>
  );
}

/* ---------------------------------------------------------------- Stagger */

/** Container-driven stagger: children must be <StaggerItem>. */
export function Stagger({
  children,
  className = '',
  delay = 0,
  gap = 0.09,
}: {
  children: ReactNode;
  className?: string;
  /** ms before the first item animates. */
  delay?: number;
  /** seconds between siblings. */
  gap?: number;
}) {
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-70px' }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: gap, delayChildren: delay / 1000 } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className = '',
  y = 26,
}: {
  children: ReactNode;
  className?: string;
  y?: number;
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y },
        show: { opacity: 1, y: 0, transition: SPRING },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------ WordStagger */

/**
 * Hero headline reveal: each word slides up out of an overflow mask with a
 * staggered spring. Pass plain text; words split on spaces.
 */
export function WordStagger({
  text,
  className = '',
  wordClassName = '',
}: {
  text: string;
  className?: string;
  wordClassName?: string;
  delay?: number;
  gap?: number;
}) {
  return (
    <span className={`inline-block ${className}`}>
      <span className={wordClassName}>{text}</span>
    </span>
  );
}

/* --------------------------------------------------------------- Parallax */

/**
 * Scroll-linked vertical drift. Wrap phones/photos; content moves `range` px
 * up as the section crosses the viewport (and `range` down before entering).
 */
export function Parallax({
  children,
  className = '',
  range = 56,
}: {
  children: ReactNode;
  className?: string;
  /** Total drift in px (half up, half down). */
  range?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const y = useTransform(scrollYProgress, [0, 1], [range / 2, -range / 2]);
  const smooth = useSpring(y, { stiffness: 90, damping: 24, mass: 0.6 });
  return (
    <div ref={ref} className={className}>
      <motion.div style={{ y: smooth }}>{children}</motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ Float */

/** Gentle idle bob for hero devices (disabled for reduced motion). */
export function Float({
  children,
  className = '',
  amplitude = 9,
  duration = 6,
}: {
  children: ReactNode;
  className?: string;
  amplitude?: number;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      animate={{ y: [0, -amplitude, 0] }}
      transition={{ duration, repeat: Infinity, ease: 'easeInOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* --------------------------------------------------------------- Magnetic */

/**
 * Cursor-attracted hover for CTAs. Content eases toward the pointer inside a
 * small radius, then springs home. Pointer-fine devices only.
 */
export function Magnetic({
  children,
  className = '',
  strength = 0.32,
}: {
  children: ReactNode;
  className?: string;
  /** 0–1: how far the element chases the cursor. */
  strength?: number;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const onMove = (e: ReactMouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setOffset({
      x: (e.clientX - (r.left + r.width / 2)) * strength,
      y: (e.clientY - (r.top + r.height / 2)) * strength,
    });
  };

  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={() => setOffset({ x: 0, y: 0 })}
      animate={{ x: offset.x, y: offset.y }}
      transition={{ type: 'spring', stiffness: 180, damping: 16, mass: 0.4 }}
      className={`inline-block ${className}`}
    >
      {children}
    </motion.div>
  );
}

/* ---------------------------------------------------------------- Marquee */

/** Edge-faded infinite strip. Children are duplicated for the loop. */
export function Marquee({
  children,
  className = '',
  duration = 36,
}: {
  children: ReactNode;
  className?: string;
  /** Seconds per loop — larger = slower. */
  duration?: number;
}) {
  return (
    <div className={`mkt-marquee overflow-hidden ${className}`}>
      <div
        className="mkt-marquee-track flex w-max items-center"
        style={{ animationDuration: `${duration}s` }}
      >
        <div className="flex items-center">{children}</div>
        <div className="flex items-center" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- CountUp */

/** Animated count-up numeral. Starts when scrolled into view. */
export function CountUp({
  to,
  from = 0,
  duration = 1400,
  decimals = 0,
  prefix = '',
  suffix = '',
  className = '',
}: {
  to: number;
  from?: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLSpanElement>('0px');
  const reduced = useReducedMotion();
  const [value, setValue] = useState(from);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setValue(to);
      return;
    }
    const controls = animate(from, to, {
      duration: duration / 1000,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setValue(v),
    });
    return () => controls.stop();
  }, [inView, reduced, to, from, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {value.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}
