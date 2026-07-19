'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import styles from './staffLogin.module.css';

interface StaffLoginProps {
  portal: 'Admin' | 'Coach' | 'Partner';
  destination: '/admin' | '/coach' | '/partner';
  description: string;
  unauthorizedMessage: string;
}

/** Shared, accessible staff sign-in with role-specific routing and copy. */
export function StaffLogin({
  portal,
  destination,
  description,
  unauthorizedMessage,
}: StaffLoginProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/staff/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!response.ok) {
        setError(response.status === 401 ? unauthorizedMessage : 'Sign-in is temporarily unavailable.');
        return;
      }
      router.replace(destination);
      router.refresh();
    } catch {
      setError('Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.intro} aria-labelledby="portal-title">
        <Link className={styles.brand} href="/" aria-label="The GM Method home">
          <span aria-hidden="true">GM</span>
          THE GM METHOD
        </Link>
        <div>
          <p className={styles.kicker}>PROTECTED WORKSPACE · {portal.toUpperCase()}</p>
          <h1 id="portal-title">The work stays clear when the access is clear.</h1>
          <p>{description}</p>
        </div>
        <p className={styles.securityNote}>
          Staff access is permission-scoped and every sensitive action is audited.
        </p>
      </section>

      <section className={styles.formPanel} aria-label={`${portal} sign in`}>
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.portalPill}>{portal} portal</span>
            <h2>Welcome back</h2>
            <p>Use the staff account assigned to this workspace.</p>
          </div>
          <form className={styles.form} onSubmit={onSubmit} aria-busy={busy}>
            <label>
              <span>Email address</span>
              <input
                className="gt-input"
                type="email"
                inputMode="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
                required
              />
            </label>
            <label>
              <span>Password</span>
              <input
                className="gt-input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
                required
              />
            </label>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
            <button className="gt-btn-primary" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in securely'}
            </button>
          </form>
          <div className={styles.helpRow}>
            <Link href="/contact">Need account help?</Link>
            <Link href="/">Return to website</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
