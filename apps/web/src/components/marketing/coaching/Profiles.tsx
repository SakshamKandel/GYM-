'use client';

/**
 * Verified public profiles — the coach-profile screen in a tilted device,
 * next to the case for readable track records + the coach seniority ladder.
 */
import { PhoneFrame } from '../PhoneFrame';
import { Reveal } from '../motion';
import { CoachProfileScreen } from '../screens/CoachProfileScreen';
import { CheckItem, Container, Display, Eyebrow, Lead, Section } from '../ui';

const SENIORITY = [
  {
    dot: 'bg-snow/50',
    name: 'Silver',
    blurb: 'Verified and practicing — the entry seniority every coach starts at.',
  },
  {
    dot: 'bg-gold',
    name: 'Gold',
    blurb: 'A sustained roster and a consistent record of client results.',
  },
  {
    dot: 'bg-red',
    name: 'Elite',
    blurb: 'The platform’s most senior coaches — capacity fills fastest here.',
  },
] as const;

export function CoachingProfiles() {
  return (
    <Section tone="ink">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <Reveal className="order-2 flex justify-center lg:order-1">
            <PhoneFrame tilt="left" scale={0.88}>
              <CoachProfileScreen />
            </PhoneFrame>
          </Reveal>

          <div className="order-1 lg:order-2">
            <Reveal>
              <Eyebrow>Public profiles</Eyebrow>
              <Display className="mt-4">
                Track records,
                <br />
                not vibes.
              </Display>
              <Lead className="mt-6">
                Every coach passes admin verification before they appear in discovery — and
                everything you&rsquo;d want to ask is already on the profile: certifications,
                specialties, years of practice, live capacity, and milestones they&rsquo;ve
                logged for real clients.
              </Lead>
            </Reveal>
            <Reveal delay={120}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem>Certifications, specialties and years — listed up front</CheckItem>
                <CheckItem>Live capacity on every card — full rosters say so</CheckItem>
                <CheckItem>Client milestones logged by the coach, dated and public</CheckItem>
              </ul>
            </Reveal>

            {/* Seniority ladder */}
            <Reveal delay={200}>
              <div className="mkt-glass mt-9 rounded-block p-5 sm:p-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dim">
                  Coach seniority
                </p>
                <div className="mt-4 flex flex-col gap-3.5">
                  {SENIORITY.map((t) => (
                    <div key={t.name} className="flex items-start gap-3">
                      <span aria-hidden className={`mt-[7px] size-2.5 shrink-0 rounded-full ${t.dot}`} />
                      <p className="text-[14px] leading-relaxed text-dim">
                        <span className="font-display text-[15px] font-medium uppercase tracking-[0.04em] text-snow">
                          {t.name}
                        </span>{' '}
                        — {t.blurb}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">
                  Granted by admin review — never self-assigned
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </Container>
    </Section>
  );
}
