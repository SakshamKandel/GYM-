'use client';

/**
 * Mock: Food diary — kcal ring filling, P/C/F macro bars in their fixed app
 * colors, real-feeling Nepali meals, water dots that fill on a loop.
 * Matches mobile app (tabs)/food.tsx.
 */
import { CountUp, useInView, useStepLoop } from '../motion';
import {
  AppEyebrow,
  AppHeader,
  AppScreen,
  AppTabBar,
  AppTitle,
  BlockCard,
  MiniBar,
  MiniRing,
  type TabName,
} from './appkit';

const MEALS = [
  { name: 'Dal bhat + chicken curry', meta: 'Lunch · Nutri-Score B', kcal: 640 },
  { name: 'Greek yogurt + banana', meta: 'Snack · barcode scan', kcal: 210 },
  { name: 'Paneer power bowl', meta: 'Dinner · GM Meals order', kcal: 580 },
] as const;

export function MacroScreen({ onTabChange }: { onTabChange?: (tab: TabName) => void }) {
  const [ref, inView] = useInView<HTMLDivElement>('0px');
  const [waterRef, waterStep] = useStepLoop(9, 900, 6);

  return (
    <AppScreen>
      <AppHeader displayName="Athlete" greeting="Nutrition" streak="18 wks" tier="elite" />

      <div
        ref={ref}
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 pb-20 pt-1 no-scrollbar"
      >
        <div>
          <AppEyebrow>Nutrition Log</AppEyebrow>
          <AppTitle className="mt-0.5 text-[26px]">Food</AppTitle>
        </div>

        {/* kcal ring + macro breakdown */}
        <BlockCard tone="charcoal" className="flex items-center gap-3 p-3.5 bg-charcoal-2 border border-line-strong/30">
          <MiniRing size={98} stroke={9} pct={inView ? 72 : 0} track="#2E3135">
            <div className="text-center">
              <span className="font-display text-[22px] font-medium leading-none text-snow">
                <CountUp to={inView ? 1430 : 0} duration={1300} />
              </span>
              <p className="text-[8.5px] uppercase tracking-[0.14em] text-dim">of 2000 kcal</p>
            </div>
          </MiniRing>
          <div className="flex flex-1 flex-col gap-2">
            {(
              [
                ['Protein', '96 / 140 g', 68, 'bg-blue'],
                ['Carbs', '148 / 220 g', 67, 'bg-orange'],
                ['Fat', '38 / 65 g', 58, 'bg-gold'],
              ] as const
            ).map(([label, meta, pct, color]) => (
              <div key={label}>
                <div className="flex justify-between text-[10px]">
                  <span className="font-semibold text-snow">{label}</span>
                  <span className="text-dim">{meta}</span>
                </div>
                <MiniBar pct={inView ? pct : 0} color={color} className="mt-0.5 h-[6px]" />
              </div>
            ))}
          </div>
        </BlockCard>

        {/* Barcode scanner CTA row */}
        <div className="flex items-center justify-between rounded-[16px] bg-red/15 border border-red/30 px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-red text-ink">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2 4h2v16H2V4zm4 0h1v16H6V4zm3 0h2v16H9V4zm4 0h1v16h-1V4zm3 0h2v16h-2V4zm4 0h1v16h-1V4z" />
              </svg>
            </span>
            <span className="text-[11.5px] font-semibold text-snow">Quick Barcode Scanner</span>
          </div>
          <span className="rounded-full bg-red px-2.5 py-0.5 text-[10px] font-bold text-ink uppercase">
            Scan
          </span>
        </div>

        {/* Logged Meal Rows */}
        <div className="flex flex-col gap-1.5">
          <AppEyebrow className="px-1">Today's Diary</AppEyebrow>
          {MEALS.map((m) => (
            <div
              key={m.name}
              className="flex min-h-[48px] items-center gap-3 rounded-[16px] bg-charcoal px-3.5 py-2"
            >
              <span className="flex-1">
                <span className="block text-[12px] font-semibold leading-tight text-snow">{m.name}</span>
                <span className="block text-[10.5px] text-dim">{m.meta}</span>
              </span>
              <span className="font-display text-[15px] font-medium text-snow">{m.kcal} <span className="text-[10px] text-dim font-sans">kcal</span></span>
            </div>
          ))}
        </div>

        {/* Water tracker counterpoint card */}
        <BlockCard tone="cream" className="py-3 px-3.5">
          <div ref={waterRef} className="flex items-center justify-between">
            <div>
              <AppEyebrow onBlock>Water Intake</AppEyebrow>
              <span className="font-display text-[20px] font-medium text-ink">
                {Math.min(waterStep, 8) * 250} ml
              </span>
            </div>
            <div className="flex gap-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <span
                  key={i}
                  className={`h-5 w-2.5 rounded-full transition-colors duration-300 ${
                    i < waterStep ? 'bg-water' : 'bg-black/10'
                  }`}
                />
              ))}
            </div>
          </div>
        </BlockCard>
      </div>

      <AppTabBar active="food" onTabChange={onTabChange} />
    </AppScreen>
  );
}
