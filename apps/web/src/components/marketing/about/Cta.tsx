'use client';

/**
 * About closing CTA — ink band with ambient aurora, gradient headline, red
 * accent word (no red section on /about). Get the app / see pricing.
 */
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, PillLink, Section } from '../ui';

export function AboutCta() {
  return (
    <Section tone="ink" ambient="aurora" grid pad="py-28 sm:py-36">
      <Container className="text-center">
        <Reveal>
          <Eyebrow className="mx-auto">Nepal first · the world second</Eyebrow>
          <Display size="xl" className="mx-auto mt-5">
            <span className="mkt-text-steel">Train with</span>{' '}
            <span className="mkt-text-ember">a plan.</span>
          </Display>
          <p className="mx-auto mt-6 max-w-md text-[17px] leading-relaxed text-dim">
            One calm app for training, food and everything after. Free to start, no account
            needed, offline from the first set.
          </p>
        </Reveal>
        <Reveal delay={140} className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <PillLink href="/download">Get the app</PillLink>
          <PillLink href="/pricing" variant="ghost">
            See pricing
          </PillLink>
        </Reveal>
      </Container>
    </Section>
  );
}
