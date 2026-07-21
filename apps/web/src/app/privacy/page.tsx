import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Shell } from '@/components/marketing/Shell';
import { Reveal } from '@/components/marketing/motion';
import { ArrowLink, Container, Display, Lead, Section } from '@/components/marketing/ui';

export const metadata: Metadata = {
  title: 'Privacy policy | The GM Method',
  description:
    'How the GM Method fitness app handles account, health, coaching, and payment data — in plain language.',
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

export default function PrivacyPage() {
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
                Privacy, in
                <br />
                plain language.
              </Display>
              <Lead className="mt-6">
                Fitness data is personal. This policy explains what the GM Method uses, why it is
                needed, and the controls available to you.
              </Lead>
              <p className="mt-7 font-mono text-[11.5px] uppercase tracking-[0.2em] text-faint">
                Last updated · 19 July 2026
              </p>
            </Reveal>

            <Reveal delay={140}>
              <article className="mt-12 rounded-block bg-cream p-7 text-ink shadow-pop sm:p-12">
                <Clause index="01" heading="Information you provide" first>
                  <p>
                    We process account details, onboarding answers, workout and nutrition logs,
                    body measurements, progress photos, support messages, coaching interactions,
                    delivery addresses, and meal-order details when you choose to use those
                    features.
                  </p>
                </Clause>

                <Clause index="02" heading="How information is used">
                  <p>
                    We use this information to operate your account, calculate targets and trends,
                    sync your activity, provide coaching, fulfil meal orders, prevent abuse, answer
                    support requests, and maintain the safety and reliability of the service. We do
                    not sell health or workout data.
                  </p>
                </Clause>

                <Clause index="03" heading="Local and cloud storage">
                  <p>
                    The mobile app stores logs locally so core tracking continues without a
                    connection. Account and synced service data is stored in our hosted PostgreSQL
                    database. Images and receipts may be stored with our image-delivery provider
                    and are accessed through controlled URLs. Store subscription status may be
                    processed by Apple, Google, and RevenueCat; their own privacy terms also apply.
                  </p>
                </Clause>

                <Clause index="04" heading="Coaches, buddies, and meal partners">
                  <p>
                    Assigned coaches see only the member information needed for the coaching
                    features available to them. Buddy features do not expose weight, photos, or
                    nutrition unless a sharing control says otherwise. Meal partners receive the
                    order and delivery details required to fulfil an order, not your private fitness
                    history.
                  </p>
                </Clause>

                <Clause index="05" heading="Your controls">
                  <ul className="flex flex-col gap-3">
                    {[
                      'Update profile and privacy preferences in Settings.',
                      'Remove individual logs or photos where the feature provides deletion.',
                      'Export recent health and training logs from Settings.',
                      'Use Support to request a broader account-data copy.',
                      'Use Delete account in Settings to begin account deletion.',
                      'Sign out of all active sessions from the security settings.',
                    ].map((item) => (
                      <li key={item} className="flex items-start gap-3">
                        <span
                          aria-hidden
                          className="mt-[11px] size-1.5 shrink-0 rounded-full bg-red-deep"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </Clause>

                <Clause index="06" heading="Retention and deletion">
                  <p>
                    Data is kept only for as long as needed to provide the service, meet legal and
                    payment record obligations, resolve disputes, prevent fraud, and protect users.
                    When an account is deleted, personal data is deleted or anonymized as
                    appropriate; limited transaction and audit records may be retained when the law
                    or financial reconciliation requires it.
                  </p>
                </Clause>

                <Clause index="07" heading="Security">
                  <p>
                    We use scoped access controls, validated API payloads, session controls, and
                    protected credential storage. No system is risk-free. If you believe your
                    account is at risk, sign out all sessions and contact support through the app.
                  </p>
                </Clause>

                <Clause index="08" heading="Questions">
                  <p>
                    Open <strong className="font-semibold text-ink">Support</strong> in the app for
                    privacy questions or requests. Staff, coaches, and meal partners can use the
                    support channel in their signed-in portal.
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
                  <ArrowLink href="/terms" className="text-snow">
                    Terms of service
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
