'use client';

/**
 * Membership card showcase — a 3D pointer-tilting GM member card rendered in
 * pure CSS/SVG metal gradients, with a tier switcher that swaps the palette.
 *
 * The metal hexes below are inlined from the app's cardMetals tokens — this is
 * the ONE sanctioned hex use on the marketing site (SPEC.md law 2 exemption:
 * dynamic style values). Pointer tilt is mouse-only and fully disabled under
 * prefers-reduced-motion.
 */
import { useState, type CSSProperties, type PointerEvent } from 'react';
import { useReducedMotion } from '../motion';

type CardTier = 'starter' | 'silver' | 'gold' | 'elite';

interface Metal {
  top: string;
  mid: string;
  deep: string;
  sheen: string;
  ink: string;
}

const METALS: Record<CardTier, Metal> = {
  starter: { top: '#33363C', mid: '#23262B', deep: '#15171A', sheen: '#5A5E66', ink: '#F2F3F5' },
  silver: { top: '#D9DCE1', mid: '#AEB3BB', deep: '#7E848E', sheen: '#F4F6F8', ink: '#1C1E22' },
  gold: { top: '#E8C878', mid: '#C9A24D', deep: '#8F6B24', sheen: '#F7E3AE', ink: '#241A05' },
  elite: { top: '#1B1D22', mid: '#101114', deep: '#050506', sheen: '#3C4048', ink: '#F5F0E6' },
};

/** Signal-red spine — part of every card face in the app. */
const STRIPE = '#FF3B30';

const TIERS: { tier: CardTier; label: string }[] = [
  { tier: 'starter', label: 'Starter' },
  { tier: 'silver', label: 'Silver' },
  { tier: 'gold', label: 'Gold' },
  { tier: 'elite', label: 'Elite' },
];

/** Concentric guilloché arcs — engraved-security-print texture. */
function Guilloche() {
  const rings = [26, 36, 46, 56, 66, 76, 86, 96, 106];
  return (
    <svg
      aria-hidden
      className="absolute -right-14 -top-20 opacity-[0.09]"
      width="280"
      height="280"
      viewBox="0 0 220 220"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.8"
    >
      {rings.map((r) => (
        <circle key={r} cx="110" cy="110" r={r} />
      ))}
      {rings.slice(0, 5).map((r) => (
        <circle key={`o${r}`} cx="150" cy="80" r={r} />
      ))}
    </svg>
  );
}

export function MembershipCardVisual({ initialTier = 'gold' }: { initialTier?: CardTier }) {
  const reduced = useReducedMotion();
  const [tier, setTier] = useState<CardTier>(initialTier);
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null);
  const m = METALS[tier];

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduced || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    setPt({
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    });
  };

  const rx = pt ? (0.5 - pt.y) * 11 : 0;
  const ry = pt ? (pt.x - 0.5) * 15 : 0;

  const cardStyle: CSSProperties = {
    transform: reduced ? undefined : `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`,
    transition: pt ? 'transform 90ms linear' : 'transform 700ms cubic-bezier(0.25, 1, 0.5, 1)',
    background: `linear-gradient(155deg, ${m.sheen} -14%, ${m.top} 20%, ${m.mid} 56%, ${m.deep} 102%)`,
    color: m.ink,
  };

  return (
    <div className="flex w-full flex-col items-center gap-7">
      {/* Perspective stage */}
      <div
        className="w-full max-w-[470px]"
        style={{ perspective: '1200px' }}
        onPointerMove={onMove}
        onPointerLeave={() => setPt(null)}
      >
        <div
          style={cardStyle}
          className="relative aspect-[1.586] w-full overflow-hidden rounded-[24px] shadow-pop will-change-transform"
          role="img"
          aria-label={`GM Method membership card in the ${tier} metal`}
        >
          {/* Brushed-metal grain */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'repeating-linear-gradient(105deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 4px), repeating-linear-gradient(105deg, rgba(0,0,0,0.04) 0px, rgba(0,0,0,0.04) 1px, transparent 1px, transparent 7px)',
            }}
          />
          <Guilloche />
          {/* Static sheen band */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background: `linear-gradient(115deg, transparent 30%, ${m.sheen}3d 46%, transparent 62%)`,
            }}
          />
          {/* Pointer-tracked glare */}
          {pt && !reduced ? (
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background: `radial-gradient(360px circle at ${(pt.x * 100).toFixed(1)}% ${(pt.y * 100).toFixed(1)}%, ${m.sheen}59, transparent 68%)`,
              }}
            />
          ) : null}
          {/* Signal-red stripe */}
          <span
            aria-hidden
            className="absolute bottom-0 left-0 top-0 w-[6px]"
            style={{ background: STRIPE }}
          />

          {/* Face content */}
          <div className="absolute inset-0 flex flex-col justify-between p-6 pl-8 sm:p-7 sm:pl-9">
            <div className="flex items-start justify-between">
              <div>
                {/* GM monogram — the app logomark glyph, inked in the metal's ink */}
                <svg width="46" height="23" viewBox="14 20 49 24" fill="currentColor" aria-hidden>
                  <path d="M14 20h17v7H21v10h7v-4h7v11H14V20Zm25 0h7l5 9 5-9h7v24h-8V33l-4 7-4-7v11h-8V20Z" />
                </svg>
                <p className="mt-2 font-display text-[12px] font-medium uppercase leading-none tracking-[0.24em]">
                  The GM Method
                </p>
              </div>
              <span className="font-mono text-[9.5px] uppercase tracking-[0.26em] opacity-70">
                Member
              </span>
            </div>

            {/* Contact chip */}
            <svg width="42" height="31" viewBox="0 0 42 31" aria-hidden className="opacity-60">
              <rect
                x="1"
                y="1"
                width="40"
                height="29"
                rx="6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M1 11h13M1 20h13M28 11h13M28 20h13M14 11v9M28 11v9"
                stroke="currentColor"
                strokeWidth="1"
                fill="none"
              />
            </svg>

            <div>
              <p className="font-mono text-[15px] tracking-[0.14em] sm:text-[17px]">
                GMMB 4X2K 9F21 QQ38
              </p>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div>
                  <p className="font-mono text-[8.5px] uppercase tracking-[0.24em] opacity-70">
                    Member name
                  </p>
                  <p className="mt-1 text-[13px] font-semibold tracking-[0.08em]">A. SHERPA</p>
                </div>
                <span className="font-display text-[24px] font-medium uppercase leading-none tracking-[0.12em]">
                  {tier}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tier switcher */}
      <div role="group" aria-label="Card metal by tier" className="mkt-glass flex rounded-full p-1">
        {TIERS.map(({ tier: t, label }) => (
          <button
            key={t}
            type="button"
            aria-pressed={tier === t}
            onClick={() => setTier(t)}
            className={`h-11 rounded-full px-4 text-[13px] font-semibold transition-colors sm:px-5 ${
              tier === t ? 'bg-snow text-ink' : 'text-dim hover:text-snow'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="text-center font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
        Metal follows your tier · ten face designs in the app
      </p>
    </div>
  );
}
