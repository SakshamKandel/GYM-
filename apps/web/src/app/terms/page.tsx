import type { Metadata } from 'next';
import { MarketingShell } from '@/components/customer/MarketingShell';
import styles from '@/components/customer/marketing.module.css';

export const metadata: Metadata = {
  title: 'Terms of service | The GM Method',
  description: 'Terms for training, coaching, memberships, and meal services in the GM Method app.',
};

export default function TermsPage() {
  return (
    <MarketingShell>
      <article>
        <header className={styles.legalHero}>
          <p className={styles.eyebrow}>LAST UPDATED · 19 JULY 2026</p>
          <h1>Terms of service.</h1>
          <p>These terms apply when you create an account or use the GM Method services.</p>
        </header>
        <div className={styles.prose}>
          <h2>Fitness and nutrition information</h2>
          <p>
            The app provides general fitness, nutrition, and coaching information. It is not
            medical diagnosis or treatment. Stop an activity and seek qualified medical help if
            you experience pain, dizziness, or another concerning symptom. You are responsible
            for choosing activity appropriate for your health and ability.
          </p>

          <h2>Your account</h2>
          <p>
            Keep account credentials private and provide accurate information. You may not misuse
            another person’s account, evade safety controls, interfere with the service, or upload
            unlawful, abusive, or deceptive content. We may restrict accounts to protect members,
            staff, partners, or the service.
          </p>

          <h2>Memberships and billing</h2>
          <p>
            Paid digital memberships renew according to the terms shown by the relevant store or
            payment flow. Local prices, tax treatment, trial eligibility, and renewal dates are
            displayed before confirmation. Store purchases must be managed or cancelled through
            the store account used to purchase them unless the app states otherwise.
          </p>

          <h2>Coaching</h2>
          <p>
            Coaching availability and response times depend on the active membership and coach
            capacity. Coach recommendations remain general fitness guidance and do not replace
            professional medical care.
          </p>

          <h2>Meal orders</h2>
          <p>
            Meal partners are responsible for preparation and fulfilment. Review ingredients,
            dietary suitability, delivery details, price, payment method, and cutoff information
            before ordering. Cancellation, credit, and refund eligibility can depend on payment
            status, preparation status, cutoff time, and the reason fulfilment failed.
          </p>

          <h2>Acceptable content</h2>
          <p>
            Do not submit content that violates another person’s privacy or intellectual property,
            contains harassment or threats, or attempts to manipulate competitions, payments, or
            performance records. Content may be reviewed or removed when required for safety or
            service integrity.
          </p>

          <h2>Service availability</h2>
          <p>
            We work to keep the service reliable, including offline support for core mobile logs,
            but cannot promise uninterrupted availability. Features may evolve while preserving
            paid access and applicable consumer rights.
          </p>

          <h2>Contact and disputes</h2>
          <p>
            Contact Support in the app first so the team can review the account, order, or payment
            record. These terms do not remove consumer rights that cannot legally be waived in your
            location.
          </p>
        </div>
      </article>
    </MarketingShell>
  );
}
