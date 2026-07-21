'use client';

/**
 * Closing CTA — full-bleed coaching photo under a heavy scrim, compact and
 * direct: sign in if you're in, talk to us if you're not sure.
 */
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, PillLink } from '../ui';

export function ClosingCta() {
  return (
    <section className="relative overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/stock/woman-squat-portrait-bw.jpg"
        alt=""
        className="absolute inset-0 size-full object-cover object-top"
      />
      <div className="absolute inset-0 bg-black/70" />
      <Container className="relative py-32 text-center sm:py-40">
        <Reveal>
          <Eyebrow className="justify-center text-center !text-snow/60">
            Verified coaches only · Your code, your clients, your ledger
          </Eyebrow>
          <Display size="xl" className="mx-auto mt-5">
            Take the
            <span className="text-red"> floor.</span>
          </Display>
          <p className="mx-auto mt-6 max-w-md text-[17px] leading-relaxed text-snow/80">
            Already verified? Your console is waiting. Still deciding? Ask us anything —
            a coach will answer.
          </p>
        </Reveal>
        <Reveal delay={140} className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <PillLink href="/coach/login">Coach sign-in</PillLink>
          <PillLink href="/contact" variant="ghost">
            Talk to us
          </PillLink>
        </Reveal>
      </Container>
    </section>
  );
}
