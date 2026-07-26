'use client';

/**
 * Photo band — a full, framed grab-shot of a dumbbell rack with a dry caption
 * overlaid. Built for the rack, not the demo reel.
 */
import Image from 'next/image';
import { Reveal } from '../motion';
import { Container, Display, Section } from '../ui';

export function DownloadPhoto() {
  return (
    <Section tone="coal" pad="py-20 sm:py-28">
      <Container wide>
        <Reveal>
          {/* Height moved onto the frame so the photo can fill it and be
              served at the width it is drawn at. */}
          <figure className="relative h-[340px] overflow-hidden rounded-block sm:h-[440px]">
            <Image
              src="/stock/dumbbell-rack-grab.jpg"
              alt="A hand reaching for a dumbbell on a loaded rack in a dim gym"
              fill
              sizes="(min-width: 1320px) 1240px, 100vw"
              className="object-cover"
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
