'use client';

/**
 * Membership-card showcase — the pointer-tilting metal card on a blueprint
 * grid, with the ten selectable face designs and the partner-discount story.
 */
import { MembershipCardVisual } from '../screens/MembershipCardVisual';
import { Reveal } from '../motion';
import { ArrowLink, Container, Display, Eyebrow, Lead, Section } from '../ui';

const FACES = [
  'Brushed',
  'Guilloché',
  'Monogram',
  'Art Deco',
  'Carbon',
  'Marble',
  'Blueprint',
  'Holographic',
  'Minimal',
  'Racing',
] as const;

const PERKS = [
  {
    title: 'Discounts at partner restaurants',
    body: 'Show your card at any GM meal partner and the member discount applies to macro-counted meals across the network.',
  },
  {
    title: 'Verified in seconds',
    body: 'Partners check your member code and see only your first name, tier and validity — nothing else leaves the app.',
  },
  {
    title: 'Metal follows your tier',
    body: 'Silver, Gold and Elite each get their own metal. The Elite card is near-black with a warm-gold ink.',
  },
] as const;

export function CardShowcase() {
  return (
    <Section tone="ink" grid>
      <Container wide>
        <div className="grid items-center gap-14 lg:grid-cols-[0.95fr_1.05fr]">
          <div>
            <Reveal>
              <Eyebrow>Membership card — every paid tier</Eyebrow>
              <Display className="mt-4">
                <span className="mkt-text-steel">One card.</span>
                <br />
                <span className="mkt-text-ember">Ten</span>{' '}
                <span className="mkt-text-steel">faces.</span>
              </Display>
              <Lead className="mt-6">
                Every paid tier comes with the GM membership card — a real discount
                instrument at partner restaurants, not a loyalty gimmick. Pick any of ten
                face designs in the app and switch whenever you like.
              </Lead>
            </Reveal>

            <Reveal delay={120} className="mt-8 flex flex-wrap gap-2">
              {FACES.map((face) => (
                <span
                  key={face}
                  className="mkt-glass inline-flex h-9 items-center rounded-full px-4 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-snow"
                >
                  {face}
                </span>
              ))}
            </Reveal>

            <Reveal delay={200} className="mt-9 flex flex-col gap-5">
              {PERKS.map((perk) => (
                <div key={perk.title}>
                  <h3 className="text-[15px] font-semibold text-snow">{perk.title}</h3>
                  <p className="mt-1 max-w-md text-[14px] leading-relaxed text-dim">
                    {perk.body}
                  </p>
                </div>
              ))}
            </Reveal>

            <Reveal delay={280} className="mt-9">
              <ArrowLink href="/partners" className="text-snow">
                For restaurant partners
              </ArrowLink>
            </Reveal>
          </div>

          <Reveal delay={160} className="flex justify-center">
            <MembershipCardVisual initialTier="gold" />
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
