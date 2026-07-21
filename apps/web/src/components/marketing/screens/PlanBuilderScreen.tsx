'use client';

/**
 * Mock: the plan builder — Mon–Sun week strip, Push · Pull · Legs split chips
 * and a day card with reorderable exercise rows. The active day cycles on a
 * loop, swapping the day card's contents.
 */
import { useStepLoop } from '../motion';
import { AppEyebrow, AppScreen, AppTabBar, AppTitle, BlockCard, MetaChip } from './appkit';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

const SPLITS = [
  {
    day: 'Monday',
    dayIdx: 0,
    name: 'Push',
    mins: '52 min',
    exercises: [
      { name: 'Incline Bench Press', sets: '4 × 8 · 60 kg' },
      { name: 'Seated Overhead Press', sets: '3 × 10 · 40 kg' },
      { name: 'Triceps Pushdown', sets: '3 × 12 · 25 kg' },
    ],
  },
  {
    day: 'Wednesday',
    dayIdx: 2,
    name: 'Pull',
    mins: '48 min',
    exercises: [
      { name: 'Weighted Pull-up', sets: '4 × 6 · +10 kg' },
      { name: 'Barbell Row', sets: '4 × 8 · 65 kg' },
      { name: 'Face Pull', sets: '3 × 15 · 18 kg' },
    ],
  },
  {
    day: 'Friday',
    dayIdx: 4,
    name: 'Legs',
    mins: '56 min',
    exercises: [
      { name: 'Back Squat', sets: '4 × 5 · 80 kg' },
      { name: 'Romanian Deadlift', sets: '3 × 8 · 70 kg' },
      { name: 'Walking Lunge', sets: '3 × 12 · 16 kg' },
    ],
  },
] as const;

const FILLED = new Set<number>(SPLITS.map((s) => s.dayIdx));

export function PlanBuilderScreen() {
  const [ref, step] = useStepLoop(SPLITS.length, 2200);
  const split = SPLITS[step] ?? SPLITS[0];

  return (
    <AppScreen>
      <div ref={ref} className="flex flex-1 flex-col gap-2.5 px-5 pt-1">
        <div>
          <AppEyebrow>My plans · Week 3 of 6</AppEyebrow>
          <AppTitle className="mt-1 text-[30px]">Plan builder</AppTitle>
          <div className="mt-2 flex gap-2">
            {SPLITS.map((s) => {
              const active = s.name === split.name;
              return (
                <span
                  key={s.name}
                  className={`inline-flex h-[26px] items-center rounded-full px-3 text-[10.5px] transition-colors duration-300 ${
                    active
                      ? 'bg-snow font-semibold text-ink'
                      : 'border border-line-strong font-medium text-snow'
                  }`}
                >
                  {s.name}
                </span>
              );
            })}
            <MetaChip>3 d / wk</MetaChip>
          </div>
        </div>

        {/* Week strip — active day is the screen's red accent */}
        <div className="mt-1 flex justify-between">
          {DAYS.map((d, i) => {
            const filled = FILLED.has(i);
            const active = i === split.dayIdx;
            return (
              <span
                key={`${d}-${i}`}
                className={`flex size-9 items-center justify-center rounded-full font-display text-[13px] font-medium transition-colors duration-300 ${
                  active
                    ? 'bg-red text-ink'
                    : filled
                      ? 'bg-charcoal-2 text-snow'
                      : 'bg-charcoal text-faint'
                }`}
              >
                {d}
              </span>
            );
          })}
        </div>

        {/* Day card */}
        <BlockCard tone="charcoal" className="mt-0.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-semibold">
              {split.day} — {split.name}
            </span>
            <span className="font-display text-[11.5px] uppercase tracking-[0.12em] text-dim">
              {split.mins}
            </span>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {split.exercises.map((ex) => (
              <div
                key={ex.name}
                className="flex min-h-[48px] items-center gap-3 rounded-[14px] bg-charcoal-2 px-3.5 py-2"
              >
                {/* reorder handle */}
                <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden>
                  <rect width="14" height="2" rx="1" fill="#63676E" />
                  <rect y="4" width="14" height="2" rx="1" fill="#63676E" />
                  <rect y="8" width="14" height="2" rx="1" fill="#63676E" />
                </svg>
                <span className="flex-1">
                  <span className="block text-[13px] font-semibold leading-tight">{ex.name}</span>
                  <span className="block text-[11px] text-dim">{ex.sets}</span>
                </span>
                <span className="font-display text-[12px] text-faint">⋯</span>
              </div>
            ))}
            <div className="flex h-10 items-center justify-center rounded-[14px] border border-dashed border-line-strong text-[12px] font-medium text-dim">
              + Add exercise · 650+ library
            </div>
          </div>
        </BlockCard>

        {/* Coach-built counterpoint */}
        <BlockCard tone="cream" className="flex items-center justify-between py-3">
          <div>
            <AppEyebrow onBlock>Coach-built</AppEyebrow>
            <span className="font-display text-[17px] font-medium uppercase text-ink">
              GM Push · Pull · Legs
            </span>
          </div>
          <span className="rounded-full bg-ink px-3.5 py-1.5 text-[11px] font-semibold text-snow">
            Use plan
          </span>
        </BlockCard>
      </div>
      <AppTabBar active="train" />
    </AppScreen>
  );
}
