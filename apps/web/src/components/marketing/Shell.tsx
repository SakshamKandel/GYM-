/**
 * Marketing shell — wraps every customer-facing page. The `.mkt` class scopes
 * the Tailwind reset + marketing styles (see src/app/marketing.css); consoles
 * never render inside it. MotionConfig makes every marketing animation honor
 * the visitor's reduced-motion setting.
 */
import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { Footer } from './Footer';
import { Nav } from './Nav';

export function Shell({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="mkt min-h-screen bg-ink font-sans text-snow">
        <a
          href="#main-content"
          className="absolute left-4 top-4 z-[100] -translate-y-24 rounded-full bg-red px-5 py-2.5 text-[14px] font-semibold text-ink transition-transform focus:translate-y-0"
        >
          Skip to content
        </a>
        <Nav />
        <main id="main-content">{children}</main>
        <Footer />
      </div>
    </MotionConfig>
  );
}
