'use client';

/**
 * Mock: the app's body-measurements & EWMA weight trend view — red hero block tracking waist
 * toward a goal, per-site rows with delta chips, weight trend curve.
 * Matches mobile app (tabs)/progress.tsx.
 */
import { CountUp, useInView } from '../motion';
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

const SITES = [
  { name: 'Chest', value: '102.4', delta: '+0.8', up: true },
  { name: 'Waist', value: '78.4', delta: '−2.5', up: false },
  { name: 'Biceps', value: '38.6', delta: '+0.6', up: true },
  { name: 'Thigh', value: '59.2', delta: '−1.1', up: false },
] as const;

export function MeasurementsScreen({ onTabChange }: { onTabChange?: (tab: TabName) => void }) {
  const [ref, inView] = useInView<HTMLDivElement>('0px');

  return (
    <AppScreen>
      <AppHeader displayName="Athlete" greeting="Analytics" streak="18 wks" tier="elite" />

      <div
        ref={ref}
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 pb-20 pt-1 no-scrollbar"
      >
        <div>
          <AppEyebrow>Body Analytics · 12 Wks</AppEyebrow>
          <AppTitle className="mt-0.5 text-[26px]">Progress</AppTitle>
          <div className="mt-1.5 flex gap-1.5">
            <MetaChip>EWMA Trend: 74.2 kg</MetaChip>
            <MetaChip>−0.4 kg/wk</MetaChip>
          </div>
        </div>

        {/* EWMA Weight Smoothed Trend Hero — Signal Red */}
        <BlockCard tone="red" className="p-3.5">
          <AppEyebrow onBlock>Waist Reduction · since April</AppEyebrow>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <AppStat size={36} onBlock>
              <CountUp to={inView ? -6.2 : 0} decimals={1} duration={1400} />
            </AppStat>
            <span className="font-display text-[16px] font-medium text-ink/60">cm reduced</span>
          </div>
          <MiniBar pct={inView ? 72 : 0} onBlock className="mt-2.5" />
          <p className="mt-2 text-[10.5px] font-medium text-ink/70">
            78.4 cm now · 2.4 cm remaining to 76.0 cm goal
          </p>
        </BlockCard>

        {/* Per-site rows */}
        <div className="flex flex-col gap-1.5">
          <AppEyebrow className="px-1">Body Measurements</AppEyebrow>
          {SITES.map((m, i) => (
            <div
              key={m.name}
              style={{ transitionDelay: `${150 + i * 100}ms` }}
              className={`flex min-h-[46px] items-center justify-between rounded-[16px] bg-charcoal px-3.5 transition-all duration-300 ${
                inView ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
              }`}
            >
              <span className="text-[12.5px] font-bold text-snow">{m.name}</span>
              <span className="flex items-center gap-2">
                <span className="font-display text-[17px] font-medium text-snow">
                  {m.value}
                  <span className="ml-0.5 text-[10px] font-normal text-dim">cm</span>
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    m.up ? 'bg-red/15 text-red-glow' : 'bg-mint/15 text-mint'
                  }`}
                >
                  {m.delta}
                </span>
              </span>
            </div>
          ))}
        </div>

        {/* Add Measurement pill button */}
        <span className="flex h-[40px] items-center justify-center gap-1 rounded-full bg-cream text-[12px] font-bold text-ink shadow-md">
          <span aria-hidden className="text-[14px] leading-none">
            +
          </span>
          Log New Measurement
        </span>
      </div>

      <AppTabBar active="progress" onTabChange={onTabChange} />
    </AppScreen>
  );
}
