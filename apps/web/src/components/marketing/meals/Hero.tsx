'use client';

/**
 * /meals hero v3 — split with the device on the LEFT (variation on Home's
 * right-side phone): ember aurora over near-black, blueprint grid, masked
 * word-by-word headline, magnetic CTAs, the partner-kitchen menu screen
 * floating in red light, and a product-truth proof band below.
 */
import { PhoneFrame } from '../PhoneFrame';
import { Float, Magnetic, Reveal, WordStagger } from '../motion';
import { MenuBrowseScreen } from '../screens/MenuBrowseScreen';
import { Container, Lead, PillLink, StatBig } from '../ui';

const PROOF = [
  { value: '7', caption: 'order states, tracked live' },
  { value: '05:45', caption: 'cutoffs on Kathmandu time' },
  { value: '2', caption: 'ways to pay — COD or digital' },
  { value: '0', caption: 'meals logged by hand' },
] as const;

export function MealsHero() {
  return (
    <div className="mkt-noise mkt-aurora relative overflow-hidden bg-ink pt-[120px] sm:pt-[140px]">
      <div aria-hidden className="mkt-gridlines absolute inset-0" />

      <Container wide className="relative z-10">
        <div className="grid items-center gap-16 lg:grid-cols-[0.96fr_1.04fr]">
          <Reveal
            delay={300}
            y={40}
            className="order-2 flex justify-center lg:order-1 lg:justify-start lg:pl-8"
          >
            <Float amplitude={10} duration={7}>
              <PhoneFrame tilt="left" scale={0.94} priority>
                <MenuBrowseScreen />
              </PhoneFrame>
            </Float>
          </Reveal>

          <div className="order-1 lg:order-2">

            <h1 className="mt-6 font-display text-[15vw] font-medium uppercase leading-[0.92] sm:text-7xl md:text-8xl">
              <WordStagger text="Kitchen-cooked." className="mkt-text-steel block" delay={120} />
              <WordStagger text="Macro-counted." className="mkt-text-steel block" delay={320} />
              <WordStagger text="Delivered." className="mkt-text-ember block" delay={520} />
            </h1>

            <Reveal delay={700}>
              <Lead tone="dark" className="mt-7">
                Vetted partner kitchens across Kathmandu valley cook meals with the macros
                already counted. Order once or subscribe for the week — the app tracks every
                order live and writes the calories into your Food diary for you.
              </Lead>
            </Reveal>

            <Reveal delay={820} className="mt-9 flex flex-wrap items-center gap-4">
              <Magnetic>
                <PillLink href="/download">Get the app</PillLink>
              </Magnetic>
              <Magnetic strength={0.22}>
                <PillLink href="/pricing" variant="ghost">
                  See member pricing
                </PillLink>
              </Magnetic>
            </Reveal>

            <Reveal delay={920}>
              <p className="mt-8 font-mono text-[11.5px] uppercase tracking-[0.2em] text-faint">
                Cash on delivery · eSewa · Khalti
              </p>
            </Reveal>
          </div>
        </div>

        {/* Proof band */}
        <div className="mkt-divider mt-24" />
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 py-14 md:grid-cols-4">
          {PROOF.map((s, i) => (
            <Reveal key={s.caption} delay={i * 90}>
              <StatBig value={s.value} caption={s.caption} />
            </Reveal>
          ))}
        </div>
      </Container>
    </div>
  );
}
