'use client';

/**
 * Mock: the app's Home "Today" screen — accurate replica of mobile app (tabs)/index.tsx.
 * Features: AppHeader top bar, ScreenHeader, Photographic Hero block, Bento Activity section,
 * Stat Tiles (Volume, Sessions, PRs), Body Weight trend, Coach entry, and 6-tab FloatingTabBar.
 */
import { CountUp, useInView, useStepLoop } from '../motion';
import {
  AppEyebrow,
  AppHeader,
  AppScreen,
  AppTabBar,
  AppTitle,
  BlockCard,
  BlockPill,
  MetaChip,
  MiniBar,
  type TabName,
} from './appkit';

const EXERCISES = [
  { name: 'Barbell Bench Press', detail: '4 × 8 · 72.5 kg' },
  { name: 'Incline DB Press', detail: '3 × 10 · 26 kg' },
  { name: 'Cable Fly', detail: '3 × 12 · 25 kg' },
] as const;

export function TodayScreen({ onTabChange }: { onTabChange?: (tab: TabName) => void }) {
  const [ref, inView] = useInView<HTMLDivElement>('0px');
  const [loopRef, step] = useStepLoop(5, 1300);

  return (
    <AppScreen>
      <AppHeader displayName="Athlete" greeting="Good morning" streak="18 wks" tier="elite" />

      <div
        ref={ref}
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 pb-20 pt-1 no-scrollbar"
      >
        {/* Screen Title */}
        <div>
          <AppEyebrow>Focus</AppEyebrow>
          <AppTitle className="mt-0.5 text-[28px] tracking-tight">Today</AppTitle>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <MetaChip>Tue, Jul 21</MetaChip>
            <MetaChip>4 sessions this week</MetaChip>
          </div>
          <p className="mt-2 text-[12px] text-dim leading-snug">
            Push day is ready. Everything you need for today is below.
          </p>
        </div>

        {/* Photographic Hero block — Signal Red / Dark photo scrim */}
        <div className="relative overflow-hidden rounded-[22px] bg-charcoal p-4 text-snow shadow-lg">
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B0C0D] via-[#0B0C0D]/80 to-transparent z-10" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-red/30 via-transparent to-transparent z-10" />
          <div className="relative z-20 flex flex-col gap-2">
            <span className="self-start rounded-full bg-red px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink">
              Up next
            </span>
            <h4 className="font-display text-[26px] font-medium uppercase leading-tight tracking-wide text-snow">
              Hypertrophy Push 1
            </h4>
            <p className="text-[11.5px] text-dim font-medium">GM Push Plan · 6 exercises</p>
            <div className="mt-2">
              <BlockPill className="w-full shadow-ember">Start workout</BlockPill>
            </div>
          </div>
        </div>

        {/* Bento Activity Zone: Cream Steps block + Charcoal Calories block */}
        <div className="grid grid-cols-2 gap-2">
          <BlockCard tone="cream" className="flex flex-col justify-between p-3.5">
            <div>
              <AppEyebrow onBlock>Steps Today</AppEyebrow>
              <div className="mt-1 font-display text-[26px] font-medium leading-none text-ink">
                <CountUp to={inView ? 8420 : 0} duration={1000} />
              </div>
            </div>
            <p className="mt-2 text-[10.5px] font-medium text-cream-dim">Goal 10,000 steps</p>
          </BlockCard>

          <BlockCard tone="charcoal" className="flex flex-col justify-between p-3.5 bg-charcoal-2">
            <div>
              <AppEyebrow>Calories</AppEyebrow>
              <div className="mt-1 font-display text-[26px] font-medium leading-none text-snow">
                <CountUp to={inView ? 1840 : 0} duration={1000} />
                <span className="text-[14px] font-normal text-dim"> / 2.6k</span>
              </div>
            </div>
            <MiniBar pct={70} className="mt-2" />
          </BlockCard>
        </div>

        {/* Bento Stat Tiles: Volume & Sessions */}
        <div className="grid grid-cols-2 gap-2">
          <BlockCard tone="charcoal" className="p-3">
            <AppEyebrow>Volume</AppEyebrow>
            <div className="mt-1 font-display text-[22px] font-medium text-snow">
              <CountUp to={inView ? 14250 : 0} duration={1100} /> <span className="text-[12px] font-normal text-dim">kg</span>
            </div>
          </BlockCard>
          <BlockCard tone="charcoal" className="p-3">
            <AppEyebrow>Sessions</AppEyebrow>
            <div className="mt-1 font-display text-[22px] font-medium text-snow">
              4 <span className="text-[12px] font-normal text-dim">this wk</span>
            </div>
          </BlockCard>
        </div>

        {/* Exercise checkmark checklist preview */}
        <div ref={loopRef} className="flex flex-col gap-1.5">
          <AppEyebrow className="px-1">Target Exercises</AppEyebrow>
          {EXERCISES.map((ex, i) => {
            const done = step > i;
            return (
              <div
                key={ex.name}
                className="flex items-center gap-2.5 rounded-[16px] bg-charcoal px-3 py-2 text-snow"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-charcoal-2 text-red font-bold text-xs">
                  {i + 1}
                </span>
                <span className="flex-1">
                  <span className="block text-[12px] font-semibold leading-tight">{ex.name}</span>
                  <span className="block text-[10.5px] text-dim">{ex.detail}</span>
                </span>
                <span
                  className={`flex size-5 items-center justify-center rounded-full text-[10px] font-bold transition-all duration-300 ${
                    done ? 'scale-100 bg-red text-ink' : 'scale-90 bg-charcoal-2 text-faint'
                  }`}
                >
                  ✓
                </span>
              </div>
            );
          })}
        </div>

        {/* Coach Entry Card */}
        <BlockCard tone="charcoal" className="flex items-center gap-3 p-3 bg-charcoal-2">
          <div className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-red text-ink font-display font-bold text-sm">
            GR
          </div>
          <div className="flex-1">
            <p className="text-[12.5px] font-bold text-snow">Greece (1-on-1 Coach)</p>
            <p className="text-[11px] text-dim">Ready when you are · Active plan</p>
          </div>
          <span className="rounded-full bg-red/20 px-2 py-0.5 text-[10px] font-semibold text-red">
            Enrolled
          </span>
        </BlockCard>
      </div>

      <AppTabBar active="home" onTabChange={onTabChange} />
    </AppScreen>
  );
}
