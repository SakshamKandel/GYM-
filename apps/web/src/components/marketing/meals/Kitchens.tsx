'use client';

/**
 * Partner kitchens — photo block + vetting copy. The only photography on the
 * page; sits after the red band as a calm coal breather.
 */
import { Reveal } from '../motion';
import { ArrowLink, CheckItem, Container, Display, Eyebrow, Lead, PhotoBlock, Section } from '../ui';

export function Kitchens() {
  return (
    <Section tone="coal">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-[0.95fr_1.05fr]">
          <Reveal className="flex justify-center lg:justify-start">
            <PhotoBlock
              src="/stock/food-bowl.jpg"
              alt="A macro-counted meal bowl from a GM Meals partner kitchen"
              caption="Partner kitchen · Kathmandu valley"
              className="aspect-[4/5] w-full max-w-[520px]"
            />
          </Reveal>

          <div>
            <Reveal>
              <Eyebrow>The kitchens</Eyebrow>
              <Display className="mt-4">
                <span className="mkt-text-steel">Not every kitchen</span>
                <br />
                <span className="mkt-text-steel">gets in.</span>
              </Display>
              <Lead className="mt-6">
                GM Meals is a short list of vetted partners, not an open marketplace. Every
                kitchen is onboarded by the GM team, every dish ships with its recipe&rsquo;s
                kcal and macros, and every order runs through the same live tracker.
              </Lead>
            </Reveal>
            <Reveal delay={120}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem>Vetted and onboarded by the GM team, kitchen by kitchen</CheckItem>
                <CheckItem>Every dish is macro-counted before it reaches the menu</CheckItem>
                <CheckItem>
                  Kitchens run orders on their own partner portal — accept, prepare, hand off
                </CheckItem>
                <CheckItem>Delivery areas and cutoffs set to what each kitchen can serve</CheckItem>
              </ul>
            </Reveal>
            <Reveal delay={200}>
              <ArrowLink href="/partners" className="mt-8 text-red">
                Run a kitchen? Become a partner
              </ArrowLink>
            </Reveal>
          </div>
        </div>
      </Container>
    </Section>
  );
}
