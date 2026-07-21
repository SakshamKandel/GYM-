/**
 * /partners value band — the hungry-audience story on ink with blueprint
 * gridlines. Product-truth numerals only (no invented revenue).
 */
import { Reveal } from '../motion';
import { ArrowLink, Container, Display, Eyebrow, Lead, Section, StatBig } from '../ui';

const STATS = [
  { value: '7', caption: 'order states, live on your board' },
  { value: '2', caption: 'ways to order — one-off + weekly subs' },
  { value: '0', caption: 'member profiles shared with kitchens' },
] as const;

export function PartnersValue() {
  return (
    <Section tone="ink" grid>
      <Container>
        <div className="max-w-3xl">
          <Reveal>
            <Eyebrow>Why partner</Eyebrow>
          </Reveal>
          <Reveal delay={80}>
            <Display size="lg" flavor="steel" className="mt-4">
              Members who order
              <br />
              with <span className="mkt-text-ember">intent.</span>
            </Display>
          </Reveal>
          <Reveal delay={160}>
            <Lead className="mt-6">
              GM members track macros every day, and the Meals tab is where targets turn into
              orders — macro-labeled dishes from partner kitchens, batched on prep cutoffs,
              one-off or as a weekly subscription. When your menu fits their numbers, ordering
              from you isn&rsquo;t a cheat day. It&rsquo;s the plan.
            </Lead>
          </Reveal>
          <Reveal delay={240}>
            <ArrowLink href="/meals" className="mt-7 text-snow">
              See the member side of GM Meals
            </ArrowLink>
          </Reveal>
        </div>

        <div className="mkt-divider mt-16" />
        <div className="grid grid-cols-1 gap-x-8 gap-y-12 pt-14 sm:grid-cols-3">
          {STATS.map((s, i) => (
            <Reveal key={s.caption} delay={i * 100}>
              <StatBig value={s.value} caption={s.caption} />
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
