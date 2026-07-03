'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

/**
 * Admin console login. Posts to /api/staff/login (shared with the coach
 * console), which verifies credentials, requires an admins row, mints a session
 * and sets the httpOnly 'gt_staff' cookie. On success we hard-navigate to
 * /admin so the server layout guard re-runs with the new cookie. The layout
 * guard is what enforces which staff roles may actually enter — a coach who
 * logs in here still gets redirected back to /admin/login.
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/staff/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        setError(
          res.status === 401
            ? 'Invalid credentials or not a staff account.'
            : 'Something went wrong.',
        );
        setBusy(false);
        return;
      }
      router.replace('/admin');
      router.refresh();
    } catch {
      setError('Network error.');
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div className="gt-card" style={{ width: '100%', maxWidth: 380, padding: 28 }}>
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>Admin Console</h1>
        <p style={{ color: 'var(--gt-text-dim)', fontSize: 14, marginTop: 0, marginBottom: 22 }}>
          Sign in with your staff account.
        </p>
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>Email</span>
            <input
              className="gt-input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>Password</span>
            <input
              className="gt-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error ? <div style={{ color: 'var(--gt-red)', fontSize: 13 }}>{error}</div> : null}
          <button type="submit" className="gt-btn-primary" disabled={busy} style={{ marginTop: 4 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
