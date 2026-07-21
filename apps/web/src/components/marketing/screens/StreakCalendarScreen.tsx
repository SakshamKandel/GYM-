'use client';

/**
 * Mock: the app's Progress streak view — red hero block with the live streak
 * counting up, a July heat-grid that fills day by day on a loop (the newest
 * workout day glows red before settling cream), and a cream week summary.
 */
import { CountUp, useInView, useStepLoop } from '../motion';
import {
  AppEyebrow,
  AppScreen,
  AppStat,
  AppTabBar,
  AppTitle,
  BlockCard,
  MetaChip,
} from './appkit';

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

// 'w' workout · '.' rest · 'f' future. Days 11–28 are the 18-day streak.
const CELLS = ('w.ww..w.ww' + 'w'.repeat(18) + 'f'.repeat(7)).split('');
const PAST_DAYS = 28;

export function StreakCalendarScreen() {
  const [ref, inView] = useInView<HTMLDivElement>('0px');
  const [loopRef, step] = useStepLoop(36, 110, 35);
  const fill = Math.min(step, PAST_DAYS);

  // Newest filled workout day — the "comet head" of the sweep.
  let head = -1;
  CELLS.forEach((c, i) => {
    if (c === 'w' && i < fill) head = i;
  });

  return (
    <AppScreen>
      <div ref={ref} className="flex flex-1 flex-col gap-3 px-5 pt-1">
        <div>
          <AppEyebrow>Progress · Consistency</AppEyebrow>
          <AppTitle className="mt-1">Streak</AppTitle>
          <div className="mt-2 flex gap-2">
            <MetaChip>July 2026</MetaChip>
            <MetaChip>Best: 26 days</MetaChip>
          </div>
        </div>

        {/* Red hero block — the single energetic center */}
        <BlockCard tone="red" className="flex items-center justify-between py-4">
          <div>
            <AppEyebrow onBlock>Current streak</AppEyebrow>
            <div className="mt-1 flex items-baseline gap-1.5">
              <AppStat size={44} onBlock>
                <CountUp to={inView ? 18 : 0} duration={1400} />
              </AppStat>
              <span className="font-display text-[18px] font-medium text-ink/60">days</span>
            </div>
            <p className="mt-1 text-[10.5px] font-medium text-ink/60">Longest run this year</p>
          </div>
          <svg width="36" height="42" viewBox="0 0 24 28" fill="#0B0C0D" aria-hidden>
            <path d="M12 0s7 6.5 7 13.5a7 7 0 0 1-14 0C5 9 8 6 8 6s-.5 3.5 1.5 5C10.5 8 12 0 12 0Z" />
            <path
              d="M12 28a5.5 5.5 0 0 0 5.5-5.5c0-3-2.5-5-2.5-5s.2 2-1.5 3c0-2.5-1.5-4.5-1.5-4.5s-5 3.4-5 6.9A5.5 5.5 0 0 0 12 28Z"
              fill="#FF3B30"
              opacity="0.5"
            />
          </svg>
        </BlockCard>

        {/* Month heat-grid — fills day by day on a loop */}
        <BlockCard tone="charcoal">
          <div className="flex items-baseline justify-between">
            <AppEyebrow>This month</AppEyebrow>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              24 sessions
            </span>
          </div>
          <div ref={loopRef} className="mt-3 grid grid-cols-7 justify-items-center gap-y-2.5">
            {DAY_LABELS.map((d, i) => (
              <span key={`label-${i}`} className="font-mono text-[9.5px] font-semibold text-faint">
                {d}
              </span>
            ))}
            {CELLS.map((c, i) => {
              const filled = c === 'w' && i < fill;
              const cls = filled
                ? i === head
                  ? 'bg-red'
                  : 'bg-cream'
                : c === '.' && i < fill
                  ? 'bg-charcoal-3'
                  : c === 'f'
                    ? 'bg-charcoal-2 opacity-50'
                    : 'bg-charcoal-2';
              return (
                <span
                  key={`day-${i}`}
                  className={`size-[22px] rounded-full transition-colors duration-300 ${cls}`}
                />
              );
            })}
          </div>
        </BlockCard>

        {/* Cream counterpoint — week summary */}
        <BlockCard tone="cream" className="flex items-center justify-between py-3">
          <div>
            <AppEyebrow onBlock>This week</AppEyebrow>
            <span className="font-display text-[22px] font-medium text-ink">4 workouts</span>
          </div>
          <span className="rounded-full bg-ink px-3 py-1.5 text-[11px] font-semibold text-snow">
            On pace
          </span>
        </BlockCard>
      </div>
      <AppTabBar active="progress" />
    </AppScreen>
  );
}
