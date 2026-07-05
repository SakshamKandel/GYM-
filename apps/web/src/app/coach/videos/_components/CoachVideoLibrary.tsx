'use client';

import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  ConfirmButton,
  type Column,
  DataTable,
  EmptyState,
  SearchField,
  StatusChip,
  Toolbar,
} from '@/components/console';
import { UploadModal } from '@/app/admin/content/_components/UploadModal';
import type { VideoDetail } from '@/app/admin/content/_components/types';
import { type CoachVideoRow, type Tier, TIERS } from './types';

/**
 * Client owner of the coach video library. Seeded with the server-read rows so
 * the table paints immediately, then kept live locally. Upload, per-row tier
 * change, and remove each mutate through the guarded /api/admin/videos routes
 * (the coach holds content.video.publish; the httpOnly gt_staff cookie rides
 * along on the same-origin fetch) and patch this list — no full refetch needed.
 *
 * It reuses the admin content section's <UploadModal> (which POSTs to
 * /api/admin/videos and hands back the admin VideoDetail shape) so the upload
 * flow is identical to the admin console. A newly uploaded video has no
 * attached exercise (the modal's exerciseId is optional) and 0 views.
 *
 * Unlike the admin content list, this library INCLUDES removed rows (dimmed)
 * and shows two coach-facing columns: the attached exercise and the view count.
 * `videoConfigured` seeds the hosting banner; it flips to false if an upload
 * comes back 503 video_not_configured.
 */

/** Maps a video status onto the console StatusChip's semantic status + label. */
const STATUS_CHIP: Record<
  CoachVideoRow['status'],
  { status: 'live' | 'pending' | 'ended'; label: string }
> = {
  ready: { status: 'live', label: 'Ready' },
  processing: { status: 'pending', label: 'Processing' },
  removed: { status: 'ended', label: 'Removed' },
};

export function CoachVideoLibrary({
  initialVideos,
  videoConfigured,
}: {
  initialVideos: CoachVideoRow[];
  videoConfigured: boolean;
}) {
  const [videos, setVideos] = useState<CoachVideoRow[]>(initialVideos);
  const [configured, setConfigured] = useState(videoConfigured);
  const [query, setQuery] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  // Per-row transient state: which row is mid-mutation, and any row-level error.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(
    null,
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return videos;
    return videos.filter(
      (v) =>
        v.title.toLowerCase().includes(q) ||
        (v.exercise?.name?.toLowerCase().includes(q) ?? false),
    );
  }, [videos, query]);

  function handleUploaded(v: VideoDetail) {
    const item: CoachVideoRow = {
      id: v.id,
      title: v.title,
      tierRequired: v.tierRequired,
      status: v.status,
      position: v.position,
      thumbnailUrl: v.thumbnailUrl,
      views: 0,
      exercise: v.exerciseId ? { id: v.exerciseId, name: null } : null,
      createdAt: v.createdAt,
    };
    setVideos((prev) => [item, ...prev.filter((x) => x.id !== item.id)]);
  }

  async function changeTier(row: CoachVideoRow, tierRequired: Tier) {
    if (tierRequired === row.tierRequired || busyId) return;
    setBusyId(row.id);
    setRowError(null);
    // Optimistic — reflect immediately, revert on failure.
    setVideos((prev) =>
      prev.map((x) => (x.id === row.id ? { ...x, tierRequired } : x)),
    );
    try {
      const res = await fetch(
        `/api/admin/videos/${encodeURIComponent(row.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tierRequired }),
        },
      );
      if (!res.ok) {
        setVideos((prev) =>
          prev.map((x) =>
            x.id === row.id ? { ...x, tierRequired: row.tierRequired } : x,
          ),
        );
        setRowError({
          id: row.id,
          msg:
            res.status === 403
              ? "You don't have permission to change this."
              : 'Could not update the tier.',
        });
      }
    } catch {
      setVideos((prev) =>
        prev.map((x) =>
          x.id === row.id ? { ...x, tierRequired: row.tierRequired } : x,
        ),
      );
      setRowError({ id: row.id, msg: 'Network error.' });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: CoachVideoRow) {
    setBusyId(row.id);
    setRowError(null);
    try {
      const res = await fetch(
        `/api/admin/videos/${encodeURIComponent(row.id)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        setRowError({
          id: row.id,
          msg:
            res.status === 403
              ? "You don't have permission to remove this."
              : 'Could not remove the video.',
        });
        setBusyId(null);
        return;
      }
      // Soft-delete: keep the row but flip it to removed so the coach still sees
      // history (the server GET returns removed rows too).
      setVideos((prev) =>
        prev.map((x) => (x.id === row.id ? { ...x, status: 'removed' } : x)),
      );
    } catch {
      setRowError({ id: row.id, msg: 'Network error.' });
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<CoachVideoRow>[] = [
    {
      key: 'thumb',
      header: '',
      width: 108,
      render: (v) => (
        <div
          style={{
            width: 92,
            height: 52,
            borderRadius: 8,
            overflow: 'hidden',
            background: 'var(--gt-bg)',
            border: '1px solid var(--gt-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: v.status === 'removed' ? 0.5 : 1,
          }}
        >
          {v.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={v.thumbnailUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span style={{ fontSize: 11, color: 'var(--gt-text-dim)' }}>
              No thumb
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'title',
      header: 'Title',
      render: (v) => (
        <div style={{ minWidth: 0, opacity: v.status === 'removed' ? 0.6 : 1 }}>
          <div
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: 14,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 320,
            }}
            title={v.title}
          >
            {v.title}
          </div>
          {rowError?.id === v.id ? (
            <div style={{ color: '#ff8178', fontSize: 12, marginTop: 4 }}>
              {rowError.msg}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'exercise',
      header: 'Exercise',
      width: 160,
      render: (v) => (
        <span
          style={{
            fontSize: 13,
            color: v.exercise ? 'var(--gt-text)' : 'var(--gt-text-dim)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'inline-block',
            maxWidth: 150,
          }}
          title={v.exercise?.name ?? v.exercise?.id ?? undefined}
        >
          {v.exercise ? v.exercise.name ?? v.exercise.id : '—'}
        </span>
      ),
    },
    {
      key: 'tier',
      header: 'Required tier',
      width: 150,
      render: (v) =>
        v.status === 'removed' ? (
          <span
            className="gt-numeric"
            style={{
              fontSize: 13,
              color: 'var(--gt-text-dim)',
              textTransform: 'capitalize',
            }}
          >
            {v.tierRequired}
          </span>
        ) : (
          <select
            className="gt-input"
            value={v.tierRequired}
            disabled={busyId === v.id}
            onChange={(e) => void changeTier(v, e.target.value as Tier)}
            style={{
              width: 'auto',
              padding: '6px 10px',
              fontSize: 13,
              textTransform: 'capitalize',
            }}
            aria-label={`Required tier for ${v.title}`}
          >
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        ),
    },
    {
      key: 'views',
      header: 'Views',
      width: 80,
      align: 'right',
      render: (v) => (
        <span className="gt-numeric" style={{ color: 'var(--gt-text-dim)' }}>
          {v.views.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (v) => (
        <StatusChip
          status={STATUS_CHIP[v.status].status}
          label={STATUS_CHIP[v.status].label}
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 120,
      align: 'right',
      render: (v) =>
        v.status === 'removed' ? null : (
          <ConfirmButton
            label="Remove"
            confirmLabel="Confirm"
            busyLabel="Removing…"
            size="sm"
            busy={busyId === v.id}
            onConfirm={() => void remove(v)}
          />
        ),
    },
  ];

  const hasAny = videos.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!configured ? (
        <Card style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: 15,
            }}
          >
            Video hosting not configured
          </div>
          <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
            Uploads are disabled until the video host keys are added to the
            server environment. Existing videos still list, but new ones
            can&apos;t be created yet.
          </div>
        </Card>
      ) : null}

      <Toolbar
        left={
          <div style={{ maxWidth: 320, width: '100%' }}>
            <SearchField
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search videos"
              aria-label="Search videos"
            />
          </div>
        }
        right={
          <Button
            variant="primary"
            onClick={() => setUploadOpen(true)}
            disabled={!configured}
          >
            Add video
          </Button>
        }
      />

      {!hasAny ? (
        <EmptyState
          title="No videos yet"
          description={
            configured
              ? 'Upload your first form-check video to show it inside a training plan.'
              : 'Add video host keys to the server, then upload your first form-check video.'
          }
          action={
            configured ? (
              <Button variant="primary" onClick={() => setUploadOpen(true)}>
                Add video
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(v) => v.id}
          empty={
            query.trim()
              ? `No videos match “${query.trim()}”.`
              : 'Nothing here yet.'
          }
        />
      )}

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={handleUploaded}
        onNotConfigured={() => setConfigured(false)}
      />
    </div>
  );
}
