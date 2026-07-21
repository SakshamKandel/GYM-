'use client';

/**
 * Photo interlude — one wide framed photograph between the cream owners band
 * and the cross-links. Breathing room, not content.
 */
import { Reveal } from '../motion';
import { Container, PhotoBlock, Section } from '../ui';

export function GymsInterlude() {
  return (
    <Section tone="ink" pad="py-16 sm:py-20">
      <Container wide>
        <Reveal>
          <PhotoBlock
            src="/stock/gym-dumbbells.jpg"
            alt="Rows of dumbbells lined up on a rack in a well-lit gym"
            caption="Pick your floor — then go lift on it"
            className="aspect-[16/9] w-full sm:aspect-[21/9]"
          />
        </Reveal>
      </Container>
    </Section>
  );
}
