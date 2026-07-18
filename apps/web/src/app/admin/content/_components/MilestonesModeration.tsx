'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Card,
  ConfirmButton,
  type Column,
  DataTable,
  SkeletonRows,
} from '@/components/console';

/**
 * Admin moderation of coach_milestones (ADMIN-MASTER-PLAN §3 P1-9) — a
 * member-visible "verified progress story" written by a member's coach, which
 * previously had no oversight surface at all (a coach could only manage their
 * OWN rows). Self-fetches from GET /api/admin/moderation/milestones on mount,
 * consistent with the sibling oversight/moderation panels added this wave.
 *
 * Rendered as one tab of the content section; only mounted when the caller
 * holds 'moderation.manage' (checked by the parent page/tab shell).
 */

interface Milestone {
  id: string;
  title: string;
  note: string;
  achievedAt: string;
  createdAt: string;
  member: { id: string; email: string; displayName: string };
  coach: { id: string; email: string; displayName: string };
}

export function MilestonesModeration() {
  const [milestones, setMilestones] = useState<Milestone[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/moderation/milestones');
      if (!res.ok) {
        setError("Couldn't load milestones.");
        return;
      }
      const data = (await res.json()) as { milestones: Milestone[] };
      setMilestones(data.milestones);
    } catch {
      setError('Network error.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: Milestone) {
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/moderation/milestones/${encodeURIComponent(row.id)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        setError(
          res.status === 404 ? 'Already removed — refreshing.' : "Couldn't remove that.",
        );
        await load();
        return;
      }
      setMilestones((prev) => (prev ? prev.filter((m) => m.id !== row.id) : prev));
    } catch {
      setError('Network error.');
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<Milestone>[] = [
    {
      key: 'member',
      header: 'Member',
      render: (m) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {m.member.displayName || m.member.email}
          </div>
          <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{m.member.email}</div>
        </div>
      ),
    },
    {
      key: 'coach',
      header: 'Coach',
      render: (m) => (
        <span style={{ fontSize: 13 }}>{m.coach.displayName || m.coach.email}</span>
      ),
    },
    {
      key: 'title',
      header: 'Milestone',
      render: (m) => (
        <div style={{ minWidth: 0, maxWidth: 320 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{m.title}</div>
          {m.note ? (
            <div
              style={{
                fontSize: 12,
                color: 'var(--gt-text-dim)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={m.note}
            >
              {m.note}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'achievedAt',
      header: 'Achieved',
      width: 120,
      render: (m) => <span className="gt-numeric" style={{ fontSize: 13 }}>{m.achievedAt}</span>,
    },
    {
      key: 'actions',
      header: '',
      width: 110,
      align: 'right',
      render: (m) => (
        <ConfirmButton
          label="Remove"
          confirmLabel="Confirm"
          busyLabel="Removing…"
          size="sm"
          busy={busyId === m.id}
          onConfirm={() => void remove(m)}
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
      {milestones === null ? (
        <SkeletonRows rows={4} cols={4} />
      ) : (
        <DataTable
          columns={columns}
          rows={milestones}
          rowKey={(m) => m.id}
          empty="No milestones logged yet."
        />
      )}
    </div>
  );
}
