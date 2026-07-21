/**
 * Marketing UI kit v3 — "Paper & Iron" (see SPEC.md).
 *
 * Hybrid rhythm on every page: dark cinematic hero → light, Notion-clean
 * content sections (paper / paper-2) → dark closing band. Server-safe
 * primitives; animation lives in motion.tsx.
 */
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

/* ---------------------------------------------------------------- layout */

export function Container({
  children,
  className = '',
  wide = false,
}: {
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div className={`mx-auto w-full ${wide ? 'max-w-[1320px]' : 'max-w-[1200px]'} px-5 sm:px-8 ${className}`}>
      {children}
    </div>
  );
}

export type SectionTone = 'ink' | 'coal' | 'paper' | 'paper-2' | 'cream' | 'red';

const SECTION_TONES: Record<SectionTone, string> = {
  ink: 'bg-ink text-snow',
  coal: 'bg-coal text-snow',
  paper: 'bg-paper text-ink',
  'paper-2': 'bg-paper-2 text-ink',
  cream: 'bg-cream text-ink',
  red: 'bg-red text-ink',
};

export function isDarkTone(tone: SectionTone): boolean {
  return tone === 'ink' || tone === 'coal';
}

/**
 * Full-bleed section band. Dark tones get the ember light-field + grain;
 * paper tones stay crisp (optional faint blueprint grid via `grid`).
 */
export function Section({
  tone = 'paper',
  id,
  children,
  className = '',
  pad = 'py-24 sm:py-32',
  ambient,
  grid = false,
  overflowHidden = true,
}: {
  tone?: SectionTone;
  id?: string;
  children: ReactNode;
  className?: string;
  pad?: string;
  /** 'aurora' = loud light field, 'quiet' = subtle (default on dark), 'none'. */
  ambient?: 'aurora' | 'quiet' | 'none';
  /** Adds a fading blueprint grid layer behind content. */
  grid?: boolean;
  /** Set to false if section contains position: sticky children. */
  overflowHidden?: boolean;
}) {
  const dark = isDarkTone(tone);
  const resolved = ambient ?? (dark ? 'quiet' : 'none');
  const ambientClass =
    resolved === 'aurora' ? 'mkt-aurora' : resolved === 'quiet' ? 'mkt-aurora-quiet' : '';
  const texture = dark ? 'mkt-noise' : 'mkt-noise-light';
  return (
    <section
      id={id}
      className={`${texture} relative ${overflowHidden ? 'overflow-hidden' : ''} ${SECTION_TONES[tone]} ${pad} ${ambientClass} ${className}`}
    >
      {grid ? (
        <div
          aria-hidden
          className={`${dark ? 'mkt-gridlines' : 'mkt-gridlines-light'} absolute inset-0`}
        />
      ) : null}
      <div className="relative z-10">{children}</div>
    </section>
  );
}

/** Content-width hairline for separating paper sections. */
export function Hairline({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`mkt-hairline ${className}`} />;
}

/* ------------------------------------------------------------ typography */

/** Mono microlabel: `01 — TRAINING` voice. Sits above every big title. */
export function Eyebrow({
  children,
  className = '',
  tone = 'dark',
}: {
  children: ReactNode;
  className?: string;
  /** 'dark' = on dark sections, 'light' = on paper/cream, 'red' = on red. */
  tone?: 'dark' | 'light' | 'red';
}) {
  const color =
    tone === 'dark' ? 'text-dim' : tone === 'red' ? 'text-ink/70' : 'text-gravel';
  return (
    <p className={`font-mono text-[12px] font-medium uppercase tracking-[0.22em] ${color} ${className}`}>
      {children}
    </p>
  );
}

const DISPLAY_SIZES = {
  xl: 'text-[15vw] leading-[0.92] sm:text-7xl md:text-8xl',
  lg: 'text-5xl leading-[0.95] sm:text-6xl md:text-7xl',
  md: 'text-4xl leading-none sm:text-5xl',
  sm: 'text-2xl leading-tight sm:text-3xl',
} as const;

const DISPLAY_FLAVORS = {
  solid: '',
  steel: 'mkt-text-steel',
  ember: 'mkt-text-ember',
} as const;

/** Oswald condensed uppercase display headline. `flavor` adds gradient ink. */
export function Display({
  as = 'h2',
  size = 'lg',
  flavor = 'solid',
  children,
  className = '',
}: {
  as?: 'h1' | 'h2' | 'h3' | 'p';
  size?: keyof typeof DISPLAY_SIZES;
  flavor?: keyof typeof DISPLAY_FLAVORS;
  children: ReactNode;
  className?: string;
}) {
  const Tag = as;
  return (
    <Tag
      className={`font-display font-medium uppercase tracking-[-0.01em] ${DISPLAY_SIZES[size]} ${DISPLAY_FLAVORS[flavor]} ${className}`}
    >
      {children}
    </Tag>
  );
}

/** Secondary lead paragraph under a Display. */
export function Lead({
  children,
  className = '',
  tone = 'dark',
}: {
  children: ReactNode;
  className?: string;
  /** 'dark' = on dark sections, 'light' = on paper/cream, 'red' = on red. */
  tone?: 'dark' | 'light' | 'red';
}) {
  const color = tone === 'dark' ? 'text-dim' : tone === 'red' ? 'text-ink/75' : 'text-gravel';
  return <p className={`max-w-xl text-[17px] leading-relaxed ${color} ${className}`}>{children}</p>;
}

/* ----------------------------------------------------------------- CTAs */

type PillVariant = 'red' | 'ghost' | 'outline' | 'inkOnRed' | 'inkOnCream' | 'snow';

const PILL_VARIANTS: Record<PillVariant, string> = {
  red: 'mkt-shine bg-red text-ink shadow-ember hover:bg-red-glow hover:shadow-ember-lg',
  ghost: 'mkt-glass text-snow hover:border-white/25 hover:bg-white/10',
  outline:
    'border border-mist-strong bg-white/70 text-ink shadow-card hover:border-ink/25 hover:bg-white',
  inkOnRed: 'mkt-shine bg-ink text-snow hover:bg-coal',
  inkOnCream: 'bg-ink text-snow hover:bg-charcoal',
  snow: 'bg-snow text-ink hover:bg-cream',
};

export function PillLink({
  href,
  children,
  variant = 'red',
  className = '',
  small = false,
}: {
  href: string;
  children: ReactNode;
  /** red = primary everywhere · ghost = on dark · outline = on paper. */
  variant?: PillVariant;
  className?: string;
  small?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-sans font-semibold transition-all duration-200 active:scale-[0.97] ${
        small ? 'h-11 px-6 text-[14px]' : 'h-14 px-8 text-[15px]'
      } ${PILL_VARIANTS[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

/** Text link with an arrow that nudges on hover. */
export function ArrowLink({
  href,
  children,
  className = '',
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-2 font-sans text-[15px] font-semibold ${className}`}
    >
      {children}
      <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-1">
        →
      </span>
    </Link>
  );
}

/* ---------------------------------------------------------------- cards */

/**
 * Block card. tone="dark" = glass on dark sections; tone="light" = white
 * hairline card on paper. `hover` adds the matching lift treatment.
 */
export function Card({
  children,
  className = '',
  raised = false,
  hover = false,
  tone = 'dark',
  style,
}: {
  children: ReactNode;
  className?: string;
  raised?: boolean;
  /** Lift + edge highlight on hover (interactive cards). */
  hover?: boolean;
  tone?: 'dark' | 'light';
  style?: CSSProperties;
}) {
  const surface =
    tone === 'light'
      ? `mkt-card-light ${hover ? 'mkt-card-light-hover' : ''}`
      : `${raised ? 'mkt-glass' : 'mkt-glass-deep'} ${hover ? 'mkt-card-hover' : ''}`;
  return (
    <div style={style} className={`rounded-block ${surface} p-6 sm:p-8 ${className}`}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- stats */

/** Oversized stat: Oswald numeral + mono caption. */
export function StatBig({
  value,
  caption,
  tone = 'dark',
  className = '',
}: {
  value: ReactNode;
  caption: string;
  /** 'dark' = steel gradient on dark, 'light' = ink on paper. */
  tone?: 'dark' | 'light';
  className?: string;
}) {
  return (
    <div className={className}>
      <div
        className={`font-display text-6xl font-medium sm:text-7xl ${
          tone === 'light' ? 'text-ink' : 'mkt-text-steel'
        }`}
      >
        {value}
      </div>
      <p
        className={`mt-2 font-mono text-[12px] uppercase tracking-[0.18em] ${
          tone === 'light' ? 'text-gravel' : 'text-dim'
        }`}
      >
        {caption}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------ branding */

/** GM tile logomark (renders custom logo PNG). */
export function LogoMark({ size = 34, className = '' }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="The GM Method logo"
      width={size}
      height={size}
      className={`object-contain rounded-xl ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-display text-[17px] font-medium uppercase tracking-[0.08em] ${className}`}>
      The GM Method
    </span>
  );
}

/* ------------------------------------------------------------- helpers */

/** Feature checklist row (✓ list used across pages). */
export function CheckItem({
  children,
  tone = 'dark',
}: {
  children: ReactNode;
  /** 'dark' = on dark sections, 'light' = on paper/cream, 'red' = on red. */
  tone?: 'dark' | 'light' | 'red';
}) {
  const text = tone === 'dark' ? 'text-snow' : 'text-ink';
  const mark =
    tone === 'red' ? 'bg-ink text-red' : tone === 'light' ? 'bg-red text-ink' : 'bg-red text-ink';
  return (
    <li className={`flex items-start gap-3 text-[15px] leading-relaxed ${text}`}>
      <span
        aria-hidden
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${mark}`}
      >
        ✓
      </span>
      <span>{children}</span>
    </li>
  );
}

/** Photo framed inside a rounded block with an optional scrim caption. */
export function PhotoBlock({
  src,
  alt,
  caption,
  className = '',
  imgClassName = '',
}: {
  src: string;
  alt: string;
  caption?: string;
  className?: string;
  imgClassName?: string;
}) {
  return (
    <figure className={`relative overflow-hidden rounded-block ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className={`size-full object-cover ${imgClassName}`} />
      {caption ? (
        <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-6 pb-5 pt-16 font-mono text-[12px] uppercase tracking-[0.18em] text-snow">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
