'use client';

/**
 * Mock: GM Meals weekly subscription — prepaid cycle status (red hero),
 * Mon–Fri day chips with two skipped days, next-delivery card, pause/skip
 * pills. Matches mobile app (tabs)/meals.tsx.
 */
import { useStepLoop } from '../motion';
import {
  AppEyebrow,
  AppHeader,
  AppScreen,
  AppStat,
  AppTabBar,
  AppTitle,
  BlockCard,
  MetaChip,
  MiniBar,
  type TabName,
} from './appkit';

const DAYS = [
  { d: 'Mon', date: '14', state: 'done' },
  { d: 'Tue', date: '15', state: 'done' },
  { d: 'Wed', date: '16', state: 'skip' },
  { d: 'Thu', date: '17', state: 'next' },
  { d: 'Fri', date: '18', state: 'skip' },
] as const;

export function MealSubscriptionScreen({ onTabChange }: { onTabChange?: (tab: TabName) => void }) {
  // Mon ticks at 1, Tue at 2, Thursday pulses at 3.
  const [ref, step] = useStepLoop(5, 1400, 3);

  return (
    <AppScreen>
      <AppHeader displayName="Athlete" greeting="Healthy Delivery" streak="18 wks" tier="elite" />

      <div
        ref={ref}
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 pb-20 pt-1 no-scrollbar"
      >
        <div>
          <AppEyebrow>GM Meals · Weekly Plan</AppEyebrow>
          <AppTitle className="mt-0.5 text-[26px]">Meals</AppTitle>
          <div className="mt-1.5 flex gap-1.5">
            <MetaChip>Himalaya Kitchen</MetaChip>
            <MetaChip>Kathmandu Valley</MetaChip>
          </div>
        </div>

        {/* Cycle status — Signal Red Hero */}
        <BlockCard tone="red" className="p-3.5">
          <AppEyebrow onBlock>Prepaid · eSewa / Khalti</AppEyebrow>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <AppStat size={34} onBlock>
              Cycle 2
            </AppStat>
            <span className="font-display text-[17px] font-medium text-ink/60">of 4 weeks</span>
          </div>
          <MiniBar pct={50} onBlock className="mt-2.5" />
          <p className="mt-2 text-[10.5px] font-semibold text-ink/70">
            Renews Mon, Aug 4 · Kathmandu delivery active
          </p>
        </BlockCard>

        {/* Mon–Fri day chips */}
        <BlockCard tone="charcoal" className="py-3 px-3 bg-charcoal-2 border border-line-strong/30">
          <AppEyebrow>Deliveries this week</AppEyebrow>
          <div className="mt-2 flex gap-1.5">
            {DAYS.map((day, i) => {
              const ticked = day.state === 'done' && step > i;
              const pulsing = day.state === 'next' && step >= 3;
              return (
                <div
                  key={day.d}
                  className={`flex h-[54px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[14px] transition-transform duration-300 ${
                    day.state === 'skip'
                      ? 'bg-charcoal opacity-40'
                      : day.state === 'next'
                        ? `bg-cream text-ink ${pulsing ? 'scale-105 shadow-md' : ''}`
                        : 'bg-charcoal'
                  }`}
                >
                  <span
                    className={`font-mono text-[9px] uppercase tracking-[0.1em] ${
                      day.state === 'next' ? 'text-ink/60' : 'text-dim'
                    }`}
                  >
                    {day.d}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <span
                      className={`font-display text-[15px] font-medium ${
                        day.state === 'skip' ? 'line-through' : ''
                      }`}
                    >
                      {day.state === 'skip' ? '—' : day.date}
                    </span>
                    <span
                      className={`text-[9px] font-bold text-red transition-all duration-300 ${
                        ticked ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
                      }`}
                    >
                      ✓
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </BlockCard>

        {/* Next delivery card */}
        <BlockCard tone="raised" className="flex items-center justify-between py-3 px-3.5 bg-charcoal">
          <div>
            <AppEyebrow>Next Delivery</AppEyebrow>
            <span className="mt-0.5 block font-display text-[18px] font-medium text-snow">
              Thu · 11:30 – 12:15
            </span>
            <span className="block text-[10.5px] text-dim">Chicken Quinoa Bowl · 560 kcal</span>
          </div>
          <MetaChip>On target</MetaChip>
        </BlockCard>
      </div>

      <AppTabBar active="meals" onTabChange={onTabChange} />
    </AppScreen>
  );
}
