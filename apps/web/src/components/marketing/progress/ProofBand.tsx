'use client';

/**
 * Proof band — four product-truth claims about how progress is measured.
 */
import { Reveal } from '../motion';
import { Container, Section, StatBig } from '../ui';

const STATS = [
  { value: 'EWMA', caption: 'trend smoothing — unit-tested' },
  { value: 'Auto', caption: 'PR detection on every saved set' },
  { value: 'Signed', caption: 'URLs guard every progress photo' },
  { value: 'Weekly', caption: 'progress report on your Home screen' },
] as const;

export function ProofBand() {
  return (
    <Section tone="ink" ambient="none" pad="pb-20 pt-2 sm:pb-24">
      <Container wide>
        <div className="mkt-divider" />
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 pt-14 md:grid-cols-4">
          {STATS.map((s, i) => (
            <Reveal key={s.value} delay={i * 90}>
              <StatBig value={s.value} caption={s.caption} />
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
