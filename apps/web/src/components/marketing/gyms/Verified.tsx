'use client';

/**
 * Verified-listings band (cream) — the editorial counterpoint right after the
 * hero: what "curated" actually means, as three concrete checks.
 */
import { Reveal } from '../motion';
import { CheckItem, Container, Display, Eyebrow, Lead, Section } from '../ui';

const CHECKS = [
  {
    title: 'Photos verified',
    body: 'Every photo shows the actual floor — the racks, the machines, the room you’ll train in. Nothing pulled off the internet.',
  },
  {
    title: 'Hours kept current',
    body: 'Opening times are maintained by the GM team, listing by listing. If a gym changes its Saturday hours, the app changes too.',
  },
  {
    title: 'No pay-to-rank',
    body: 'Placement can’t be bought and there are no fake reviews. A listing earns its spot by being accurate, not by paying.',
  },
] as const;

export function VerifiedBand() {
  return (
    <Section tone="cream">
      <Container wide>
        <div className="max-w-2xl">
          <Reveal>
            <Eyebrow tone="light">The listing standard</Eyebrow>
            <Display className="mt-4">
              If it&rsquo;s listed,
              <br />
              it&rsquo;s verified.
            </Display>
          </Reveal>
          <Reveal delay={100}>
            <Lead tone="light" className="mt-6">
              No scraped data, no stale directories. The GM team adds and maintains every
              gym listing by hand — and nothing about a listing is for sale.
            </Lead>
          </Reveal>
        </div>

        <div className="mt-14 grid gap-10 md:grid-cols-3">
          {CHECKS.map((check, i) => (
            <Reveal key={check.title} delay={i * 110}>
              <ul>
                <CheckItem tone="light">
                  <span className="block font-display text-[19px] font-medium uppercase leading-tight">
                    {check.title}
                  </span>
                  <span className="mt-2 block text-[14.5px] leading-relaxed text-cream-dim">
                    {check.body}
                  </span>
                </CheckItem>
              </ul>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
