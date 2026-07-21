'use client';

/**
 * Mock: food search — "dal bhat" types itself into the field, results from
 * Open Food Facts + USDA drop in with Nutri-Score letter chips, one row
 * highlights with a red add button, custom-food row at the bottom.
 * Unique to /nutrition.
 */
import { useStepLoop } from '../motion';
import { AppEyebrow, AppScreen, AppTabBar, AppTitle, MetaChip } from './appkit';

const QUERY = 'dal bhat';

const RESULTS = [
  { name: 'Dal bhat thali (veg)', serving: '1 plate', kcal: 610, score: 'A', chip: 'bg-mint' },
  { name: 'Dal bhat + chicken curry', serving: '1 plate', kcal: 640, score: 'B', chip: 'bg-gold' },
  { name: 'Masoor dal, cooked', serving: '1 bowl · 180 g', kcal: 230, score: 'A', chip: 'bg-mint' },
  { name: 'Instant noodles, dal flavour', serving: '1 pack', kcal: 310, score: 'C', chip: 'bg-orange' },
] as const;

export function FoodSearchScreen() {
  const [ref, step] = useStepLoop(14, 300, 12);
  const typed = QUERY.slice(0, Math.min(step, QUERY.length));
  const resultsIn = step >= 9;
  const highlighted = step >= 10;

  return (
    <AppScreen>
      <div ref={ref} className="flex flex-1 flex-col gap-3 px-5 pb-[86px] pt-1">
        <div>
          <AppEyebrow>Food · Lunch</AppEyebrow>
          <AppTitle className="mt-1">Search</AppTitle>
          <div className="mt-2.5 flex gap-2">
            <MetaChip>Open Food Facts</MetaChip>
            <MetaChip>USDA</MetaChip>
          </div>
        </div>

        {/* Search field */}
        <div className="flex h-11 items-center gap-2.5 rounded-full bg-charcoal-2 px-4">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9BA0A8" strokeWidth="2.4" aria-hidden>
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m15.5 15.5 5 5" strokeLinecap="round" />
          </svg>
          <span className="flex items-center text-[13px] font-medium">
            {typed}
            <span className="ml-[2px] h-4 w-[2px] animate-pulse rounded-full bg-snow/80" />
          </span>
        </div>
        <p className="-mt-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">
          {resultsIn ? '4 of 128 results · 2 databases' : 'Searching 2 databases…'}
        </p>

        {/* Result rows */}
        <div className="flex flex-col gap-2">
          {RESULTS.map((r, i) => {
            const hot = highlighted && i === 1;
            return (
              <div
                key={r.name}
                style={{ transitionDelay: resultsIn ? `${i * 70}ms` : '0ms' }}
                className={`flex min-h-[54px] items-center gap-3 rounded-[16px] px-4 py-2.5 transition-all duration-500 ${
                  resultsIn ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
                } ${hot ? 'bg-charcoal-2' : 'bg-charcoal'}`}
              >
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-[10px] font-display text-[15px] font-medium text-ink ${r.chip}`}
                >
                  {r.score}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold leading-tight">
                    {r.name}
                  </span>
                  <span className="block text-[10.5px] text-dim">{r.serving}</span>
                </span>
                <span className="font-display text-[15px] font-medium">{r.kcal}</span>
                {/* the screen's single red moment — add button on the hot row */}
                <span
                  className={`flex items-center justify-center rounded-full bg-red font-bold text-ink transition-all duration-300 ${
                    hot ? 'size-7 text-[15px] opacity-100' : 'size-0 text-[0px] opacity-0'
                  }`}
                >
                  +
                </span>
              </div>
            );
          })}
        </div>

        {/* Custom food row */}
        <div
          className={`flex min-h-[52px] items-center gap-3 rounded-[16px] bg-charcoal px-4 py-2.5 transition-all delay-300 duration-500 ${
            resultsIn ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
          }`}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-charcoal-3 text-[15px] font-bold text-dim">
            +
          </span>
          <span className="flex-1">
            <span className="block text-[12.5px] font-semibold leading-tight">
              Create custom food
            </span>
            <span className="block text-[10.5px] text-dim">Your recipe, your macros</span>
          </span>
        </div>
      </div>
      <AppTabBar active="food" />
    </AppScreen>
  );
}
