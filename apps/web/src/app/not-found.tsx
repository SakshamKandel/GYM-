'use client';

/**
 * 404 — full-viewport animated error screen (red/black brand take).
 * Giant Y-stretched "404" + oval pillar masked into the red canvas, looping
 * center video, standalone pill nav with a slide-in menu, no scrolling.
 */
import { ArrowLeft, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const NAV_LINKS = [
  { label: 'About us', href: '/about' },
  { label: 'Training', href: '/training' },
  { label: 'Meals', href: '/meals' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Contact', href: '/contact' },
] as const;

function GmMark() {
  return (
    <svg width="34" height="34" viewBox="0 0 64 64" role="img" aria-label="The GM Method logo">
      <rect width="64" height="64" rx="16" fill="#0b0c0d" />
      <path
        d="M14 20h17v7H21v10h7v-4h7v11H14V20Zm25 0h7l5 9 5-9h7v24h-8V33l-4 7-4-7v11h-8V20Z"
        fill="#ff3b30"
      />
    </svg>
  );
}

export default function NotFound() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scaleY, setScaleY] = useState(1);
  const textRef = useRef<HTMLDivElement>(null);

  // Stretch the 404 vertically to bleed past the viewport, remeasure on resize.
  useEffect(() => {
    const measure = () => {
      const el = textRef.current;
      if (!el || el.offsetHeight === 0) return;
      setScaleY(window.innerHeight / el.offsetHeight);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Lock body scroll while the menu is open.
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  return (
    <div
      className="mkt relative flex h-screen w-full flex-col overflow-hidden font-sans"
      style={{ background: 'linear-gradient(to bottom, #FF3B30, #FF7A6E)' }}
    >
      {/* ------- Background "404" + oval, masked to fade out at the bottom */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: 0.8,
          maskImage: 'linear-gradient(to bottom, black 40%, transparent 95%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 40%, transparent 95%)',
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            ref={textRef}
            className="whitespace-nowrap font-display font-semibold leading-none tracking-tighter text-ink"
            style={{
              fontSize: 'clamp(200px, 48vw, 800px)',
              transform: `scale(1.15, ${scaleY * 1.4})`,
            }}
          >
            404
          </div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="h-[22vh] rounded-full bg-ink sm:h-[26vh] md:h-[50vh]"
            style={{
              width: 'clamp(120px, 20vw, 400px)',
              transform: `scaleY(${scaleY * 1.4})`,
              transformOrigin: 'center',
            }}
          />
        </div>
      </div>

      {/* ------- Center video */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        style={{ marginTop: 'calc(-6vh - 40px)' }}
      >
        <div className="h-[85vh] w-[120vw] sm:h-[70vh] sm:w-[70vw] md:h-[78vh] md:w-[62vw]">
          <video
            autoPlay
            loop
            muted
            playsInline
            className="pointer-events-none size-full object-contain mix-blend-darken"
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260713_234424_b1332b69-2e69-4302-8dbc-40f86846afbd.mp4"
          />
        </div>
      </div>

      {/* ------- Nav */}
      <header className="relative z-20 flex items-center justify-between px-4 py-4 sm:px-6 sm:py-5 md:px-12">
        <Link href="/" className="flex items-center gap-2" aria-label="The GM Method — home">
          <GmMark />
          <span className="ml-1 text-lg font-bold text-ink sm:text-xl">The GM Method</span>
        </Link>

        <nav className="hidden gap-1 md:flex" aria-label="Main">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-snow transition-colors hover:opacity-90"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-expanded={menuOpen}
          className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-snow transition-colors hover:opacity-90 sm:px-5 sm:py-2.5"
        >
          <Menu className="size-4" aria-hidden />
          <span className="hidden text-sm font-medium sm:inline">Menu</span>
        </button>
      </header>

      {/* ------- Menu overlay */}
      <div
        className={`fixed inset-0 z-50 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          menuOpen ? 'visible' : 'invisible'
        }`}
        aria-hidden={!menuOpen}
      >
        <div
          className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-500 ${
            menuOpen ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={() => setMenuOpen(false)}
        />
        <div
          className={`absolute right-0 top-0 h-full w-full transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] sm:w-[380px] ${
            menuOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
          style={{ background: 'linear-gradient(135deg, #1D1F22 0%, #0B0C0D 100%)' }}
        >
          <div className="flex items-center justify-between px-6 py-5">
            <span className="flex items-center gap-2">
              <svg width="34" height="34" viewBox="0 0 64 64" aria-hidden>
                <rect width="64" height="64" rx="16" fill="#ff3b30" />
                <path
                  d="M14 20h17v7H21v10h7v-4h7v11H14V20Zm25 0h7l5 9 5-9h7v24h-8V33l-4 7-4-7v11h-8V20Z"
                  fill="#0b0c0d"
                />
              </svg>
              <span className="ml-1 text-lg font-bold text-snow">The GM Method</span>
            </span>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              className="flex size-10 items-center justify-center rounded-full bg-white/10 text-snow transition-colors hover:bg-white/20"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>

          <nav className="flex flex-col gap-2 px-6 pt-4" aria-label="Menu">
            {NAV_LINKS.map((l, i) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                style={{ transitionDelay: menuOpen ? `${150 + i * 60}ms` : '0ms' }}
                className={`rounded-2xl bg-white/10 px-6 py-4 text-lg font-semibold text-snow transition-all duration-300 hover:bg-white/20 ${
                  menuOpen ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="absolute inset-x-0 bottom-0 p-6">
            <Link
              href="/"
              className={`flex w-full items-center justify-center gap-2 rounded-full bg-red py-4 text-base font-semibold text-ink transition-all duration-300 hover:scale-[1.02] ${
                menuOpen ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ transitionDelay: menuOpen ? '450ms' : '0ms' }}
            >
              <ArrowLeft className="size-5" aria-hidden />
              Back to home
            </Link>
          </div>
        </div>
      </div>

      {/* ------- Bottom content */}
      <div className="relative z-30 mt-auto flex flex-col items-center px-4 pb-8 text-center sm:pb-16">
        <h1 className="mb-3 text-lg font-medium text-ink sm:mb-4 sm:text-xl md:text-2xl">
          Oops — that page didn&rsquo;t make the cut.
        </h1>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-semibold text-snow transition-all hover:scale-105 hover:shadow-lg sm:px-8 sm:py-4 sm:text-base"
        >
          <ArrowLeft className="size-4 sm:size-5" aria-hidden />
          Back to home
        </Link>
      </div>
    </div>
  );
}
