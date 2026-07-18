'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  type Column,
  ConfirmButton,
  DataTable,
  SearchField,
  TextField,
} from '@/components/console';
import type { AwardedBadgeRow, ChallengeRow, XpCorrectionRow } from './types';

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

async function parseErrorCode(res: Response): Promise<string | null> {
  try {
    const data = (await res.json()) as { error?: unknown };
    return typeof data.error === 'string' ? data.error : null;
  } catch {
    return null;
  }
}

/**
 * Gamification oversight console (P2-17): three independent cards. Each
 * mutation hits its own guarded /api/admin/gamification/* route and then
 * router.refresh()es so the recent-activity tables reflect the live state.
 */
export function GamificationManager({
  corrections,
  badges,
  challenges,
}: {
  corrections: XpCorrectionRow[];
  badges: AwardedBadgeRow[];
  challenges: ChallengeRow[];
}) {
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <XpCorrectionCard corrections={corrections} />
      <BadgeCard badges={badges} />
      <ChallengeCard challenges={challenges} />
    </div>
  );
}

// ── XP corrections ──────────────────────────────────────────────────────

function XpCorrectionCard({ corrections }: { corrections: XpCorrectionRow[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState('');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function apply() {
    const n = Number(delta);
    if (!accountId.trim()) {
      setError('Account id is required.');
      return;
    }
    if (!Number.isInteger(n) || n === 0) {
      setError('Delta must be a non-zero whole number (negative to deduct).');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required — it is audit-logged.');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/admin/gamification/xp-corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ accountId: accountId.trim(), delta: n, reason: reason.trim() }),
      });
      if (!res.ok) {
        const code = await parseErrorCode(res);
        setError(code === 'not_found' ? 'No account with that id.' : 'Could not apply the correction.');
        setSaving(false);
        return;
      }
      const data = (await res.json()) as { xpTotal: number | null };
      setSuccess(
        data.xpTotal !== null
          ? `Applied. Account's XP total is now ${data.xpTotal}.`
          : 'Applied — the cache refresh failed but the correction is recorded.',
      );
      setAccountId('');
      setDelta('');
      setReason('');
      setSaving(false);
      router.refresh();
    } catch {
      setError('Network error.');
      setSaving(false);
    }
  }

  const columns: Column<XpCorrectionRow>[] = [
    {
      key: 'account',
      header: 'Account',
      render: (r) => (
        <span style={{ fontSize: 13 }}>{r.accountName?.trim() || r.accountEmail || r.accountId}</span>
      ),
    },
    {
      key: 'amount',
      header: 'Delta',
      width: 90,
      align: 'right',
      render: (r) => (
        <span
          className="gt-numeric"
          style={{ color: r.amount >= 0 ? 'var(--gt-success)' : 'var(--gt-danger)' }}
        >
          {r.amount >= 0 ? `+${r.amount}` : r.amount}
        </span>
      ),
    },
    {
      key: 'when',
      header: 'When',
      width: 140,
      render: (r) => (
        <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          {DATE_FMT.format(new Date(r.createdAt))}
        </span>
      ),
    },
  ];

  return (
    <Card padded={false}>
      <CardHeader title="XP correction" />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <TextField
            label="Account id"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={saving}
            style={{ flex: '2 1 220px' }}
          />
          <TextField
            label="Delta (+/-)"
            type="number"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            disabled={saving}
            style={{ flex: '1 1 100px' }}
          />
        </div>
        <TextField
          label="Reason (audit-logged)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={saving}
          maxLength={500}
        />
        <div>
          <Button variant="primary" disabled={saving} onClick={() => void apply()}>
            {saving ? 'Applying…' : 'Apply correction'}
          </Button>
        </div>
        {error ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div> : null}
        {success ? (
          <div style={{ color: 'var(--gt-success)', fontSize: 13 }}>{success}</div>
        ) : null}
      </div>
      <DataTable
        columns={columns}
        rows={corrections}
        rowKey={(r) => r.id}
        empty="No corrections applied yet."
      />
    </Card>
  );
}

// ── Badges ───────────────────────────────────────────────────────────────

function BadgeCard({ badges: initialBadges }: { badges: AwardedBadgeRow[] }) {
  const router = useRouter();
  const [badges, setBadges] = useState(initialBadges);
  const [accountId, setAccountId] = useState('');
  const [badgeId, setBadgeId] = useState('');
  const [searching, setSearching] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);

  async function search() {
    setSearching(true);
    try {
      const params = new URLSearchParams();
      if (accountId.trim()) params.set('accountId', accountId.trim());
      if (badgeId.trim()) params.set('badgeId', badgeId.trim());
      const res = await fetch(`/api/admin/gamification/badges?${params.toString()}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = (await res.json()) as { badges: AwardedBadgeRow[] };
        setBadges(data.badges);
      }
    } finally {
      setSearching(false);
    }
  }

  async function revoke(row: AwardedBadgeRow) {
    setRevoking(row.id);
    setRowError(null);
    try {
      const res = await fetch(`/api/admin/gamification/badges/${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        setRowError({ id: row.id, msg: 'Could not revoke.' });
        setRevoking(null);
        return;
      }
      setBadges((prev) => prev.filter((b) => b.id !== row.id));
      setRevoking(null);
      router.refresh();
    } catch {
      setRowError({ id: row.id, msg: 'Network error.' });
      setRevoking(null);
    }
  }

  const columns: Column<AwardedBadgeRow>[] = [
    {
      key: 'account',
      header: 'Account',
      render: (r) => <span style={{ fontSize: 13 }}>{r.accountName?.trim() || r.accountEmail}</span>,
    },
    { key: 'badge', header: 'Badge', render: (r) => r.badgeName },
    {
      key: 'status',
      header: 'Status',
      width: 100,
      render: (r) => <Badge tone={r.status === 'verified' ? 'positive' : 'neutral'}>{r.status}</Badge>,
    },
    {
      key: 'when',
      header: 'Earned',
      width: 140,
      render: (r) => (
        <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          {DATE_FMT.format(new Date(r.earnedAt))}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 140,
      align: 'right',
      render: (r) => (
        <div>
          <ConfirmButton
            label="Revoke"
            confirmLabel="Confirm?"
            size="sm"
            busy={revoking === r.id}
            onConfirm={() => void revoke(r)}
          />
          {rowError?.id === r.id ? (
            <div style={{ color: 'var(--gt-danger)', fontSize: 11, marginTop: 4 }}>
              {rowError.msg}
            </div>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <Card padded={false}>
      <CardHeader title="Awarded badges" />
      <div style={{ padding: 18, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <SearchField
          placeholder="Account id…"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          style={{ flex: '1 1 220px' }}
        />
        <SearchField
          placeholder="Badge id (e.g. bench_100)…"
          value={badgeId}
          onChange={(e) => setBadgeId(e.target.value)}
          style={{ flex: '1 1 220px' }}
        />
        <Button variant="ghost" disabled={searching} onClick={() => void search()}>
          {searching ? 'Searching…' : 'Search'}
        </Button>
      </div>
      <DataTable columns={columns} rows={badges} rowKey={(r) => r.id} empty="No badges match." />
    </Card>
  );
}

// ── Challenges ───────────────────────────────────────────────────────────

function ChallengeCard({ challenges: initial }: { challenges: ChallengeRow[] }) {
  const router = useRouter();
  const [challenges, setChallenges] = useState(initial);
  const [removing, setRemoving] = useState<string | null>(null);

  async function remove(row: ChallengeRow) {
    setRemoving(row.id);
    try {
      const res = await fetch(`/api/admin/gamification/challenges/${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setChallenges((prev) => prev.filter((c) => c.id !== row.id));
        router.refresh();
      }
      setRemoving(null);
    } catch {
      setRemoving(null);
    }
  }

  const columns: Column<ChallengeRow>[] = [
    { key: 'title', header: 'Title', render: (r) => <span style={{ fontWeight: 600 }}>{r.title}</span> },
    {
      key: 'coach',
      header: 'Coach',
      render: (r) => <span style={{ fontSize: 13 }}>{r.coachName?.trim() || r.coachEmail}</span>,
    },
    { key: 'month', header: 'Month', width: 90, render: (r) => r.monthKey },
    { key: 'target', header: 'Target days', width: 100, align: 'right', render: (r) => r.targetDays },
    { key: 'members', header: 'Members', width: 90, align: 'right', render: (r) => r.memberCount },
    {
      key: 'actions',
      header: '',
      width: 120,
      align: 'right',
      render: (r) => (
        <ConfirmButton
          label="Remove"
          confirmLabel="Confirm?"
          size="sm"
          busy={removing === r.id}
          onConfirm={() => void remove(r)}
        />
      ),
    },
  ];

  return (
    <Card padded={false}>
      <CardHeader title="Coach challenges" />
      <DataTable columns={columns} rows={challenges} rowKey={(r) => r.id} empty="No challenges yet." />
    </Card>
  );
}
