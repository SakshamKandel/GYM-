'use client';

/**
 * Attribution — quiet, honest credit for the open-source work we stand on.
 * Z-Anatomy is CC BY-SA; we credit it and share back under the same license.
 */
import { Reveal } from '../motion';
import { ArrowLink, Container, Eyebrow, Section } from '../ui';

export function AboutAttribution() {
  return (
    <Section tone="ink" pad="py-20 sm:py-24">
      <Container wide>
        <Reveal>
          <div className="mkt-glass rounded-block p-8 sm:p-10">
            <div className="grid gap-8 lg:grid-cols-[0.5fr_1fr] lg:items-center">
              <div>
                <Eyebrow>Standing on open source</Eyebrow>
                <p className="mt-4 font-display text-3xl font-medium uppercase leading-tight text-snow">
                  We credit the<br />
                  work we build on.
                </p>
              </div>
              <div className="space-y-4 text-[15px] leading-relaxed text-dim">
                <p>
                  The app&rsquo;s 3D anatomy explorer — 17 tappable muscle zones — is built on
                  <span className="text-snow"> Z-Anatomy</span>, an open anatomical model
                  licensed <span className="text-snow">CC BY-SA</span>. We credit it inside the
                  app and release our changes under the same license.
                </p>
                <p>
                  Good tools are made of other people&rsquo;s good work. Where we lean on
                  open source, we say so plainly and give back — that&rsquo;s the deal, and we
                  keep it.
                </p>
                <ArrowLink href="/training" className="text-red-glow">
                  See the anatomy explorer
                </ArrowLink>
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
