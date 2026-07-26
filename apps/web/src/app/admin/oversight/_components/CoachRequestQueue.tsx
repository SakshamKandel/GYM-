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
import { MemberLink } from '../../_components/MemberLink';

/**
 * Pending member-to-coach requests, across every coach.
 *
 * This queue is owned by `moderation.manage`, which content_admin holds — but
 * until now its only surface was a panel at the bottom of /admin/coaches, and
 * that page needs `coach.assign` to open. A content_admin therefore held a
 * permission with nowhere to spend it. This is that surface.
 *
 * Fetches its own data rather than riding a server-loaded prop, because the
 * 14-day auto-expiry sweep this queue depends on runs INSIDE the route handler
 * on every read — a direct database read in the page would skip it.
 *
 * No email addresses: the role that works this queue does not hold
 * `members.read`. A viewer who does hold it gets the member's record behind
 * their name.
 */

interface CoachRequest {
  id: string;
  status: 'pending' | 'accepted' | 'declined' | 'canceled';
  message: string;
  createdAt: string;
  decidedAt: string | null;
  ageDays: number;
  /** `email` is present in the response but deliberately never rendered here. */
  member: { id: string; email: string; displayName: string };
  coach: { id: string; email: string; displayName: string };
}

export function CoachRequestQueue({
  canViewMembers,
}: {
  /** Viewer holds `members.read`, so member names can link to the record. */
  canViewMembers: boolean;
}) {
  const [requests, setRequests] = useState<CoachRequest[] | null>(null);
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
      const data = (await res.json()) as { requests: CoachRequest[] };
      setRequests(data.requests);
    } catch {
      setError('Could not reach us just now. Try again.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(row: CoachRequest) {
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

  const columns: Column<CoachRequest>[] = [
    {
      key: 'member',
      header: 'Member',
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <MemberLink id={r.member.id} name={r.member.displayName} canView={canViewMembers} />
        </div>
      ),
    },
    {
      key: 'coach',
      header: 'Coach',
      render: (r) => (
        <span style={{ fontSize: 13 }}>{r.coach.displayName.trim() || 'Unknown coach'}</span>
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
      header: 'Waiting',
      width: 150,
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="gt-numeric" style={{ fontSize: 13 }}>
            {r.ageDays === 0 ? 'Today' : r.ageDays === 1 ? '1 day' : `${r.ageDays} days`}
          </span>
          {r.ageDays >= 10 ? <Badge tone="warning">closing soon</Badge> : null}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error ? (
        <Card style={{ borderColor: 'color-mix(in srgb, var(--gt-danger) 35%, transparent)' }}>
          <span style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</span>
        </Card>
      ) : null}
      {requests === null ? (
        <SkeletonRows rows={3} cols={5} />
      ) : (
        <DataTable
          columns={columns}
          rows={requests}
          rowKey={(r) => r.id}
          empty="No members are waiting on a coach right now."
        />
      )}
    </div>
  );
}
