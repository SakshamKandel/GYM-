'use client';

/**
 * Mock: the Gyms tab list — "Gyms near you" with a search pill, filter chips
 * and verified gym cards (photo strip, area, open/distance chips).
 * Matches mobile app (tabs)/gyms.tsx.
 */
import { useInView } from '../motion';
import { AppEyebrow, AppHeader, AppScreen, AppTabBar, AppTitle, type TabName } from './appkit';

const GYMS = [
  {
    name: 'Wave Health Club',
    area: 'Kamaladi · Kathmandu',
    photo: '/stock/gym-interior-bright.jpg',
    distance: '350 m',
    open: true,
    nearest: true,
  },
  {
    name: 'Iron Yak Strength',
    area: 'Jhamsikhel · Lalitpur',
    photo: '/stock/gym-dumbbells.jpg',
    distance: '1.8 km',
    open: true,
    nearest: false,
  },
  {
    name: 'Everest Barbell Co.',
    area: 'Baneshwor · Kathmandu',
    photo: '/stock/gym-empty-bw.jpg',
    distance: '2.6 km',
    open: false,
    nearest: false,
  },
] as const;

export function GymListScreen({ onTabChange }: { onTabChange?: (tab: TabName) => void }) {
  const [ref, inView] = useInView<HTMLDivElement>('0px');

  return (
    <AppScreen>
      <AppHeader displayName="Athlete" greeting="Gym Discovery" streak="18 wks" tier="elite" />

      <div
        ref={ref}
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 pb-20 pt-1 no-scrollbar"
      >
        <div>
          <AppEyebrow>Kathmandu Valley</AppEyebrow>
          <AppTitle className="mt-0.5 text-[26px]">Gyms Near You</AppTitle>
        </div>

        {/* Search pill */}
        <div className="flex h-[38px] items-center gap-2 rounded-full bg-charcoal-2 border border-line-strong/30 px-3.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9BA0A8" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m15.5 15.5 5 5" />
          </svg>
          <span className="text-[11.5px] text-dim font-medium">Search gyms or locations...</span>
        </div>

        {/* Filter chips */}
        <div className="flex gap-1.5">
          <span className="inline-flex h-[22px] items-center rounded-full bg-red px-2.5 text-[10px] font-bold text-ink">
            Near me
          </span>
          <span className="inline-flex h-[22px] items-center rounded-full border border-line-strong px-2.5 text-[10px] font-medium text-snow">
            Open now
          </span>
          <span className="inline-flex h-[22px] items-center rounded-full border border-line-strong px-2.5 text-[10px] font-medium text-dim">
            Day pass available
          </span>
        </div>

        {/* Gym cards */}
        <div className="flex flex-col gap-2">
          {GYMS.map((gym, i) => (
            <div
              key={gym.name}
              className={`overflow-hidden rounded-[18px] border border-line-strong/20 transition-all duration-300 ${
                gym.nearest ? 'bg-charcoal-2 shadow-md' : 'bg-charcoal'
              } ${inView ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
              style={{ transitionDelay: `${i * 100}ms` }}
            >
              {/* Photo strip */}
              <div className="h-[58px] overflow-hidden relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={gym.photo} alt={gym.name} className="size-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-charcoal to-transparent opacity-80" />
              </div>
              <div className="px-3 pb-2.5 pt-1.5">
                <span className="block text-[12.5px] font-bold text-snow leading-tight">{gym.name}</span>
                <span className="mt-0.5 block text-[10.5px] text-dim">{gym.area}</span>
                <div className="mt-1.5 flex items-center gap-1.5">
                  {gym.nearest ? (
                    <span className="inline-flex h-[20px] items-center rounded-full bg-red px-2 text-[9.5px] font-bold text-ink">
                      Nearest
                    </span>
                  ) : null}
                  {gym.open ? (
                    <span className="inline-flex h-[20px] items-center gap-1 rounded-full border border-mint/40 bg-mint/10 px-2 text-[9.5px] font-semibold text-mint">
                      <span className="size-1 rounded-full bg-mint" />
                      Open now
                    </span>
                  ) : (
                    <span className="inline-flex h-[20px] items-center rounded-full border border-line-strong px-2 text-[9.5px] font-medium text-dim">
                      Opens 5:00
                    </span>
                  )}
                  <span className="inline-flex h-[20px] items-center rounded-full border border-line-strong px-2 text-[9.5px] font-medium text-snow/80">
                    {gym.distance}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <AppTabBar active="gyms" onTabChange={onTabChange} />
    </AppScreen>
  );
}
