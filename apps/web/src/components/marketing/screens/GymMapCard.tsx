'use client';

/**
 * Wide (non-phone) gyms visual: a stylised abstract street map — dark strokes
 * on charcoal, zero real map data — with four red pins dropping in sequence
 * and one highlighted pin pulsing under a gym-name label chip.
 */
import { useInView } from '../motion';

const PINS = [
  { x: 16, y: 26 },
  { x: 71, y: 18 },
  { x: 82, y: 66 },
  { x: 27, y: 74 },
] as const;

const HIGHLIGHT = { x: 47, y: 46 } as const;

function PinGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={(size * 32) / 24} viewBox="0 0 24 32" fill="none" aria-hidden>
      <path
        d="M12 0a12 12 0 0 1 12 12c0 8.5-12 20-12 20S0 20.5 0 12A12 12 0 0 1 12 0Z"
        fill="#FF3B30"
      />
      <circle cx="12" cy="12" r="4.5" fill="#0B0C0D" />
    </svg>
  );
}

export function GymMapCard() {
  const [ref, inView] = useInView<HTMLDivElement>();

  return (
    <div ref={ref} className="mkt-glass-deep rounded-block p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[12px] uppercase tracking-[0.2em] text-dim">
          Nearby · Kathmandu valley
        </p>
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-dim">
          <span className="size-2 rounded-full bg-red shadow-ember" /> Verified gym
        </span>
      </div>

      {/* Stylised map */}
      <div className="relative mt-6 overflow-hidden rounded-[18px] border border-white/5 bg-charcoal-2">
        <svg viewBox="0 0 720 380" className="w-full" role="img" aria-label="Stylised street map with five gym location pins">
          {/* city blocks */}
          <rect x="70" y="52" width="130" height="86" rx="10" fill="#222428" />
          <rect x="238" y="30" width="170" height="108" rx="10" fill="#212327" />
          <rect x="452" y="60" width="122" height="120" rx="10" fill="#222428" />
          <rect x="96" y="196" width="150" height="112" rx="10" fill="#212327" />
          <rect x="300" y="216" width="188" height="96" rx="10" fill="#222428" />
          <rect x="540" y="238" width="128" height="92" rx="10" fill="#212327" />

          {/* river */}
          <path
            d="M-20 330 C 120 300, 180 360, 320 344 S 560 300, 740 336"
            fill="none"
            stroke="#1B2530"
            strokeWidth="14"
            strokeLinecap="round"
          />

          {/* main avenues */}
          <path
            d="M-10 168 C 150 150, 340 186, 500 164 S 660 130, 730 142"
            fill="none"
            stroke="#17181B"
            strokeWidth="16"
            strokeLinecap="round"
          />
          <path d="M226 -10 C 230 120, 210 260, 250 390" fill="none" stroke="#17181B" strokeWidth="14" strokeLinecap="round" />
          <path d="M512 -10 C 500 140, 530 250, 508 390" fill="none" stroke="#17181B" strokeWidth="12" strokeLinecap="round" />

          {/* side streets */}
          <path d="M-10 84 H 730" stroke="#191B1E" strokeWidth="6" />
          <path d="M-10 250 C 160 236, 420 262, 730 244" fill="none" stroke="#191B1E" strokeWidth="7" />
          <path d="M96 -10 C 110 100, 84 240, 108 390" fill="none" stroke="#191B1E" strokeWidth="6" />
          <path d="M372 -10 C 360 90, 390 200, 368 390" fill="none" stroke="#191B1E" strokeWidth="6" />
          <path d="M628 -10 C 640 120, 610 260, 636 390" fill="none" stroke="#191B1E" strokeWidth="6" />

          {/* ring road */}
          <circle cx="360" cy="188" r="150" fill="none" stroke="#2E3135" strokeWidth="3" strokeDasharray="4 10" opacity="0.8" />
        </svg>

        {/* Dropping pins (HTML overlay so transitions + ping honor reduced motion) */}
        {PINS.map((pin, i) => (
          <div
            key={`${pin.x}-${pin.y}`}
            className="absolute"
            style={{ left: `${pin.x}%`, top: `${pin.y}%`, transform: 'translate(-50%, -100%)' }}
          >
            <div
              className={`transition-all duration-500 ease-out ${
                inView ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'
              }`}
              style={{ transitionDelay: `${250 + i * 220}ms` }}
            >
              <PinGlyph />
            </div>
          </div>
        ))}

        {/* Highlighted pin — pulsing, with a name chip */}
        <div
          className="absolute"
          style={{ left: `${HIGHLIGHT.x}%`, top: `${HIGHLIGHT.y}%`, transform: 'translate(-50%, -100%)' }}
        >
          <div
            className={`relative transition-all duration-500 ease-out ${
              inView ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'
            }`}
            style={{ transitionDelay: '1200ms' }}
          >
            <span
              aria-hidden
              className="absolute left-1/2 top-[15px] size-9 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-red/25"
            />
            <PinGlyph size={34} />
            <span className="absolute left-[calc(100%+10px)] top-0 flex items-center gap-2 whitespace-nowrap rounded-full bg-cream px-3.5 py-1.5 text-[11.5px] font-bold text-ink shadow-pop">
              Wave Health Club
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-cream-dim">
                350 m
              </span>
            </span>
          </div>
        </div>
      </div>

      <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.16em] text-faint">
        Stylised view — the app shows each gym&rsquo;s exact pin and one-tap directions
      </p>
    </div>
  );
}
