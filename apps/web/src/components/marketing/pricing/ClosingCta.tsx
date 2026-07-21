'use client';

/**
 * Closing band — flat cream, compact, one job: get the free tier installed.
 */
import { Reveal } from '../motion';
import { ArrowLink, Container, Display, Eyebrow, Lead, PillLink, Section } from '../ui';

export function ClosingCta() {
  return (
    <Section tone="cream" pad="py-20 sm:py-28" ambient="none">
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <Reveal>
            <Eyebrow tone="light" className="text-center">
              No card · no trial timer · no lock-in
            </Eyebrow>
          </Reveal>
          <Reveal delay={80}>
            <Display size="lg" className="mt-4">
              Start free tonight.
            </Display>
          </Reveal>
          <Reveal delay={160}>
            <Lead tone="light" className="mx-auto mt-6">
              The whole self-tracking app costs nothing, forever. Upgrade in-app the day
              you want a real coach in your corner.
            </Lead>
          </Reveal>
          <Reveal delay={240} className="mt-9 flex flex-wrap items-center justify-center gap-5">
            <PillLink href="/download" variant="inkOnCream">
              Get the app — free
            </PillLink>
            <ArrowLink href="/coaching" className="text-ink">
              Meet the coaches
            </ArrowLink>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
