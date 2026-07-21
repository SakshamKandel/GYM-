import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Shell } from '@/components/marketing/Shell';
import { Reveal } from '@/components/marketing/motion';
import { ArrowLink, Container, Display, Lead, Section } from '@/components/marketing/ui';

export const metadata: Metadata = {
  title: 'Terms of service | The GM Method',
  description:
    'Terms for training, coaching, memberships, and meal services in the GM Method app.',
};

/** One numbered clause on the cream reading surface. */
function Clause({
  index,
  heading,
  children,
  first = false,
}: {
  index: string;
  heading: string;
  children: ReactNode;
  first?: boolean;
}) {
  return (
    <section className={first ? '' : 'mt-10 border-t border-cream-line pt-10'}>
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-red-deep">
        {index}
      </p>
      <h2 className="mt-3 font-display text-[24px] font-medium uppercase leading-tight text-ink sm:text-[27px]">
        {heading}
      </h2>
      <div className="mt-5 flex flex-col gap-4 text-[16px] leading-[1.8] text-cream-dim">
        {children}
      </div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <Shell>
      <Section
        tone="ink"
        pad="pt-[120px] pb-20 sm:pt-[140px] sm:pb-28"
        ambient="aurora"
        grid
      >
        <Container>
          <div className="mx-auto max-w-[720px]">
            <Reveal>
              <Display as="h1" size="lg" flavor="steel" className="mt-2">
                Terms of
                <br />
                service.
              </Display>
              <Lead className="mt-6">
                These terms apply when you create an account or use the GM Method services.
              </Lead>
              <p className="mt-7 font-mono text-[11.5px] uppercase tracking-[0.2em] text-faint">
                Last updated · 19 July 2026
              </p>
            </Reveal>

            <Reveal delay={140}>
              <article className="mt-12 rounded-block bg-cream p-7 text-ink shadow-pop sm:p-12">
                <Clause index="01" heading="Fitness and nutrition information" first>
                  <p>
                    The app provides general fitness, nutrition, and coaching information. It is not
                    medical diagnosis or treatment. Stop an activity and seek qualified medical help
                    if you experience pain, dizziness, or another concerning symptom. You are
                    responsible for choosing activity appropriate for your health and ability.
                  </p>
                </Clause>

                <Clause index="02" heading="Your account">
                  <p>
                    Keep account credentials private and provide accurate information. You may not
                    misuse another person&rsquo;s account, evade safety controls, interfere with the
                    service, or upload unlawful, abusive, or deceptive content. We may restrict
                    accounts to protect members, staff, partners, or the service.
                  </p>
                </Clause>

                <Clause index="03" heading="Memberships and billing">
                  <p>
                    Paid digital memberships renew according to the terms shown by the relevant
                    store or payment flow. Local prices, tax treatment, trial eligibility, and
                    renewal dates are displayed before confirmation. Store purchases must be managed
                    or cancelled through the store account used to purchase them unless the app
                    states otherwise.
                  </p>
                </Clause>

                <Clause index="04" heading="Coaching">
                  <p>
                    Coaching availability and response times depend on the active membership and
                    coach capacity. Coach recommendations remain general fitness guidance and do not
                    replace professional medical care.
                  </p>
                </Clause>

                <Clause index="05" heading="Meal orders">
                  <p>
                    Meal partners are responsible for preparation and fulfilment. Review
                    ingredients, dietary suitability, delivery details, price, payment method, and
                    cutoff information before ordering. Cancellation, credit, and refund eligibility
                    can depend on payment status, preparation status, cutoff time, and the reason
                    fulfilment failed.
                  </p>
                </Clause>

                <Clause index="06" heading="Acceptable content">
                  <p>
                    Do not submit content that violates another person&rsquo;s privacy or
                    intellectual property, contains harassment or threats, or attempts to manipulate
                    competitions, payments, or performance records. Content may be reviewed or
                    removed when required for safety or service integrity.
                  </p>
                </Clause>

                <Clause index="07" heading="Service availability">
                  <p>
                    We work to keep the service reliable, including offline support for core mobile
                    logs, but cannot promise uninterrupted availability. Features may evolve while
                    preserving paid access and applicable consumer rights.
                  </p>
                </Clause>

                <Clause index="08" heading="Contact and disputes">
                  <p>
                    Contact Support in the app first so the team can review the account, order, or
                    payment record. These terms do not remove consumer rights that cannot legally be
                    waived in your location.
                  </p>
                </Clause>
              </article>
            </Reveal>

            <Reveal delay={200}>
              <div className="mkt-divider mt-14" />
              <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-mono text-[11.5px] uppercase tracking-[0.2em] text-faint">
                  Keep reading
                </p>
                <div className="flex flex-wrap gap-x-8 gap-y-3">
                  <ArrowLink href="/privacy" className="text-snow">
                    Privacy policy
                  </ArrowLink>
                  <ArrowLink href="/contact" className="text-snow">
                    Get support
                  </ArrowLink>
                </div>
              </div>
            </Reveal>
          </div>
        </Container>
      </Section>
    </Shell>
  );
}
