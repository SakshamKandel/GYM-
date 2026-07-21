'use client';

/**
 * Mock: the app's first-run Welcome screen — GM logomark tile, wordmark,
 * tagline, a red "Start tonight" CTA and the no-account ghost link. No tab
 * bar: this is the door, shown before onboarding begins.
 */
import { useInView, useStepLoop } from '../motion';
import { AppScreen } from './appkit';

export function WelcomeScreen() {
  const [ref, inView] = useInView<HTMLDivElement>('0px');
  const [dotRef, dot] = useStepLoop(3, 1500);

  return (
    <AppScreen>
      <div ref={ref} className="relative flex flex-1 flex-col px-7 pb-9">
        {/* Brand lockup, centered */}
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div
            className="flex size-[80px] items-center justify-center rounded-[24px] bg-red shadow-pop"
            style={{
              transform: inView ? 'scale(1)' : 'scale(0.82)',
              opacity: inView ? 1 : 0,
              transition: 'transform 0.7s cubic-bezier(0.25,1,0.5,1), opacity 0.7s ease',
            }}
          >
            <svg width="48" height="48" viewBox="0 0 64 64" fill="#0B0C0D" aria-hidden>
              <path d="M14 20h17v7H21v10h7v-4h7v11H14V20Zm25 0h7l5 9 5-9h7v24h-8V33l-4 7-4-7v11h-8V20Z" />
            </svg>
          </div>
          <h3 className="mt-7 font-display text-[30px] font-medium uppercase leading-none tracking-[0.03em] text-snow">
            The GM Method
          </h3>
          <p className="mt-3.5 max-w-[214px] text-[13px] leading-relaxed text-dim">
            Train with a plan. Track what matters. Keep going.
          </p>
        </div>

        {/* Onboarding progress dots */}
        <div ref={dotRef} className="mb-6 flex items-center justify-center gap-2">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`h-[7px] rounded-full transition-all duration-500 ${
                i === dot ? 'w-6 bg-red' : 'w-[7px] bg-charcoal-3'
              }`}
            />
          ))}
        </div>

        {/* Primary CTA — the screen's single red block */}
        <div className="flex h-[54px] items-center justify-center rounded-full bg-red">
          <span className="text-[15px] font-semibold text-ink">Start tonight</span>
        </div>
        <p className="mt-4 text-center text-[13px] font-medium text-dim">Continue without account</p>
      </div>
    </AppScreen>
  );
}
