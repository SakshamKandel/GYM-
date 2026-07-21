'use client';

/**
 * Measurements deep-dive — cream editorial band, device left, copy right.
 */
import { PhoneFrame } from '../PhoneFrame';
import { Reveal } from '../motion';
import { MeasurementsScreen } from '../screens/MeasurementsScreen';
import { CheckItem, Container, Display, Eyebrow, Lead, Section } from '../ui';

export function MeasurementsSection() {
  return (
    <Section tone="cream">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-[0.95fr_1.05fr]">
          <Reveal className="order-2 flex justify-center lg:order-1 lg:justify-start lg:pl-8">
            <PhoneFrame tilt="left" scale={0.9}>
              <MeasurementsScreen />
            </PhoneFrame>
          </Reveal>

          <div className="order-1 lg:order-2">
            <Reveal>
              <Eyebrow tone="light">02 — Measurements</Eyebrow>
              <Display className="mt-4">
                The tape
                <br />
                doesn&rsquo;t lie.
              </Display>
              <Lead tone="light" className="mt-6">
                Weight can&rsquo;t tell you where it went. The tape can. Log chest, waist,
                biceps and thigh, and every entry shows its delta from the last one — so
                recomposition shows up in centimetres even in weeks when the scale stalls.
              </Lead>
            </Reveal>
            <Reveal delay={140}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem tone="light">Per-site history with a delta on every entry</CheckItem>
                <CheckItem tone="light">
                  Mint when it drops, red when it grows — you decide which is the win
                </CheckItem>
                <CheckItem tone="light">
                  Sits beside your weight trend and photos on one timeline
                </CheckItem>
              </ul>
            </Reveal>
            <Reveal delay={220}>
              <p className="mt-8 font-mono text-[11.5px] uppercase tracking-[0.2em] text-cream-dim">
                Centimetres move when kilograms won&rsquo;t
              </p>
            </Reveal>
          </div>
        </div>
      </Container>
    </Section>
  );
}
