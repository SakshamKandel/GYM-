'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import styles from '@/components/customer/marketing.module.css';

interface ResetPasswordFormProps {
  token: string | null;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token || busy || complete) return;
    if (password.length < 8 || password.length > 200) {
      setError('Use between 8 and 200 characters.');
      return;
    }
    if (password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!response.ok) {
        setError(
          response.status === 400
            ? 'This reset link is invalid, expired, or has already been used.'
            : 'The password could not be changed. Please try again.',
        );
        return;
      }
      setPassword('');
      setConfirmation('');
      setComplete(true);
    } catch {
      setError('The server could not be reached. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className={styles.resetCard}>
        <p className={styles.eyebrow}>PASSWORD RESET</p>
        <h1>Link unavailable.</h1>
        <p>This reset link is missing its secure token. Request a new link from support.</p>
        <p className={styles.formError} role="alert">
          No valid reset token was found in this URL.
        </p>
        <Link className={styles.resetHomeLink} href="/contact">
          Go to support
        </Link>
      </div>
    );
  }

  if (complete) {
    return (
      <div className={styles.resetCard}>
        <p className={styles.eyebrow}>PASSWORD RESET</p>
        <h1>Password changed.</h1>
        <p className={styles.formSuccess} role="status">
          Your password is updated and all existing sessions have been signed out. Open the app
          and sign in with the new password.
        </p>
        <Link className={styles.resetHomeLink} href="/">
          Return to the GM Method
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.resetCard}>
      <p className={styles.eyebrow}>PASSWORD RESET</p>
      <h1>Choose a new password.</h1>
      <p>The secure link works once. Updating the password signs the account out everywhere.</p>
      <form className={styles.resetForm} onSubmit={(event) => void submit(event)}>
        <div className={styles.field}>
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            minLength={8}
            maxLength={200}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            required
          />
          <span className={styles.passwordHint}>At least 8 characters.</span>
        </div>
        <div className={styles.field}>
          <label htmlFor="confirm-password">Confirm new password</label>
          <input
            id="confirm-password"
            type="password"
            minLength={8}
            maxLength={200}
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={busy}
            required
          />
        </div>
        {error ? (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        ) : null}
        {busy ? (
          <p className={styles.formStatus} role="status">
            Securing the account…
          </p>
        ) : null}
        <button className={styles.formButton} type="submit" disabled={busy}>
          {busy ? 'Updating password…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}
