'use client';

/**
 * Download closing CTA — the page's single red section. Black text on red,
 * ink pill + arrow link (never white on red).
 */
import { Reveal } from '../motion';
import { ArrowLink, Container, Display, Eyebrow, PillLink, Section } from '../ui';

export function DownloadCta() {
  return (
    <Section tone="red" ambient="none" pad="py-24 sm:py-32">
      <Container className="text-center">
        <Reveal>
          <Eyebrow tone="red" className="mx-auto">
            Free to start · No account required
          </Eyebrow>
          <Display size="xl" className="mx-auto mt-5 text-ink">
            Start tonight.
          </Display>
          <p className="mx-auto mt-6 max-w-md text-[17px] leading-relaxed text-ink/75">
            Get on the early-access list and log your first workout before the motivation
            wears off.
          </p>
        </Reveal>
        <Reveal delay={140} className="mt-10 flex flex-wrap items-center justify-center gap-6">
          <PillLink href="/contact" variant="inkOnRed">
            Get early access
          </PillLink>
          <ArrowLink href="/pricing" className="text-ink">
            See pricing
          </ArrowLink>
        </Reveal>
      </Container>
    </Section>
  );
}
