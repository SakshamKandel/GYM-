'use client';

/**
 * Mock: GM Meals live order tracking — the real 7-state order machine
 * advancing on a loop, partner kitchen card, COD chip.
 */
import { useStepLoop } from '../motion';
import { AppEyebrow, AppScreen, AppTabBar, AppTitle, BlockCard, MetaChip } from './appkit';

const STATES = [
  ['Placed', '12:02'],
  ['Confirmed', '12:04'],
  ['Preparing', '12:11'],
  ['Ready', '12:26'],
  ['Picked up', '12:31'],
  ['Out for delivery', '12:33'],
  ['Delivered', '—'],
] as const;

export function OrderTrackerScreen() {
  const [ref, step] = useStepLoop(9, 1100, 5);
  const current = Math.min(step, STATES.length - 1);

  return (
    <AppScreen>
      <div ref={ref} className="flex flex-1 flex-col gap-3 px-5 pt-1">
        <div>
          <AppEyebrow>Order #GM-2481</AppEyebrow>
          <AppTitle className="mt-1">On the way</AppTitle>
          <div className="mt-2.5 flex gap-2">
            <MetaChip>ETA 18 min</MetaChip>
            <MetaChip>Cash on delivery</MetaChip>
          </div>
        </div>

        {/* Partner kitchen — red hero */}
        <BlockCard tone="red" className="flex items-center gap-3.5 py-3.5">
          <span className="flex size-11 items-center justify-center rounded-[14px] bg-ink font-display text-[16px] font-medium text-snow">
            HB
          </span>
          <span className="flex-1">
            <span className="block text-[14px] font-bold text-ink">Himalaya Bowl Kitchen</span>
            <span className="block text-[11.5px] font-medium text-ink/60">
              Jhamsikhel · partner kitchen
            </span>
          </span>
          <span className="rounded-full bg-ink px-3 py-1.5 text-[11px] font-semibold text-snow">
            Call
          </span>
        </BlockCard>

        {/* 7-state tracker */}
        <BlockCard tone="charcoal" className="py-4">
          <div className="flex flex-col">
            {STATES.map(([label, time], i) => {
              const done = i < current;
              const active = i === current;
              return (
                <div key={label} className="flex min-h-[38px] gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={`mt-0.5 flex size-[18px] items-center justify-center rounded-full text-[9px] font-bold transition-all duration-300 ${
                        done
                          ? 'bg-red text-ink'
                          : active
                            ? 'scale-110 bg-red text-ink'
                            : 'bg-charcoal-3 text-faint'
                      }`}
                    >
                      {done ? '✓' : ''}
                    </span>
                    {i < STATES.length - 1 ? (
                      <span
                        className={`w-[2.5px] flex-1 rounded-full transition-colors duration-300 ${
                          done ? 'bg-red' : 'bg-charcoal-3'
                        }`}
                      />
                    ) : null}
                  </div>
                  <div className="flex flex-1 items-baseline justify-between pb-2">
                    <span
                      className={`text-[13px] leading-[18px] transition-colors duration-300 ${
                        active ? 'font-bold text-snow' : done ? 'font-medium text-snow/85' : 'text-faint'
                      }`}
                    >
                      {label}
                    </span>
                    <span className="font-display text-[11.5px] text-dim">
                      {i <= current ? time : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </BlockCard>

        {/* Items */}
        <div className="flex min-h-[52px] items-center gap-3 rounded-[16px] bg-charcoal px-4 py-2.5">
          <span className="flex-1">
            <span className="block text-[13px] font-semibold">Paneer power bowl × 2</span>
            <span className="block text-[11px] text-dim">High-protein · 580 kcal each</span>
          </span>
          <span className="font-display text-[15px] font-medium">Rs 980</span>
        </div>
      </div>
      <AppTabBar active="meals" />
    </AppScreen>
  );
}
