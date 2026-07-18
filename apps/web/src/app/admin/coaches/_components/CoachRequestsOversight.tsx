'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Card,
  ConfirmButton,
  type Column,
  DataTable,
  SkeletonRows,
} from '@/components/console';

/**
 * Admin oversight of member-initiated coach_requests (ADMIN-MASTER-PLAN §3
 * P1-8) — a cross-coach queue with cancel + stale auto-expiry, ADDED below the
 * existing coach roster on this page. Self-contained: fetches its own data from
 * GET /api/admin/oversight/coach-requests on mount rather than riding the
 * page's server-loaded props, because the auto-expiry sweep this feature
 * depends on is enforced INSIDE that route handler on every read — a
 * server-component direct-DB read here would bypass the sweep entirely.
 *
 * Only rendered when the caller holds 'moderation.manage' (checked by the
 * parent page before mounting this component).
 */

interface OversightRequest {
  id: string;
  status: 'pending' | 'accepted' | 'declined' | 'canceled';
  message: string;
  createdAt: string;
  decidedAt: string | null;
  ageDays: number;
  member: { id: string; email: string; displayName: string };
  coach: { id: string; email: string; displayName: string };
}

export function CoachRequestsOversight() {
  const [requests, setRequests] = useState<OversightRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/oversight/coach-requests?status=pending');
      if (!res.ok) {
        setError("Couldn't load pending coach requests.");
        return;
      }
      const data = (await res.json()) as { requests: OversightRequest[] };
      setRequests(data.requests);
    } catch {
      setError('Network error.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(row: OversightRequest) {
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/oversight/coach-requests/${encodeURIComponent(row.id)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'admin_cancel' }),
        },
      );
      if (!res.ok) {
        setError(
          res.status === 404
            ? 'Already decided — refreshing.'
            : "Couldn't cancel that request.",
        );
        await load();
        return;
      }
      setRequests((prev) => (prev ? prev.filter((r) => r.id !== row.id) : prev));
    } catch {
      setError('Network error.');
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<OversightRequest>[] = [
    {
      key: 'member',
      header: 'Member',
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {r.member.displayName || r.member.email}
          </div>
          <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{r.member.email}</div>
        </div>
      ),
    },
    {
      key: 'coach',
      header: 'Coach',
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {r.coach.displayName || r.coach.email}
          </div>
          <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{r.coach.email}</div>
        </div>
      ),
    },
    {
      key: 'message',
      header: 'Message',
      render: (r) => (
        <span
          style={{
            display: 'block',
            maxWidth: 260,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: r.message ? 'var(--gt-text)' : 'var(--gt-text-dim)',
            fontSize: 13,
          }}
          title={r.message || undefined}
        >
          {r.message || '—'}
        </span>
      ),
    },
    {
      key: 'age',
      header: 'Age',
      width: 130,
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="gt-numeric" style={{ fontSize: 13 }}>
            {r.ageDays === 0 ? 'Today' : `${r.ageDays}d`}
          </span>
          {r.ageDays >= 10 ? <Badge tone="warning">stale soon</Badge> : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 110,
      align: 'right',
      render: (r) => (
        <ConfirmButton
          label="Cancel"
          confirmLabel="Confirm"
          busyLabel="Canceling…"
          size="sm"
          busy={busyId === r.id}
          onConfirm={() => void cancel(r)}
        />
      ),
    },
  ];

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ marginBottom: 12 }}>
        <h2
          style={{
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            fontSize: 16,
            marginBottom: 4,
          }}
        >
          Pending coach requests
        </h2>
        <p style={{ margin: 0, color: 'var(--gt-text-dim)', fontSize: 13, maxWidth: '60ch' }}>
          Member-initiated requests awaiting a coach&apos;s decision. Requests older than
          14 days auto-expire the next time this list loads.
        </p>
      </div>
      {error ? (
        <Card style={{ marginBottom: 12, borderColor: 'color-mix(in srgb, var(--gt-danger) 35%, transparent)' }}>
          <span style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</span>
        </Card>
      ) : null}
      {requests === null ? (
        <SkeletonRows rows={3} cols={4} />
      ) : (
        <DataTable
          columns={columns}
          rows={requests}
          rowKey={(r) => r.id}
          empty="No pending coach requests."
        />
      )}
    </div>
  );
}
