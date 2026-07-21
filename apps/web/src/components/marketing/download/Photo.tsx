'use client';

/**
 * Photo band — a full, framed grab-shot of a dumbbell rack with a dry caption
 * overlaid. Built for the rack, not the demo reel.
 */
import { Reveal } from '../motion';
import { Container, Display, Section } from '../ui';

export function DownloadPhoto() {
  return (
    <Section tone="coal" pad="py-20 sm:py-28">
      <Container wide>
        <Reveal>
          <figure className="relative overflow-hidden rounded-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/stock/dumbbell-rack-grab.jpg"
              alt="A hand reaching for a dumbbell on a loaded rack in a dim gym"
              className="h-[340px] w-full object-cover sm:h-[440px]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
            <figcaption className="absolute inset-x-0 bottom-0 p-8 sm:p-12">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-snow/70">
                Real gyms · real reps
              </p>
              <Display size="md" className="mt-3 max-w-2xl text-snow">
                Built for the rack,<br />
                not the demo reel.
              </Display>
            </figcaption>
          </figure>
        </Reveal>
      </Container>
    </Section>
  );
}
