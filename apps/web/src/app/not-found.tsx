import Link from 'next/link';
import { MarketingShell } from '@/components/customer/MarketingShell';
import styles from '@/components/customer/marketing.module.css';

export default function NotFound() {
  return (
    <MarketingShell>
      <section className={styles.resetWrap}>
        <div className={styles.resetCard}>
          <p className={styles.eyebrow}>404 · PAGE NOT FOUND</p>
          <h1>That route is not part of the plan.</h1>
          <p>The link may be outdated, or the page may only be available inside the app.</p>
          <Link className={styles.primaryLink} href="/">
            Return home
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
