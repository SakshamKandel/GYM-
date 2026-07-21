'use client';

/**
 * Mock: the member's coach-assigned week — red note-from-coach block, three
 * assigned workout rows landing on a loop, the Gold diet-plan card (kcal +
 * protein targets), and one unread coach message chip sliding in last.
 */
import { useStepLoop } from '../motion';
import {
  AppEyebrow,
  AppScreen,
  AppStat,
  AppTabBar,
  AppTitle,
  AvatarDot,
  BlockCard,
} from './appkit';

const WEEK: readonly { day: string; name: string; meta: string }[] = [
  { day: 'Mon', name: 'Lower A · Squat focus', meta: '6 exercises · ~50 min' },
  { day: 'Wed', name: 'Push B · Bench + OHP', meta: '7 exercises · ~55 min' },
  { day: 'Fri', name: 'Pull B · Deadlift day', meta: '6 exercises · ~50 min' },
];

export function AssignedPlanScreen() {
  const [ref, step] = useStepLoop(7, 1100, 6);

  return (
    <AppScreen>
      <div ref={ref} className="flex flex-1 flex-col gap-2.5 px-5 pt-1">
        <div>
          <AppEyebrow>Week 3 · Assigned</AppEyebrow>
          <AppTitle className="mt-1 text-[30px]">From your coach</AppTitle>
        </div>

        {/* Red note block — the screen's single red moment */}
        <BlockCard tone="red" className="py-3.5">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink font-display text-[14px] font-medium text-snow">
              G
            </span>
            <div className="min-w-0 flex-1">
              <AppEyebrow onBlock>Note · Coach Gaurav</AppEyebrow>
              <p className="mt-1 text-[12.5px] font-medium leading-snug text-ink/80">
                &ldquo;Deload the squat this week — we push heavy again Monday.&rdquo;
              </p>
            </div>
          </div>
        </BlockCard>

        {/* Assigned week — rows land one by one */}
        <div>
          <AppEyebrow>This week</AppEyebrow>
          <div className="mt-2 flex flex-col gap-2">
            {WEEK.map((w, i) => {
              const shown = step >= i;
              const done = i === 0 && step >= 3;
              return (
                <div
                  key={w.day}
                  className={`flex min-h-[52px] items-center gap-3 rounded-[16px] bg-charcoal px-3.5 py-2.5 transition-all duration-500 ${
                    shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
                  }`}
                >
                  <span className="flex h-[30px] w-[42px] shrink-0 items-center justify-center rounded-[10px] bg-charcoal-2 font-display text-[11px] font-medium uppercase tracking-[0.08em] text-dim">
                    {w.day}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold leading-tight">
                      {w.name}
                    </span>
                    <span className="block text-[10.5px] text-dim">{w.meta}</span>
                  </span>
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold transition-all duration-300 ${
                      done ? 'scale-100 bg-red text-ink' : 'scale-90 bg-charcoal-2 text-faint'
                    }`}
                  >
                    ✓
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Diet plan — cream counterpoint, Gold-tier capability */}
        <BlockCard tone="cream" className="py-3.5">
          <div className="flex items-center justify-between">
            <AppEyebrow onBlock>Diet plan · assigned</AppEyebrow>
            <span className="rounded-full bg-ink/10 px-2.5 py-1 font-display text-[9.5px] font-medium uppercase tracking-[0.14em] text-ink/70">
              Gold
            </span>
          </div>
          <div className="mt-2 flex items-end gap-6">
            <div>
              <AppStat size={28} onBlock>
                2,450
              </AppStat>
              <span className="ml-1 text-[10.5px] font-semibold text-ink/55">kcal / day</span>
            </div>
            <div>
              <AppStat size={28} onBlock>
                165 g
              </AppStat>
              <span className="ml-1 text-[10.5px] font-semibold text-ink/55">protein</span>
            </div>
          </div>
        </BlockCard>

        {/* Unread coach message — chat unlocked by the active assignment */}
        <div
          className={`flex min-h-[52px] items-center gap-3 rounded-[16px] bg-charcoal px-3.5 py-2.5 transition-all duration-500 ${
            step >= 4 ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
          }`}
        >
          <AvatarDot letter="G" tone="cream" />
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold leading-tight">Coach Gaurav</span>
            <span className="block text-[10.5px] text-dim">1 new message · chat unlocked</span>
          </span>
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-red text-[11px] font-bold text-ink">
            1
          </span>
        </div>
      </div>
      <AppTabBar active="train" />
    </AppScreen>
  );
}
