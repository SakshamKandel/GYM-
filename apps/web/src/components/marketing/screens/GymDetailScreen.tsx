'use client';

/**
 * Mock: a gym detail page — photo hero, name + area, open status, hours rows,
 * amenity chips (looping emphasis) and the red "Get directions" pill.
 */
import { useInView, useStepLoop } from '../motion';
import { AppEyebrow, AppScreen, AppTabBar, AppTitle, BlockCard } from './appkit';

const HOURS = [
  ['Sun – Fri', '5:00 – 21:00'],
  ['Saturday', '7:00 – 19:00'],
] as const;

const AMENITIES = ['Free weights', 'Cardio', 'Shower'] as const;

export function GymDetailScreen() {
  const [ref, inView] = useInView<HTMLDivElement>('0px');
  const [loopRef, step] = useStepLoop(AMENITIES.length, 1500);

  return (
    <AppScreen>
      <div ref={ref} className="flex flex-1 flex-col gap-3 px-5 pt-1">
        {/* Photo hero */}
        <div className="relative h-[142px] overflow-hidden rounded-[20px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/stock/gym-interior-bright.jpg"
            alt=""
            className={`size-full object-cover transition-transform duration-[1400ms] ease-out ${
              inView ? 'scale-100' : 'scale-110'
            }`}
          />
          <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/60 to-transparent" />
          <span className="absolute bottom-2.5 left-3 rounded-full bg-ink/80 px-2.5 py-1 text-[10px] font-semibold text-snow">
            12 photos
          </span>
        </div>

        {/* Name + status */}
        <div
          className={`transition-all duration-500 ${inView ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}
          style={{ transitionDelay: '120ms' }}
        >
          <AppEyebrow>Kamaladi · Kathmandu · 350 m</AppEyebrow>
          <AppTitle className="mt-1">Wave Health Club</AppTitle>
          <span className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-mint">
            <span className="size-1.5 rounded-full bg-mint" />
            Open now · closes 21:00
          </span>
        </div>

        {/* Hours */}
        <BlockCard
          tone="charcoal"
          className={`py-3.5 transition-all delay-200 duration-500 ${inView ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}
        >
          <AppEyebrow>Hours</AppEyebrow>
          <div className="mt-2 flex flex-col gap-1.5">
            {HOURS.map(([days, time]) => (
              <div key={days} className="flex items-baseline justify-between">
                <span className="text-[12.5px] text-dim">{days}</span>
                <span className="font-display text-[13.5px] font-medium text-snow">{time}</span>
              </div>
            ))}
          </div>
        </BlockCard>

        {/* Amenities — looping chip emphasis */}
        <div ref={loopRef} className="flex gap-2">
          {AMENITIES.map((label, i) => (
            <span
              key={label}
              className={`inline-flex h-[26px] items-center rounded-full border px-3 text-[10.5px] font-medium transition-colors duration-300 ${
                step === i ? 'border-red text-snow' : 'border-line-strong text-dim'
              }`}
            >
              {label}
            </span>
          ))}
        </div>

        {/* Contact */}
        <div className="flex min-h-[48px] items-center gap-3 rounded-[16px] bg-charcoal px-4 py-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-charcoal-2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="#9BA0A8">
              <path d="M6.6 10.8a15.6 15.6 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24c1.2.4 2.5.6 3.8.6a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C11 21 3 13 3 3.8a1 1 0 0 1 1-1h3.4a1 1 0 0 1 1 1c0 1.3.2 2.6.6 3.8a1 1 0 0 1-.24 1L6.6 10.8Z" />
            </svg>
          </span>
          <span className="flex-1">
            <span className="block text-[13px] font-semibold">01-4520 118</span>
            <span className="block text-[11px] text-dim">Tap to call</span>
          </span>
        </div>

        {/* Red directions pill — the screen's single red block */}
        <span className="flex h-[44px] items-center justify-center gap-2 rounded-full bg-red text-[13px] font-semibold text-ink">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21.7 11.3 12.7 2.3a1 1 0 0 0-1.4 0l-9 9a1 1 0 0 0 0 1.4l9 9a1 1 0 0 0 1.4 0l9-9a1 1 0 0 0 0-1.4ZM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5-3.5 3.5Z" />
          </svg>
          Get directions
        </span>
      </div>
      <AppTabBar active="gyms" />
    </AppScreen>
  );
}
