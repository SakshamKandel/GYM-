import type { Metadata } from 'next';
import { GM_TIERS } from '@gym/shared';
import { MarketingShell } from '@/components/customer/MarketingShell';
import styles from '@/components/customer/marketing.module.css';

export const metadata: Metadata = {
  title: 'Membership plans | The GM Method',
  description: 'Compare Starter, Silver, Gold, and Elite GM Method memberships.',
};

export default function PricingPage() {
  return (
    <MarketingShell>
      <section className={styles.legalHero}>
        <p className={styles.eyebrow}>MEMBERSHIP</p>
        <h1>Choose the support you need now.</h1>
        <p>
          Start free, then move up when you want deeper tracking, adaptive programming, or
          hands-on coaching. Paid prices are regional and the current local price is always shown
          before purchase in the app.
        </p>
      </section>
      <section className={styles.priceGrid} aria-label="Membership plan comparison">
        {GM_TIERS.map((plan) => (
          <article
            className={`${styles.priceCard} ${plan.tier === 'gold' ? styles.priceCardFeatured : ''}`}
            key={plan.tier}
          >
            <div className={styles.priceHeader}>
              <span>{plan.tier === 'gold' ? 'Most adaptive' : 'GM membership'}</span>
              <h2>{plan.name}</h2>
              <p>{plan.tagline}</p>
            </div>
            <p className={styles.priceLabel}>
              {plan.tier === 'starter' ? 'Free forever' : 'See regional price in app'}
            </p>
            <ul className={styles.featureList}>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <a className={styles.priceAction} href="/#download">
              {plan.tier === 'starter' ? 'Start with Starter' : `Choose ${plan.name}`}
            </a>
          </article>
        ))}
      </section>
    </MarketingShell>
  );
}
