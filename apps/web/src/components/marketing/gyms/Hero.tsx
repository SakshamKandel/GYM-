'use client';

/**
 * Gyms hero — centered for variety: glass chip + steel/ember display + lead
 * stacked center over the ember aurora and blueprint grid, with the Gyms-tab
 * list screen rising from the bottom edge of the section (cropped by the
 * hero's overflow).
 */
import { PhoneFrame } from '../PhoneFrame';
import { Reveal } from '../motion';
import { GymListScreen } from '../screens/GymListScreen';
import { Container, PillLink } from '../ui';

export function GymsHero() {
  return (
    <div className="mkt-noise mkt-aurora relative overflow-hidden bg-ink pt-[120px] sm:pt-[140px]">
      <div aria-hidden className="mkt-gridlines absolute inset-0" />

      <Container className="relative z-10 flex flex-col items-center text-center">
        <Reveal delay={80}>
          <h1 className="mt-6 font-display text-[15vw] font-medium uppercase leading-[0.92] sm:text-7xl md:text-8xl">
            <span className="mkt-text-steel">Know the </span>
            <span className="mkt-text-ember">gym</span>
            <br />
            <span className="mkt-text-steel">before you go.</span>
          </h1>
        </Reveal>
        <Reveal delay={160}>
          <p className="mx-auto mt-7 max-w-2xl text-[17px] leading-relaxed text-dim">
            Curated, admin-verified gym listings across Kathmandu valley — real photos,
            current hours, exact location and contact. Browse the Gyms tab, compare
            what&rsquo;s nearby, and walk in already sure.
          </p>
        </Reveal>
        <Reveal delay={240} className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <PillLink href="/download">Get the app</PillLink>
          <PillLink href="/contact" variant="ghost">
            Get your gym listed
          </PillLink>
        </Reveal>
        <Reveal delay={320}>
          <p className="mt-8 font-mono text-[11.5px] uppercase tracking-[0.2em] text-faint">
            Every listing checked by the GM team · No fake reviews
          </p>
        </Reveal>

        {/* Phone rising from the hero's bottom edge, cropped by the section */}
        <Reveal delay={380} className="mt-16 flex justify-center">
          <div className="-mb-[300px] sm:-mb-[260px]">
            <PhoneFrame tilt="none" scale={0.96} priority>
              <GymListScreen />
            </PhoneFrame>
          </div>
        </Reveal>
      </Container>
    </div>
  );
}
