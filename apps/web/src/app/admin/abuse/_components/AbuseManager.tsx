'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, CardHeader, type Column, DataTable, TextField } from '@/components/console';
import type { AbuseDashboard } from './types';

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const TRIAL_TIERS = ['silver', 'gold', 'elite'] as const;

export function AbuseManager({ dashboard }: { dashboard: AbuseDashboard }) {
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <TrialResetCard />

      <Card padded={false}>
        <CardHeader title="Top referrers" />
        <DataTable
          columns={
            [
              {
                key: 'who',
                header: 'Referrer',
                render: (r) => <span style={{ fontSize: 13 }}>{r.displayName?.trim() || r.email}</span>,
              },
              {
                key: 'total',
                header: 'Total invites',
                width: 110,
                align: 'right',
                render: (r) => r.totalCount,
              },
              {
                key: 'rewarded',
                header: 'Rewarded',
                width: 100,
                align: 'right',
                render: (r) => r.rewardedCount,
              },
            ] satisfies Column<AbuseDashboard['referrals']['topReferrers'][number]>[]
          }
          rows={dashboard.referrals.topReferrers}
          rowKey={(r) => r.referrerId}
          empty="No referrals yet."
        />
      </Card>

      <Card padded={false}>
        <CardHeader
          title="Multi-tier trial accounts"
          action={
            <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
              Accounts that have trialed more than one tier
            </span>
          }
        />
        <DataTable
          columns={
            [
              {
                key: 'who',
                header: 'Account',
                render: (r) => <span style={{ fontSize: 13 }}>{r.displayName?.trim() || r.email}</span>,
              },
              {
                key: 'tiers',
                header: 'Tiers trialed',
                render: (r) => (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {r.tiersTrialed.map((t) => (
                      <Badge key={t} tone="warning">
                        {t}
                      </Badge>
                    ))}
                  </div>
                ),
              },
            ] satisfies Column<AbuseDashboard['trials']['multiTrialAccounts'][number]>[]
          }
          rows={dashboard.trials.multiTrialAccounts}
          rowKey={(r) => r.accountId}
          empty="No account has trialed more than one tier."
        />
      </Card>

      <Card padded={false}>
        <CardHeader title="Recent trial starts" />
        <DataTable
          columns={
            [
              {
                key: 'who',
                header: 'Account',
                render: (r) => <span style={{ fontSize: 13 }}>{r.displayName?.trim() || r.email}</span>,
              },
              { key: 'tier', header: 'Tier', width: 90, render: (r) => <Badge tone="info">{r.tier}</Badge> },
              {
                key: 'started',
                header: 'Started',
                width: 110,
                render: (r) => (
                  <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                    {DATE_FMT.format(new Date(r.startedAt))}
                  </span>
                ),
              },
              {
                key: 'expires',
                header: 'Expires',
                width: 110,
                render: (r) => (
                  <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                    {DATE_FMT.format(new Date(r.expiresAt))}
                  </span>
                ),
              },
            ] satisfies Column<AbuseDashboard['trials']['recentTrials'][number]>[]
          }
          rows={dashboard.trials.recentTrials}
          rowKey={(r) => `${r.accountId}-${r.tier}`}
          empty="No trials started yet."
        />
      </Card>
    </div>
  );
}

function TrialResetCard() {
  const router = useRouter();
  const [accountId, setAccountId] = useState('');
  const [tier, setTier] = useState<'' | (typeof TRIAL_TIERS)[number]>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function reset() {
    if (!accountId.trim()) {
      setError('Account id is required.');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/admin/abuse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ accountId: accountId.trim(), tier: tier || undefined }),
      });
      if (!res.ok) {
        setError(res.status === 404 ? 'No account with that id.' : 'Could not reset trial usage.');
        setSaving(false);
        return;
      }
      const data = (await res.json()) as { reset: string[] };
      setSuccess(
        data.reset.length > 0
          ? `Cleared trial history for: ${data.reset.join(', ')}.`
          : 'That account had no trial history to clear.',
      );
      setAccountId('');
      setTier('');
      setSaving(false);
      router.refresh();
    } catch {
      setError('Network error.');
      setSaving(false);
    }
  }

  return (
    <Card padded={false}>
      <CardHeader title="Reset trial usage" />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--gt-text-dim)' }}>
          Clears the account's trial-usage record so it can start a fresh trial. Leave tier blank to
          clear every tier for the account.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <TextField
            label="Account id"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={saving}
            style={{ flex: '2 1 220px' }}
          />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 140px' }}>
            <span style={{ fontSize: 12, color: 'var(--gt-text-dim)', textTransform: 'uppercase' }}>
              Tier (optional)
            </span>
            <select
              className="gt-input"
              value={tier}
              onChange={(e) => setTier(e.target.value as typeof tier)}
              disabled={saving}
            >
              <option value="">All tiers</option>
              {TRIAL_TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <Button variant="primary" disabled={saving} onClick={() => void reset()}>
            {saving ? 'Resetting…' : 'Reset'}
          </Button>
        </div>
        {error ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div> : null}
        {success ? (
          <div style={{ color: 'var(--gt-success)', fontSize: 13 }}>{success}</div>
        ) : null}
      </div>
    </Card>
  );
}
