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
 * Admin moderation of member progress_photos (ADMIN-MASTER-PLAN §3 P1-9) —
 * silver+ member-captured photos, previously reviewable only by the member
 * themselves or their own assigned coach (read-only). Self-fetches from
 * GET /api/admin/moderation/progress-photos on mount, same pattern as the
 * sibling milestones tab.
 *
 * Rendered as one tab of the content section; only mounted when the caller
 * holds 'moderation.manage'.
 */

interface Photo {
  id: string;
  takenOn: string;
  note: string;
  createdAt: string;
  url: string | null;
  account: { id: string; email: string; displayName: string };
}

export function ProgressPhotosModeration() {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/moderation/progress-photos');
      if (res.status === 503) {
        setError('Image hosting is not configured yet.');
        setPhotos([]);
        return;
      }
      if (!res.ok) {
        setError("Couldn't load progress photos.");
        return;
      }
      const data = (await res.json()) as { photos: Photo[] };
      setPhotos(data.photos);
    } catch {
      setError('Network error.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: Photo) {
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/moderation/progress-photos/${encodeURIComponent(row.id)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        setError(
          res.status === 404 ? 'Already removed — refreshing.' : "Couldn't remove that.",
        );
        await load();
        return;
      }
      setPhotos((prev) => (prev ? prev.filter((p) => p.id !== row.id) : prev));
    } catch {
      setError('Network error.');
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<Photo>[] = [
    {
      key: 'thumb',
      header: '',
      width: 84,
      render: (p) => (
        <div
          style={{
            width: 60,
            height: 44,
            borderRadius: 6,
            overflow: 'hidden',
            background: 'var(--gt-bg)',
            border: '1px solid var(--gt-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {p.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.url}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span style={{ fontSize: 10, color: 'var(--gt-text-dim)' }}>No image</span>
          )}
        </div>
      ),
    },
    {
      key: 'member',
      header: 'Member',
      render: (p) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {p.account.displayName || p.account.email}
          </div>
          <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{p.account.email}</div>
        </div>
      ),
    },
    {
      key: 'takenOn',
      header: 'Taken',
      width: 110,
      render: (p) => <span className="gt-numeric" style={{ fontSize: 13 }}>{p.takenOn}</span>,
    },
    {
      key: 'note',
      header: 'Note',
      render: (p) => (
        <span
          style={{
            display: 'block',
            maxWidth: 260,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: p.note ? 'var(--gt-text)' : 'var(--gt-text-dim)',
            fontSize: 13,
          }}
          title={p.note || undefined}
        >
          {p.note || '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 110,
      align: 'right',
      render: (p) => (
        <ConfirmButton
          label="Remove"
          confirmLabel="Confirm"
          busyLabel="Removing…"
          size="sm"
          busy={busyId === p.id}
          onConfirm={() => void remove(p)}
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
      {photos === null ? (
        <SkeletonRows rows={4} cols={5} />
      ) : (
        <DataTable
          columns={columns}
          rows={photos}
          rowKey={(p) => p.id}
          empty="No progress photos yet."
        />
      )}
    </div>
  );
}
