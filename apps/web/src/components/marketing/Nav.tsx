'use client';

/**
 * Marketing top nav v3 — floating pill that flips theme with the page:
 * transparent + snow text over the dark hero, then a white/blur pill with
 * ink text + hairline shadow once scrolled into the light content.
 * Desktop: Features dropdown (spring popover). Mobile: dark full-screen
 * overlay with staggered oversized links.
 */
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { LogoMark, Wordmark } from './ui';

const FEATURES = [
  { label: 'Training', href: '/training', blurb: 'Logger, gym mode, 3D anatomy' },
  { label: 'Food', href: '/nutrition', blurb: 'Macros, barcode scan, water' },
  { label: 'Progress', href: '/progress', blurb: 'Weight trend, PRs, streaks' },
  { label: 'Meals', href: '/meals', blurb: 'Healthy delivery in Kathmandu' },
  { label: 'Gyms', href: '/gyms', blurb: 'Find a gym near you' },
] as const;

const LINKS = [
  { label: 'Coaching', href: '/coaching' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Partners', href: '/partners' },
  { label: 'About', href: '/about' },
] as const;

export function Nav() {
  const pathname = usePathname();
  const [light, setLight] = useState(false);
  const [open, setOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const featuresRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();

  // Flip to the light pill once the dark hero is (mostly) behind us.
  useMotionValueEvent(scrollY, 'change', (y) => {
    const threshold = Math.max(320, window.innerHeight * 0.72);
    setLight(y > threshold);
  });

  // Close menus on route change.
  useEffect(() => {
    setOpen(false);
    setFeaturesOpen(false);
  }, [pathname]);

  // Escape + outside-click close for the dropdown.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFeaturesOpen(false);
        setOpen(false);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (featuresRef.current && !featuresRef.current.contains(e.target as Node)) {
        setFeaturesOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, []);

  // Lock body scroll while mobile menu is open.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const onFeaturePage = FEATURES.some((f) => pathname?.startsWith(f.href));
  // Mobile overlay is a dark surface even when the pill has flipped light.
  const darkText = !light || open;
  const linkColor = (active: boolean) =>
    darkText
      ? active
        ? 'text-snow'
        : 'text-dim hover:text-snow'
      : active
        ? 'text-ink'
        : 'text-gravel hover:text-ink';

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
      <div
        className={`mx-auto flex h-[58px] sm:h-[62px] w-full max-w-[1240px] items-center justify-between rounded-full pl-3.5 pr-2.5 sm:pl-5 transition-all duration-300 ${
          open
            ? 'border border-transparent bg-ink/90 backdrop-blur-xl'
            : light
              ? 'border border-mist bg-white/90 shadow-nav backdrop-blur-xl'
              : 'border border-line-strong/30 bg-ink/80 backdrop-blur-xl shadow-pop'
        }`}
      >
        <Link href="/" aria-label="Home" className="flex items-center gap-3 shrink-0">
          <LogoMark size={40} className="sm:hidden" />
          <LogoMark size={48} className="hidden sm:block" />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          <div className="relative" ref={featuresRef}>
            <button
              type="button"
              aria-expanded={featuresOpen}
              onClick={() => setFeaturesOpen((v) => !v)}
              className={`flex h-10 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition-colors ${linkColor(onFeaturePage)}`}
            >
              Features
              <svg
                width="9"
                height="6"
                viewBox="0 0 10 6"
                fill="none"
                className={`transition-transform duration-200 ${featuresOpen ? 'rotate-180' : ''}`}
              >
                <path d="m1 1 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
            <AnimatePresence>
              {featuresOpen ? (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                  className={`absolute left-0 top-[52px] w-[320px] origin-top-left rounded-[20px] p-2 ${
                    light
                      ? 'border border-mist bg-white/95 shadow-card-hover backdrop-blur-xl'
                      : 'mkt-glass-deep bg-ink/85 shadow-pop'
                  }`}
                >
                  {FEATURES.map((f) => (
                    <Link
                      key={f.href}
                      href={f.href}
                      className={`block rounded-[14px] px-4 py-3 transition-colors ${
                        light ? 'hover:bg-paper-2' : 'hover:bg-white/10'
                      }`}
                    >
                      <span
                        className={`block text-[14px] font-semibold ${light ? 'text-ink' : 'text-snow'}`}
                      >
                        {f.label}
                      </span>
                      <span className={`block text-[12.5px] ${light ? 'text-gravel' : 'text-dim'}`}>
                        {f.blurb}
                      </span>
                    </Link>
                  ))}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`flex h-10 items-center rounded-full px-4 text-[14px] font-medium transition-colors ${linkColor(Boolean(pathname?.startsWith(l.href)))}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/download"
            className="mkt-shine hidden h-11 items-center rounded-full bg-red px-6 text-[14px] font-semibold text-ink shadow-ember transition-all hover:bg-red-glow hover:shadow-ember-lg sm:inline-flex"
          >
            Get the app
          </Link>
          {/* Mobile burger */}
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
            className="flex size-10 items-center justify-center rounded-full lg:hidden active:scale-95 transition-transform"
          >
            <span className="relative block h-3.5 w-5">
              <span
                className={`absolute left-0 top-0 h-[2px] w-full rounded transition-all duration-300 ${
                  darkText ? 'bg-snow' : 'bg-ink'
                } ${open ? 'top-1/2 -translate-y-1/2 rotate-45' : ''}`}
              />
              <span
                className={`absolute bottom-0 left-0 h-[2px] w-full rounded transition-all duration-300 ${
                  darkText ? 'bg-snow' : 'bg-ink'
                } ${open ? 'bottom-1/2 translate-y-1/2 -rotate-45' : ''}`}
              />
            </span>
          </button>
        </div>
      </div>

      {/* Mobile overlay */}
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="mkt-noise fixed inset-x-0 bottom-0 top-[76px] overflow-y-auto bg-ink/95 px-6 pb-10 pt-6 backdrop-blur-xl lg:hidden"
          >
            <nav aria-label="Mobile" className="flex flex-col gap-1">
              {[...FEATURES, ...LINKS].map((l, i) => (
                <motion.div
                  key={l.href}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 + i * 0.035, type: 'spring', stiffness: 160, damping: 20 }}
                >
                  <Link
                    href={l.href}
                    className="block border-b border-charcoal py-4 font-display text-3xl font-medium uppercase text-snow"
                  >
                    {l.label}
                  </Link>
                </motion.div>
              ))}
            </nav>
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.42, type: 'spring', stiffness: 160, damping: 20 }}
              className="mt-8 flex flex-col gap-3"
            >
              <Link
                href="/download"
                className="flex h-14 items-center justify-center rounded-full bg-red text-[15px] font-semibold text-ink"
              >
                Get the app
              </Link>
              <div className="flex justify-center gap-6 pt-4 font-mono text-[12px] uppercase tracking-[0.16em] text-dim">
                <Link href="/coach/login">Coach portal</Link>
                <Link href="/partner/login">Partner portal</Link>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
