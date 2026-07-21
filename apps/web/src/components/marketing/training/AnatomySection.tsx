'use client';

/**
 * True-3D anatomy section (paper-2) — the REAL in-app Three.js viewer
 * embedded live (no device chrome, no mockup): drag to orbit, tap muscles,
 * front/back. The dark viewer is the "Iron" inside the paper band.
 */
import { Anatomy3D } from '../Anatomy3D';
import { Parallax, Reveal } from '../motion';
import { Container, Display, Eyebrow, Lead, Section } from '../ui';

const CHIPS = [
  '17 heat-mapped zones',
  'Tap · Orbit · Zoom',
  'Front / back views',
  'Ships offline in the app',
] as const;

export function AnatomySection() {
  return (
    <Section tone="paper-2" grid>
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div>
            <Reveal>
              <Eyebrow tone="light">02 — 3-D anatomy</Eyebrow>
              <Display className="mt-4">
                The body,
                <br />
                in true 3-D.
              </Display>
              <Lead tone="light" className="mt-6">
                Not a flat diagram — a real three-dimensional body you can spin. Tap any of 17
                heat-mapped muscle zones to see the exercises that hit it, orbit and zoom with a
                finger, flip front to back.
              </Lead>
            </Reveal>
            <Reveal delay={120}>
              <div className="mt-8 flex flex-wrap gap-2.5">
                {CHIPS.map((c) => (
                  <span
                    key={c}
                    className="mkt-card-light inline-flex h-10 items-center rounded-full px-4 font-mono text-[11.5px] font-medium uppercase tracking-[0.14em] text-gravel"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </Reveal>
            <Reveal delay={200}>
              <p className="mt-8 max-w-md text-[14.5px] leading-relaxed text-gravel">
                This isn&rsquo;t a mockup — it&rsquo;s the exact viewer that ships inside the
                app, running right here. It loads no network assets on your phone, so it works
                at the squat rack with zero signal.
              </p>
            </Reveal>
          </div>

          <Reveal delay={140}>
            <Parallax range={32}>
              <Anatomy3D className="mx-auto w-full max-w-[480px]" />
            </Parallax>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
