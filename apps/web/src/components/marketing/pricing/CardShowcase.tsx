'use client';

/**
 * Membership-card showcase — the pointer-tilting metal card on a blueprint
 * grid, with the ten selectable face designs and the partner-verification
 * story.
 *
 * This block used to sell "the member discount". Nothing in the product sets,
 * stores or applies one: there is no discount on a meal partner, no admin can
 * enter a number, and meal pricing never reads the member's tier. What IS real
 * is the counter check (POST /api/partner/verify-member → first name, tier,
 * validity), so that is what this copy promises now. If a real discount ever
 * lands, name the number here and on the mobile card from one source, never as
 * two pieces of prose.
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
    title: 'Recognised at partner restaurants',
    body: 'Show your card at any GM meal partner. Staff type your member code and see straight away that your membership is real and still running.',
  },
  {
    title: 'Only what the counter needs',
    body: 'A check shows your first name, your tier and how long your membership runs. Nothing else leaves the app.',
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
              <Eyebrow>Membership card · every member</Eyebrow>
              <Display className="mt-4">
                <span className="mkt-text-steel">One card.</span>
                <br />
                <span className="mkt-text-ember">Ten</span>{' '}
                <span className="mkt-text-steel">faces.</span>
              </Display>
              <Lead className="mt-6">
                Your membership, on your phone, with a code a partner restaurant can check
                at the counter in seconds. Pick any of ten face designs in the app and
                switch whenever you like.
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
                  <p className="mt-1 max-w-md text-[14.5px] leading-relaxed text-dim">
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
