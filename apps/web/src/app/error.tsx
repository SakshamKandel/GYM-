'use client';

import { useEffect } from 'react';
import { MarketingShell } from '@/components/customer/MarketingShell';
import styles from '@/components/customer/marketing.module.css';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Web route failed', {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return (
    <MarketingShell>
      <section className={styles.resetWrap}>
        <div className={styles.resetCard}>
          <p className={styles.eyebrow}>SOMETHING WENT WRONG</p>
          <h1>This page could not finish loading.</h1>
          <p>Your data was not changed. Try the request again, or return later if the issue continues.</p>
          <button className={styles.formButton} type="button" onClick={reset}>
            Try again
          </button>
        </div>
      </section>
    </MarketingShell>
  );
}
