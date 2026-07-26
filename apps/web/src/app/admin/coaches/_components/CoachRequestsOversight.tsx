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
      setError('Could not reach us just now. Try again.');
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
            ? 'Already decided. Refreshing.'
            : "Couldn't cancel that request.",
        );
        await load();
        return;
      }
      setRequests((prev) => (prev ? prev.filter((r) => r.id !== row.id) : prev));
    } catch {
      setError('Could not reach us just now. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<OversightRequest>[] = [
    {
      key: 'member',
      header: 'Member',
      primary: true,
      render: (r) => (
        <div style={{ minWidth: 0, maxWidth: 220 }}>
          <div
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 15,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {r.member.displayName || r.member.email}
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: 13,
              fontWeight: 400,
              color: 'var(--gt-text-dim)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {r.member.email}
          </div>
        </div>
      ),
    },
    {
      key: 'coach',
      header: 'Asked',
      width: 220,
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              color: 'var(--gt-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {r.coach.displayName || r.coach.email}
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: 13,
              color: 'var(--gt-text-dim)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {r.coach.email}
          </div>
        </div>
      ),
    },
    {
      key: 'message',
      header: 'What they said',
      render: (r) => (
        <span
          style={{
            display: 'block',
            maxWidth: 280,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: r.message ? 'var(--gt-text)' : 'var(--gt-text-faint)',
            fontSize: 14,
          }}
          title={r.message || undefined}
        >
          {r.message || 'Nothing written'}
        </span>
      ),
    },
    {
      key: 'age',
      header: 'Waiting',
      width: 150,
      numeric: true,
      render: (r) => (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          {r.ageDays >= 10 ? <Badge tone="warning">Expires soon</Badge> : null}
          <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
            {r.ageDays === 0
              ? 'Today'
              : `${r.ageDays} ${r.ageDays === 1 ? 'day' : 'days'}`}
          </span>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      headerHidden: true,
      actions: true,
      width: 120,
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
            fontSize: 17,
            marginBottom: 4,
          }}
        >
          Members waiting on a coach
        </h2>
        <p style={{ margin: 0, color: 'var(--gt-text-dim)', fontSize: 14, maxWidth: '62ch' }}>
          Members who asked a coach to take them on and have not heard back. Anything
          older than 14 days expires by itself the next time this list loads.
        </p>
      </div>
      {error ? (
        <Card
          style={{
            marginBottom: 12,
            borderColor: 'color-mix(in srgb, var(--gt-danger) 35%, transparent)',
            background: 'var(--gt-danger-weak)',
          }}
        >
          <span role="alert" style={{ color: 'var(--gt-danger)', fontSize: 14 }}>
            {error}
          </span>
        </Card>
      ) : null}
      {requests === null ? (
        <SkeletonRows rows={3} cols={5} />
      ) : (
        <DataTable
          columns={columns}
          rows={requests}
          rowKey={(r) => r.id}
          caption="Members waiting on a coach"
          emptyTitle="Nobody is waiting"
          emptyDescription="Every request a member has sent has been answered."
        />
      )}
    </div>
  );
}
