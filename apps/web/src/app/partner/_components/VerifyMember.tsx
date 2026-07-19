'use client';

import { useState } from 'react';
import { Badge, Button, Card, TextField } from '@/components/console';

interface VerifiedMember {
  name: string;
  tier: 'starter' | 'silver' | 'gold' | 'elite';
  active: boolean;
  validThru: string | null;
}

const TIER_LABEL: Record<VerifiedMember['tier'], string> = {
  starter: 'Free member',
  silver: 'Silver',
  gold: 'Gold',
  elite: 'Elite',
};

/**
 * Member-code lookup — staff type (or paste) the code from a customer's
 * /membership-card screen; a hit shows first name + tier + validity so the
 * counter can apply the member discount with confidence. Misses are a single
 * uniform "no match" line (the API is deliberately not an enumeration oracle).
 */
export function VerifyMember() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifiedMember | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/partner/verify-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: trimmed }),
      });
      if (res.status === 404) {
        setError('No member matches that code. Check the digits and try again.');
        return;
      }
      if (res.status === 429) {
        setError('Too many lookups — wait a minute and try again.');
        return;
      }
      if (!res.ok) {
        setError('Lookup failed. Try again.');
        return;
      }
      const data = (await res.json()) as { member: VerifiedMember };
      setResult(data.member);
    } catch {
      setError('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 560 }}>
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <TextField
            label="Member code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. 4BAD C400 6B76 0B21 2D0A 91C3 55E7 20F4"
            autoFocus
          />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Button type="submit" variant="primary" disabled={busy || code.trim().length === 0}>
              {busy ? 'Checking…' : 'Verify'}
            </Button>
            {result || error ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setCode('');
                  setResult(null);
                  setError(null);
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      {error ? (
        <Card>
          <p style={{ margin: 0 }}>{error}</p>
        </Card>
      ) : null}

      {result ? (
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 18 }}>{result.name}</strong>
              <Badge tone={result.active ? 'positive' : 'neutral'}>
                {TIER_LABEL[result.tier]}
              </Badge>
            </div>
            <p style={{ margin: 0 }}>
              {result.active
                ? `Active paid membership${
                    result.validThru
                      ? ` — valid through ${new Date(result.validThru).toLocaleDateString()}`
                      : ''
                  }. Apply your member discount.`
                : 'Free tier — no paid membership right now, so the member discount does not apply.'}
            </p>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
