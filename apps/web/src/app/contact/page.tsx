import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingShell } from '@/components/customer/MarketingShell';
import styles from '@/components/customer/marketing.module.css';

export const metadata: Metadata = {
  title: 'Support | The GM Method',
  description: 'Get member, coach, or meal-partner help for the GM Method.',
};

export default function ContactPage() {
  return (
    <MarketingShell>
      <section className={styles.legalHero}>
        <p className={styles.eyebrow}>SUPPORT</p>
        <h1>Get to the right team.</h1>
        <p>Choose the support path that keeps your account and order context attached.</p>
      </section>
      <section className={styles.contactGrid}>
        <article className={styles.contactCard}>
          <span className={styles.featureIndex}>01</span>
          <h2>Members</h2>
          <p>Open Support in the mobile app for account, coaching, billing, or meal-order help.</p>
          <Link href="/privacy">Review privacy controls</Link>
        </article>
        <article className={styles.contactCard}>
          <span className={styles.featureIndex}>02</span>
          <h2>Meal partners</h2>
          <p>Sign in to manage live orders, menu availability, subscriptions, and support.</p>
          <Link href="/partner/login">Open partner portal</Link>
        </article>
        <article className={styles.contactCard}>
          <span className={styles.featureIndex}>03</span>
          <h2>Coaches</h2>
          <p>Use the coach console for assigned members, reviews, messages, and account help.</p>
          <Link href="/coach/login">Open coach console</Link>
        </article>
      </section>
    </MarketingShell>
  );
}
