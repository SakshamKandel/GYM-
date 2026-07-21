'use client';

/**
 * /nutrition search section (paper-2) — the food-search screen typing
 * "dal bhat" in a left-tilted iPhone drifting on parallax, copy about Nepali
 * kitchens + global brands + custom foods, sample-query light chips.
 */
import { PhoneFrame } from '../PhoneFrame';
import { Parallax, Reveal } from '../motion';
import { FoodSearchScreen } from '../screens/FoodSearchScreen';
import { CheckItem, Container, Display, Eyebrow, Lead, Section } from '../ui';

const SAMPLE_QUERIES = ['dal bhat', 'sel roti', 'chana masala', 'greek yogurt', 'protein bar'] as const;

export function NutritionSearch() {
  return (
    <Section tone="paper-2" id="search">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="order-2 flex justify-center lg:order-1 lg:justify-start lg:pl-6">
            <Parallax range={48}>
              <PhoneFrame tilt="left" scale={0.9}>
                <FoodSearchScreen />
              </PhoneFrame>
            </Parallax>
          </div>

          <div className="order-1 lg:order-2">
            <Reveal>
              <Eyebrow tone="light">02 — Search</Eyebrow>
              <Display className="mt-4">
                Your kitchen,
                <br />
                <span className="text-red-deep">indexed.</span>
              </Display>
              <Lead tone="light" className="mt-6">
                One search runs across Open Food Facts and USDA together, so dal bhat sits
                next to global brand foods with full macro data. Missing something? Create a
                custom food once — your recipe, your serving sizes, saved forever.
              </Lead>
            </Reveal>
            <Reveal delay={120}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem tone="light">One search across two databases — no tab-switching</CheckItem>
                <CheckItem tone="light">Nepali staples and global brands, side by side</CheckItem>
                <CheckItem tone="light">Custom foods for home recipes and family dishes</CheckItem>
                <CheckItem tone="light">Nutri-Score letters right in the result rows</CheckItem>
              </ul>
            </Reveal>
            <Reveal delay={200}>
              <div className="mt-9 flex flex-wrap gap-2.5">
                {SAMPLE_QUERIES.map((q) => (
                  <span
                    key={q}
                    className="mkt-card-light rounded-full px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-gravel"
                  >
                    {q}
                  </span>
                ))}
              </div>
            </Reveal>
          </div>
        </div>
      </Container>
    </Section>
  );
}
