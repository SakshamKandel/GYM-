'use client';

/**
 * /nutrition proof band — four product-truth numerals on paper, ink display
 * type with mono captions.
 */
import { CountUp, Reveal } from '../motion';
import { Container, Section, StatBig } from '../ui';

export function NutritionProof() {
  return (
    <Section tone="paper" pad="py-16 sm:py-20">
      <Container wide>
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 md:grid-cols-4">
          <Reveal>
            <StatBig tone="light" value={<CountUp to={2} />} caption="global food databases" />
          </Reveal>
          <Reveal delay={90}>
            <StatBig tone="light" value="A–E" caption="Nutri-Score + NOVA signals" />
          </Reveal>
          <Reveal delay={180}>
            <StatBig tone="light" value="<100 ms" caption="offline log confirm" />
          </Reveal>
          <Reveal delay={270}>
            <StatBig tone="light" value="0" caption="ads in your diary, ever" />
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
