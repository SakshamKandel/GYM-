'use client';

/**
 * Mock: Gym-mode set logger — Back Squat, four set rows with last-session
 * ghosts that tick logged one by one, then the red "NEW PR" toast pops.
 * Matches mobile app (tabs)/train.tsx & gym mode logger.
 */
import { useStepLoop } from '../motion';
import {
  AppEyebrow,
  AppHeader,
  AppScreen,
  AppTabBar,
  AppTitle,
  BlockCard,
  MetaChip,
  type TabName,
} from './appkit';

const SETS = [
  { no: 1, weight: '60', reps: '8', prev: '60 × 8' },
  { no: 2, weight: '70', reps: '6', prev: '70 × 6' },
  { no: 3, weight: '77.5', reps: '5', prev: '75 × 5' },
  { no: 4, weight: '80', reps: '5', prev: '77.5 × 5' },
] as const;

export function WorkoutLoggerScreen({ onTabChange }: { onTabChange?: (tab: TabName) => void }) {
  // 0 → all pending · 1–4 → sets tick logged · 5–7 → PR toast holds · loop.
  const [ref, step] = useStepLoop(8, 1000, 6);
  const logged = Math.min(step, SETS.length);
  const showToast = step >= 5;

  return (
    <AppScreen>
      <AppHeader displayName="Athlete" greeting="Training" streak="18 wks" tier="elite" />

      <div
        ref={ref}
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 pb-20 pt-1 no-scrollbar"
      >
        <div>
          <AppEyebrow>Gym Mode · Leg Day</AppEyebrow>
          <AppTitle className="mt-0.5 text-[26px]">Back Squat</AppTitle>
          <div className="mt-1.5 flex gap-1.5">
            <MetaChip>Exercise 2 of 5</MetaChip>
            <MetaChip>Rest auto · 90s</MetaChip>
          </div>
        </div>

        {/* Set rows — logged state ticks in one by one */}
        <div className="mt-1 flex flex-col gap-1.5">
          {SETS.map((s, i) => {
            const done = i < logged;
            const active = i === logged;
            return (
              <div
                key={s.no}
                className={`flex min-h-[52px] items-center gap-3 rounded-[16px] px-3.5 py-1.5 transition-colors duration-300 ${
                  done ? 'bg-charcoal-2 border border-line-strong/30' : 'bg-charcoal'
                }`}
              >
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full font-display text-[13px] font-medium transition-colors duration-300 ${
                    done ? 'bg-snow text-ink font-bold' : 'bg-charcoal-3 text-dim'
                  }`}
                >
                  {s.no}
                </span>
                <span className="flex-1">
                  <span className="block font-display text-[19px] font-medium leading-none">
                    {s.weight} <span className="text-[12px] text-dim font-sans">kg</span>{' '}
                    <span className="text-dim">×</span> {s.reps}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-faint">
                    last time {s.prev} kg
                  </span>
                </span>
                <span
                  className={`flex size-6 items-center justify-center rounded-full text-[11px] font-bold transition-all duration-300 ${
                    done
                      ? 'scale-100 bg-red text-ink'
                      : active
                        ? 'scale-95 bg-charcoal-3 text-dim'
                        : 'scale-90 bg-charcoal-3 text-faint'
                  }`}
                >
                  ✓
                </span>
              </div>
            );
          })}
        </div>

        {/* Plate Calculator teaser & Session volume */}
        <BlockCard tone="cream" className="flex items-center justify-between py-2.5 px-3.5">
          <div>
            <AppEyebrow onBlock>Session Volume</AppEyebrow>
            <span className="font-display text-[22px] font-medium text-ink">1,688 kg</span>
          </div>
          <span className="rounded-full bg-ink px-3 py-1 text-[11px] font-semibold text-snow">
            Plate calc
          </span>
        </BlockCard>
      </div>

      {/* NEW PR toast — Signal Red pop */}
      <div
        aria-hidden={!showToast}
        className={`absolute inset-x-4 bottom-[72px] z-20 transition-all duration-300 ease-out ${
          showToast ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-90 opacity-0'
        }`}
      >
        <div className="flex items-center gap-3 rounded-[20px] bg-red p-3.5 shadow-pop">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#F5F6F7" aria-hidden>
              <path d="M6 2h12v2h3v3a5 5 0 0 1-4.6 4.98A6 6 0 0 1 13 15.9V18h3v2H8v-2h3v-2.1a6 6 0 0 1-3.4-3.92A5 5 0 0 1 3 7V4h3V2Zm-1 5a3 3 0 0 0 2 2.83V4H5v3Zm14 0V4h-2v5.83A3 3 0 0 0 19 7Z" />
            </svg>
          </span>
          <div>
            <span className="block font-display text-[17px] font-medium uppercase leading-none text-ink">
              New PR Recorded
            </span>
            <span className="mt-0.5 block text-[11.5px] font-semibold text-ink/80">
              Back Squat — 80 kg × 5 reps
            </span>
          </div>
        </div>
      </div>

      <AppTabBar active="train" onTabChange={onTabChange} />
    </AppScreen>
  );
}
