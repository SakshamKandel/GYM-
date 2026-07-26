import type { Metadata } from 'next';
import { ResetPasswordForm } from './ResetPasswordForm';
import styles from './reset.module.css';

export const metadata: Metadata = {
  title: 'Reset password',
  description: 'Choose a new password for your GM Method account.',
  robots: { index: false, follow: false },
};

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

/**
 * A member arrives here from a link in an email with exactly one thing to do.
 * It renders on its own plain page rather than inside the marketing shell: no
 * site nav to wander off into, no footer, and none of the marketing bundle to
 * download before the form is usable.
 */
export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const rawToken = (await searchParams).token;
  const token = typeof rawToken === 'string' && rawToken.trim() ? rawToken.trim() : null;

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <p className={styles.brand}>The GM Method</p>
        <ResetPasswordForm token={token} />
      </div>
    </main>
  );
}
