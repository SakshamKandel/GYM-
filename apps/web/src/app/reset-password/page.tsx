import type { Metadata } from 'next';
import { MarketingShell } from '@/components/customer/MarketingShell';
import styles from '@/components/customer/marketing.module.css';
import { ResetPasswordForm } from './ResetPasswordForm';

export const metadata: Metadata = {
  title: 'Reset password | The GM Method',
  description: 'Choose a new password for your GM Method account.',
  robots: { index: false, follow: false },
};

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const rawToken = (await searchParams).token;
  const token = typeof rawToken === 'string' && rawToken.trim() ? rawToken.trim() : null;

  return (
    <MarketingShell>
      <section className={styles.resetWrap}>
        <ResetPasswordForm token={token} />
      </section>
    </MarketingShell>
  );
}
