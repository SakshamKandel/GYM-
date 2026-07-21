'use client';

/**
 * Mock: coach discovery hub — public coach cards with live capacity chips.
 * The loop spotlights each coach, then a request lands (one pending at a
 * time — the app's real rule). Discovery lives outside the tab bar.
 */
import { useStepLoop } from '../motion';
import { AppEyebrow, AppScreen, AppTitle, AvatarDot, BlockCard } from './appkit';

const COACHES: readonly {
  initial: string;
  tone: 'red' | 'cream' | 'blue';
  name: string;
  headline: string;
  chips: readonly string[];
  capacity: string;
  full: boolean;
}[] = [
  {
    initial: 'M',
    tone: 'cream',
    name: 'Maya Shrestha',
    headline: 'Strength · 8 yrs',
    chips: ['Powerlifting', 'Form rehab'],
    capacity: '2 spots left',
    full: false,
  },
  {
    initial: 'G',
    tone: 'red',
    name: 'Gaurav Thapa',
    headline: 'Hypertrophy · 12 yrs',
    chips: ['Muscle gain', 'Contest prep'],
    capacity: '1 spot left',
    full: false,
  },
  {
    initial: 'D',
    tone: 'blue',
    name: 'Dipesh Rai',
    headline: 'Fat loss · 6 yrs',
    chips: ['Nutrition-first', 'Beginners'],
    capacity: 'Full',
    full: true,
  },
];

const FILTERS = ['All', 'Strength', 'Fat loss', 'Mobility'] as const;

export function CoachDiscoveryScreen() {
  const [ref, step] = useStepLoop(6, 1350, 5);
  const highlight = step <= 2 ? step : -1;
  const pending = step >= 3;

  return (
    <AppScreen>
      <div ref={ref} className="flex flex-1 flex-col gap-3 px-5 pt-1">
        <div>
          <AppEyebrow>Mentorship · Admin-verified</AppEyebrow>
          <AppTitle className="mt-1">
            Find your
            <br />
            coach
          </AppTitle>
        </div>

        {/* Filter chips */}
        <div className="flex gap-2">
          {FILTERS.map((f, i) => (
            <span
              key={f}
              className={`inline-flex h-[26px] items-center rounded-full px-3 text-[10.5px] font-medium ${
                i === 0
                  ? 'bg-snow text-ink'
                  : 'border border-line-strong text-dim'
              }`}
            >
              {f}
            </span>
          ))}
        </div>

        {/* Coach cards — the loop spotlights each in turn */}
        {COACHES.map((c, i) => (
          <BlockCard
            key={c.name}
            tone={highlight === i ? 'raised' : 'charcoal'}
            className="transition-colors duration-500"
          >
            <div className="flex items-center gap-3">
              <AvatarDot letter={c.initial} tone={c.tone} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold leading-tight">
                  {c.name}
                </span>
                <span className="block text-[11px] text-dim">{c.headline}</span>
              </span>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                  c.full ? 'bg-black/25 text-faint' : 'bg-red/15 text-red-glow'
                }`}
              >
                {c.capacity}
              </span>
            </div>
            <div className="mt-2.5 flex gap-1.5">
              {c.chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-line-strong px-2.5 py-[3px] text-[10px] text-dim"
                >
                  {chip}
                </span>
              ))}
            </div>
          </BlockCard>
        ))}

        {/* One pending request at a time — the red moment */}
        {pending ? (
          <BlockCard tone="red" className="mkt-reveal is-in flex items-center gap-3 py-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-bold text-snow">
              ✓
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-bold text-ink">
                Request sent · Maya Shrestha
              </span>
              <span className="block text-[10.5px] font-medium text-ink/60">
                One pending request at a time
              </span>
            </span>
          </BlockCard>
        ) : null}
      </div>
    </AppScreen>
  );
}
