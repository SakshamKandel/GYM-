'use client';

/**
 * About hero — cream, editorial. Big claim on the left, a framed runner-track
 * photo on the right. Red is an accent word only; /about carries no red band.
 */
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, Lead, PhotoBlock, PillLink } from '../ui';

export function AboutHero() {
  return (
    <div className="mkt-noise relative overflow-hidden bg-cream pb-24 pt-[120px] text-ink sm:pt-[140px]">
      <Container wide className="relative z-10">
        <div className="grid items-end gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <Reveal>
              <Eyebrow tone="light">About — The GM Method</Eyebrow>
            </Reveal>
            <Reveal delay={80}>
              <Display as="h1" size="xl" className="mt-5 text-ink">
                Built in<br />
                Kathmandu.<br />
                <span className="text-red-deep">Built to be used.</span>
              </Display>
            </Reveal>
            <Reveal delay={160}>
              <Lead tone="light" className="mt-7">
                We&rsquo;re coaches and engineers who got tired of juggling four apps and a
                chat thread. So we built one calm place to train, eat and keep going — for
                Nepal first, the world second.
              </Lead>
            </Reveal>
            <Reveal delay={240} className="mt-9 flex flex-wrap items-center gap-4">
              <PillLink href="/download">Get the app</PillLink>
              <PillLink href="/coaching" variant="inkOnCream">
                Meet the coaches
              </PillLink>
            </Reveal>
          </div>

          <Reveal delay={200}>
            <PhotoBlock
              src="/stock/runner-track.jpg"
              alt="A runner mid-stride on an outdoor track at dawn"
              caption="Kathmandu · training on our own tracks"
              className="aspect-[4/5] w-full"
            />
          </Reveal>
        </div>
      </Container>
    </div>
  );
}
