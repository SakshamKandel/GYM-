/**
 * App-mock kit — the building blocks every fake phone screen is made of.
 *
 * These deliberately mirror the REAL app's revamp language (see
 * apps/mobile/REVAMP-BRIEF.md): near-black canvas, color-block cards with no
 * hairline borders, ONE red hero block per screen, black text on red/cream,
 * Oswald display numerals, pill chips, floating icon-pill tab bar.
 *
 * Design canvas is fixed 334 × 710 (see PhoneFrame). Absolute px sizes are
 * intentional — screens never reflow, they scale with the device.
 */
import type { CSSProperties, ReactNode } from 'react';

/* ------------------------------------------------------------------ root */

export function AppScreen({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={style}
      className={`absolute inset-0 flex flex-col overflow-hidden bg-ink font-sans text-snow no-scrollbar ${className}`}
    >
      <AppStatusBar />
      {children}
    </div>
  );
}

export function AppStatusBar() {
  return (
    <div className="flex h-[52px] shrink-0 items-end justify-between px-7 pb-1">
      <span className="w-[54px] text-center text-[14px] font-semibold tracking-tight">9:41</span>
      <span className="flex w-[54px] items-center justify-end gap-1.5">
        {/* signal */}
        <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor">
          <rect x="0" y="7" width="3" height="4" rx="1" />
          <rect x="4.5" y="5" width="3" height="6" rx="1" />
          <rect x="9" y="2.5" width="3" height="8.5" rx="1" />
          <rect x="13" y="0" width="3" height="11" rx="1" />
        </svg>
        {/* battery */}
        <svg width="24" height="11" viewBox="0 0 24 11" fill="none">
          <rect x="0.5" y="0.5" width="20" height="10" rx="3" stroke="currentColor" opacity="0.5" />
          <rect x="2" y="2" width="14" height="7" rx="1.5" fill="currentColor" />
          <path d="M22.5 3.5v4a2.2 2.2 0 0 0 0-4Z" fill="currentColor" opacity="0.5" />
        </svg>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------ typography */

/** Oswald uppercase micro-eyebrow (app `variant="label"`). */
export function AppEyebrow({
  children,
  onBlock = false,
  className = '',
}: {
  children: ReactNode;
  onBlock?: boolean;
  className?: string;
}) {
  return (
    <p
      className={`font-display text-[11px] font-medium uppercase tracking-[0.18em] ${
        onBlock ? 'text-ink/60' : 'text-dim'
      } ${className}`}
    >
      {children}
    </p>
  );
}

/** Huge Oswald screen title ("TODAY'S TRAINING"). */
export function AppTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={`font-display text-[34px] font-medium uppercase leading-[1.02] ${className}`}>
      {children}
    </h3>
  );
}

/** Oswald stat numeral. */
export function AppStat({
  children,
  size = 44,
  onBlock = false,
  className = '',
}: {
  children: ReactNode;
  size?: number;
  onBlock?: boolean;
  className?: string;
}) {
  return (
    <span
      style={{ fontSize: size, lineHeight: 1 }}
      className={`font-display font-medium ${onBlock ? 'text-ink' : 'text-snow'} ${className}`}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- blocks */

type BlockTone = 'red' | 'cream' | 'charcoal' | 'raised';

const BLOCK_TONES: Record<BlockTone, string> = {
  red: 'bg-red text-ink',
  cream: 'bg-cream text-ink',
  charcoal: 'bg-charcoal text-snow',
  raised: 'bg-charcoal-2 text-snow',
};

/** Chunky color-block card (radius.block ≈ 22 at mock scale, borderless). */
export function BlockCard({
  tone = 'charcoal',
  children,
  className = '',
}: {
  tone?: BlockTone;
  children: ReactNode;
  className?: string;
}) {
  return <div className={`rounded-[22px] p-4 ${BLOCK_TONES[tone]} ${className}`}>{children}</div>;
}

/** Outlined meta chip (chips ARE allowed borders in the app language). */
export function MetaChip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex h-[26px] items-center rounded-full border border-line-strong px-3 text-[10.5px] font-medium text-snow ${className}`}
    >
      {children}
    </span>
  );
}

/** Primary pill inside a red/cream block: black pill, white label. */
export function BlockPill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex h-[44px] items-center justify-center rounded-full bg-ink px-6 text-[13px] font-semibold text-snow ${className}`}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------- data viz */

/** Thick rounded progress bar. `onBlock` = black fill over rgba track. */
export function MiniBar({
  pct,
  onBlock = false,
  color,
  className = '',
}: {
  pct: number;
  onBlock?: boolean;
  /** Tailwind bg-* class for the fill when not onBlock (default red). */
  color?: string;
  className?: string;
}) {
  return (
    <div
      className={`h-[9px] overflow-hidden rounded-full ${
        onBlock ? 'bg-black/15' : 'bg-charcoal-3'
      } ${className}`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-1000 ease-out ${
          onBlock ? 'bg-ink' : (color ?? 'bg-red')
        }`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

/** SVG progress ring. */
export function MiniRing({
  size = 72,
  stroke = 8,
  pct,
  color = '#FF3B30',
  track = '#2E3135',
  children,
  className = '',
}: {
  size?: number;
  stroke?: number;
  pct: number;
  color?: string;
  track?: string;
  children?: ReactNode;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className={`relative ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped / 100)}
          style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(0.25,1,0.5,1)' }}
        />
      </svg>
      {children ? (
        <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- tab bar */

export type TabName = 'home' | 'train' | 'food' | 'meals' | 'gyms' | 'progress';

const TAB_ICONS: Record<TabName, { label: string; path: string }> = {
  home: {
    label: 'Home',
    path: 'M3 10.5 12 3l9 7.5V21h-6v-6h-6v6H3v-10.5Z',
  },
  train: {
    label: 'Train',
    path: 'M2 10h3v4H2v-4Zm17 0h3v4h-3v-4ZM6 7h3v10H6V7Zm9 0h3v10h-3V7Zm-6 4h6v2H9v-2Z',
  },
  food: {
    label: 'Food',
    path: 'M4 10a8 8 0 0 1 16 0v1H4v-1Zm-1 3h18v2a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-2Z',
  },
  meals: {
    label: 'Meals',
    path: 'M6 7V6a6 6 0 0 1 12 0v1h3l-1.5 13a2 2 0 0 1-2 1.8h-11A2 2 0 0 1 4.5 20L3 7h3Zm2 0h8V6a4 4 0 0 0-8 0v1Z',
  },
  gyms: {
    label: 'Gyms',
    path: 'M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7Zm0 9.5A2.5 2.5 0 1 0 12 6a2.5 2.5 0 0 0 0 5.5Z',
  },
  progress: {
    label: 'Progress',
    path: 'M4 20V10h4v10H4Zm6 0V4h4v16h-4Zm6 0v-7h4v7h-4Z',
  },
};

/** Floating icon-pill tab bar — active icon in a filled red cell well. */
export function AppTabBar({
  active,
  onTabChange,
}: {
  active: TabName;
  onTabChange?: (tab: TabName) => void;
}) {
  return (
    <div className="absolute inset-x-0 bottom-[16px] z-30 flex justify-center pointer-events-auto">
      <div className="flex items-center gap-1.5 rounded-full bg-charcoal-2 p-1.5 shadow-lg border border-line-strong/30 backdrop-blur-md">
        {(Object.keys(TAB_ICONS) as TabName[]).map((name) => {
          const isFocused = name === active;
          return (
            <button
              key={name}
              type="button"
              onClick={() => onTabChange?.(name)}
              title={TAB_ICONS[name].label}
              className={`relative flex size-[38px] items-center justify-center rounded-[12px] transition-all duration-200 ${
                isFocused
                  ? 'bg-red text-ink shadow-ember scale-105'
                  : 'bg-charcoal text-dim hover:text-snow hover:bg-charcoal-3'
              }`}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                <path d={TAB_ICONS[name].path} />
              </svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- header */

/** Top header row matching mobile (Avatar disc + Tier ring + Greeting + Streak + Gear) */
export function AppHeader({
  displayName = 'Athlete',
  greeting = 'Good morning',
  streak = '18 wks',
  tier = 'elite',
}: {
  displayName?: string;
  greeting?: string;
  streak?: string;
  tier?: 'starter' | 'silver' | 'gold' | 'elite';
}) {
  const tierRings = {
    starter: 'border-mist',
    silver: 'border-slate-300 shadow-[0_0_8px_rgba(217,220,225,0.4)]',
    gold: 'border-amber-400 shadow-[0_0_10px_rgba(232,200,120,0.5)]',
    elite: 'border-red shadow-ember',
  };

  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2">
      <div className="flex items-center gap-3">
        <div className={`relative flex size-10 items-center justify-center rounded-full border-2 bg-charcoal-2 font-display text-sm font-semibold text-snow ${tierRings[tier]}`}>
          {displayName.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-[11px] font-medium text-dim">{greeting}</p>
          <p className="text-[13px] font-bold text-snow leading-tight">{displayName}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 rounded-full border border-line-strong bg-charcoal-2 px-2.5 py-1 text-[11px] font-bold text-red">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 23c-4.97 0-9-3.58-9-8 0-4.19 3.01-7.26 6.16-10.42.34-.34.93-.1.93.38 0 2.22 1.34 3.75 2.91 3.75 1.57 0 2.5-1.5 2.5-3.5 0-1.84-.75-3.32-1.5-4.48-.27-.42.06-.98.54-.88C18.42 1.05 21 5.33 21 11c0 6.63-4.03 12-9 12Z" />
          </svg>
          {streak}
        </span>
        <button
          type="button"
          aria-label="Settings"
          className="flex size-8 items-center justify-center rounded-full bg-charcoal text-dim hover:text-snow"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- avatar */

/** Initial-letter avatar disc. */
export function AvatarDot({
  letter,
  className = '',
  tone = 'red',
}: {
  letter: string;
  className?: string;
  tone?: 'red' | 'cream' | 'blue';
}) {
  const tones = {
    red: 'bg-red text-ink',
    cream: 'bg-cream text-ink',
    blue: 'bg-blue text-white',
  } as const;
  return (
    <span
      className={`flex size-9 shrink-0 items-center justify-center rounded-full font-display text-[15px] font-medium ${tones[tone]} ${className}`}
    >
      {letter}
    </span>
  );
}

