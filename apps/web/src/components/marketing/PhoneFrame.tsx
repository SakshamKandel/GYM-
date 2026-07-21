/**
 * Realistic iOS device frame (iPhone 15 Pro proportions — titanium rail,
 * Dynamic Island, side keys, screen glass reflection).
 *
 * The screen is a FIXED 334 × 710 design canvas: mock screens (see screens/)
 * lay out absolutely against that size, and the whole device scales via the
 * `scale` prop, so a screen never reflows. Use `tilt` to vary the angle —
 * never present two adjacent phones at the same angle.
 */
import type { CSSProperties, ReactNode } from 'react';

export const PHONE_W = 360;
export const PHONE_H = 736;
export const SCREEN_W = 334;
export const SCREEN_H = 710;

type Tilt = 'none' | 'left' | 'right' | 'up';

const TILT_TRANSFORMS: Record<Tilt, string> = {
  none: 'none',
  left: 'rotateY(14deg) rotateX(4deg) rotateZ(-2deg)',
  right: 'rotateY(-14deg) rotateX(4deg) rotateZ(2deg)',
  up: 'rotateX(10deg) rotateZ(-1deg)',
};

export function PhoneFrame({
  children,
  scale = 1,
  tilt = 'none',
  className = '',
  priority = false,
}: {
  children: ReactNode;
  scale?: number;
  tilt?: Tilt;
  className?: string;
  /** Reserved for future use (e.g. hero LCP tuning). */
  priority?: boolean;
}) {
  void priority;
  const outer: CSSProperties = {
    width: PHONE_W * scale,
    maxWidth: '100%',
    height: PHONE_H * scale,
    perspective: tilt === 'none' ? undefined : '2200px',
  };
  const device: CSSProperties = {
    width: PHONE_W,
    height: PHONE_H,
    transform: `scale(${scale}) ${TILT_TRANSFORMS[tilt] === 'none' ? '' : TILT_TRANSFORMS[tilt]}`,
    transformOrigin: 'top left',
    transformStyle: 'preserve-3d',
  };

  return (
    <div style={outer} className={`relative max-w-full ${className}`} aria-hidden>
      {/* Ember light field behind the device */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(46% 42% at 50% 52%, rgb(255 59 48 / 0.32), rgb(255 59 48 / 0.08) 55%, transparent 72%)',
          filter: 'blur(46px)',
          transform: 'scale(1.45)',
        }}
      />
      {/* Floor glow */}
      <div
        className="pointer-events-none absolute bottom-[-6%] left-1/2 h-[10%] w-[120%] -translate-x-1/2"
        style={{
          background: 'radial-gradient(50% 100% at 50% 0%, rgb(255 59 48 / 0.25), transparent 70%)',
          filter: 'blur(24px)',
        }}
      />
      <div style={device} className="absolute left-0 top-0">
        {/* Titanium rail */}
        <div
          className="absolute inset-0 rounded-[58px] shadow-phone"
          style={{
            background:
              'linear-gradient(145deg, #8d9096 0%, #4a4d52 18%, #2b2d31 40%, #55585e 62%, #8a8d93 82%, #3a3c40 100%)',
          }}
        />
        {/* Side keys */}
        <div className="absolute -left-[2.5px] top-[150px] h-[26px] w-[3px] rounded-l-md bg-[#3c3e42]" />
        <div className="absolute -left-[2.5px] top-[205px] h-[52px] w-[3px] rounded-l-md bg-[#3c3e42]" />
        <div className="absolute -left-[2.5px] top-[266px] h-[52px] w-[3px] rounded-l-md bg-[#3c3e42]" />
        <div className="absolute -right-[2.5px] top-[228px] h-[84px] w-[3px] rounded-r-md bg-[#3c3e42]" />

        {/* Bezel */}
        <div className="absolute inset-[3px] rounded-[55px] bg-black" />

        {/* Screen */}
        <div
          className="absolute overflow-hidden rounded-[44px] bg-[#0b0c0d] no-scrollbar"
          style={{ left: 13, top: 13, width: SCREEN_W, height: SCREEN_H }}
        >
          {children}
          {/* Glass reflection */}
          <div
            className="pointer-events-none absolute inset-0 z-40"
            style={{
              background:
                'linear-gradient(118deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 24%, transparent 38%)',
            }}
          />
        </div>

        {/* Dynamic Island */}
        <div className="absolute left-1/2 top-[24px] z-50 flex h-[30px] w-[104px] -translate-x-1/2 items-center justify-end rounded-full bg-black pr-[9px]">
          <div className="size-[10px] rounded-full bg-[#101418]">
            <div className="ml-[2.5px] mt-[2.5px] size-[5px] rounded-full bg-[#1d2b3a] opacity-90" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Laptop-ish browser window for the web portals (partner / coach / admin).
 * Light chrome to match the real console's paper-light SaaS look.
 */
export function BrowserFrame({
  url,
  children,
  className = '',
}: {
  url: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl bg-[#dcdcd6] shadow-phone ${className}`}
      aria-hidden
    >
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="mx-auto flex h-7 w-full max-w-[420px] items-center justify-center rounded-lg bg-white/70 px-4 font-mono text-[11px] text-[#5f636a]">
          {url}
        </div>
        <div className="w-10" />
      </div>
      <div className="bg-[#f5f5f2] text-[#1b1c1e]">{children}</div>
    </div>
  );
}
