'use client';

/**
 * "Everything app" bento v3 — six feature modules styled with chunky block cards,
 * design tokens matching the Expo mobile app.
 */
import Link from 'next/link';
import { Reveal, Stagger, StaggerItem } from '../motion';
import { Container, Display, Eyebrow, Lead, Section } from '../ui';

function ModuleIcon({ path }: { path: string }) {
  return (
    <span className="flex size-11 items-center justify-center rounded-[14px] border border-mist bg-paper shadow-sm">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d={path}
          stroke="#17181b"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

const MODULES = [
  {
    n: '01',
    title: 'Train',
    href: '/training',
    blurb: 'Coach-built plans, a gym mode that flows set to set, true-3D muscle heatmaps, and PR detection.',
    icon: 'M6.5 6.5v11m11-11v11M3.5 9.5v5m17-5v5M6.5 12h11',
  },
  {
    n: '02',
    title: 'Food',
    href: '/nutrition',
    blurb: 'Macros without the math — barcode scans, a Nepali + global food database, water and Nutri-Score.',
    icon: 'M4 17h16M5 17c0-5 3-9 7-9s7 4 7 9M12 8V5m0 0c2 0 3-1.5 3-3',
  },
  {
    n: '03',
    title: 'Progress',
    href: '/progress',
    blurb: 'Smoothed EWMA weight trends, body measurements and streak tracking. Proof, not vibes.',
    icon: 'M4 19h16M6 16l4-6 3.5 3.5L18 8m0 0h-3.5M18 8v3.5',
  },
  {
    n: '04',
    title: 'Meals',
    href: '/meals',
    blurb: 'Macro-counted meals from partner kitchens, delivered across Kathmandu valley.',
    icon: 'M3 7h11v9H3zM14 10h4l3 3v3h-7zM7.5 19a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Zm10 0a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z',
  },
  {
    n: '05',
    title: 'Gyms',
    href: '/gyms',
    blurb: 'Find a verified gym near you — photos, hours, pricing, and day passes.',
    icon: 'M12 21s-6.5-5.4-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.6 12 21 12 21Zm0-8.2a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z',
  },
  {
    n: '06',
    title: 'Coaching',
    href: '/coaching',
    blurb: 'Real, verified human coaches. Custom workouts, diet plans and 1-on-1 chat — no bots.',
    icon: 'M4 5h16v10H8l-4 4zM8 9h8M8 12h5',
  },
] as const;

export function HomeModules() {
  return (
    <Section tone="paper" id="features">
      <Container wide>
        <Reveal>
          <Eyebrow tone="light">What&rsquo;s inside</Eyebrow>
          <Display size="lg" className="mt-4 max-w-3xl">
            Six apps&rsquo; worth of fitness. One quiet home screen.
          </Display>
          <Lead tone="light" className="mt-6">
            Most people juggle a workout app, a calorie app, a delivery app and a coach on
            WhatsApp. The GM Method folds all of it into one place that works offline.
          </Lead>
        </Reveal>

        <Stagger className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" gap={0.08}>
          {MODULES.map((m) => (
            <StaggerItem key={m.n}>
              <Link
                href={m.href}
                className="mkt-card-light mkt-card-light-hover group flex min-h-[240px] flex-col justify-between rounded-block p-7 border border-mist transition-all duration-300"
              >
                <div className="flex items-start justify-between">
                  <ModuleIcon path={m.icon} />
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-full border border-mist text-[15px] text-gravel transition-all duration-300 group-hover:border-red group-hover:bg-red group-hover:text-ink group-hover:shadow-ember"
                  >
                    →
                  </span>
                </div>
                <div className="pt-10">
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-gravel-faint font-semibold">
                    {m.n}
                  </p>
                  <h3 className="mt-1.5 font-display text-3xl font-medium uppercase text-ink">
                    {m.title}
                  </h3>
                  <p className="mt-2.5 text-[14.5px] leading-relaxed text-gravel">{m.blurb}</p>
                </div>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      </Container>
    </Section>
  );
}
