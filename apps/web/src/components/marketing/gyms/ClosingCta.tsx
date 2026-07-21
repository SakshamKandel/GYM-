'use client';

/**
 * Closing CTA — compact photo band (empty gym, black & white) under a dark
 * scrim. The page's send-off: get the app, walk in already sure.
 */
import { Reveal } from '../motion';
import { Container, Display, PillLink } from '../ui';

export function GymsClosingCta() {
  return (
    <section className="relative overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/stock/gym-empty-bw.jpg"
        alt=""
        aria-hidden
        className="absolute inset-0 size-full object-cover"
      />
      <div aria-hidden className="absolute inset-0 bg-black/70" />

      <Container className="relative z-10 py-28 text-center sm:py-36">
        <Reveal>
          <p className="font-mono text-[12px] font-medium uppercase tracking-[0.22em] text-snow/70">
            The Gyms tab
          </p>
          <Display size="lg" className="mt-4 text-snow">
            Walk in
            <br />
            already sure.
          </Display>
        </Reveal>
        <Reveal delay={120}>
          <p className="mx-auto mt-6 max-w-md text-[16px] leading-relaxed text-snow/80">
            Verified gyms near you — in the same app as your training, your food and
            your coach.
          </p>
        </Reveal>
        <Reveal delay={200} className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <PillLink href="/download">Get the app</PillLink>
          <PillLink href="/pricing" variant="ghost">
            See pricing
          </PillLink>
        </Reveal>
      </Container>
    </section>
  );
}
