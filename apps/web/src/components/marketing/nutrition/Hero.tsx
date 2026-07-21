'use client';

/**
 * /nutrition hero v3 — dark cinematic opener: ember aurora over near-black,
 * blueprint grid, word-by-word headline reveal, magnetic CTAs, and the
 * barcode scanner floating in red light.
 */
import { PhoneFrame } from '../PhoneFrame';
import { Float, Magnetic, Reveal, WordStagger } from '../motion';
import { BarcodeScanScreen } from '../screens/BarcodeScanScreen';
import { Container, Lead, PillLink } from '../ui';

export function NutritionHero() {
  return (
    <div className="mkt-noise mkt-aurora relative overflow-hidden bg-ink pb-20 pt-[128px] sm:pb-24 sm:pt-[150px]">
      <div aria-hidden className="mkt-gridlines absolute inset-0" />

      <Container wide className="relative z-10">
        <div className="grid items-center gap-16 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <h1 className="mt-2 font-display text-[15vw] font-medium uppercase leading-[0.92] sm:text-7xl md:text-8xl">
              <WordStagger text="Macros" className="mkt-text-steel block" />
              <WordStagger text="without" className="mkt-text-steel block" />
              <WordStagger text="the math." className="mkt-text-ember block" />
            </h1>

            <Reveal delay={700}>
              <Lead tone="dark" className="mt-7">
                Scan a barcode, search dal bhat, or log your own recipe. The GM Method counts
                kcal and macros against targets computed for your body — instantly, even with zero signal.
              </Lead>
            </Reveal>

            <Reveal delay={820} className="mt-9 flex flex-wrap items-center gap-4">
              <Magnetic>
                <PillLink href="/download">Get the app</PillLink>
              </Magnetic>
              <Magnetic strength={0.22}>
                <PillLink href="/pricing" variant="ghost">
                  See pricing
                </PillLink>
              </Magnetic>
            </Reveal>

            <Reveal delay={920}>
              <p className="mt-8 font-mono text-[11.5px] uppercase tracking-[0.2em] text-faint">
                Open Food Facts · USDA · Works offline
              </p>
            </Reveal>
          </div>

          <Reveal delay={420} y={40} className="flex justify-center lg:justify-end lg:pr-8">
            <Float amplitude={10} duration={7}>
              <PhoneFrame tilt="right" scale={0.92} priority>
                <BarcodeScanScreen />
              </PhoneFrame>
            </Float>
          </Reveal>
        </div>
      </Container>
    </div>
  );
}
