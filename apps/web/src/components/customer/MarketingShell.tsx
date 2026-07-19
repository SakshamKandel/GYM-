import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './marketing.module.css';

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="GM Method home">
          <span className={styles.brandMark} aria-hidden="true">
            GM
          </span>
          <span>THE GM METHOD</span>
        </Link>
        <nav className={styles.nav} aria-label="Main navigation">
          <Link href="/#features">Features</Link>
          <Link href="/pricing">Plans</Link>
          <Link href="/contact">Support</Link>
        </nav>
        <Link className={styles.headerCta} href="/pricing">
          View plans
        </Link>
      </header>

      <main className={styles.main} id="main-content">
        {children}
      </main>

      <footer className={styles.footer}>
        <div>
          <Link className={styles.brand} href="/">
            <span className={styles.brandMark} aria-hidden="true">
              GM
            </span>
            <span>THE GM METHOD</span>
          </Link>
          <p>Train with a plan. Track what matters. Keep going.</p>
        </div>
        <div className={styles.footerLinks}>
          <Link href="/pricing">Plans</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/contact">Contact</Link>
        </div>
        <div className={styles.portalLinks}>
          <span>Team portals</span>
          <Link href="/coach/login">Coach</Link>
          <Link href="/partner/login">Partner</Link>
          <Link href="/admin/login">Admin</Link>
        </div>
      </footer>
    </div>
  );
}
