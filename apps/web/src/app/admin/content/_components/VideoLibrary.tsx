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
import { UploadModal } from './UploadModal';
import {
  type Tier,
  TIERS,
  type VideoDetail,
  type VideoListItem,
} from './types';

/**
 * Client owner of the plan-video library. Seeded with the server-read rows so
 * the table paints immediately, then kept live locally: the upload modal, the
 * per-row tier selector and the remove action each mutate through the guarded
 * /api/admin/videos routes (the httpOnly gt_staff cookie rides along on the
 * same-origin fetch) and patch this list — no full server refetch needed.
 *
 * `videoConfigured` seeds the hosting banner; it also flips to false if an
 * upload attempt comes back 503 video_not_configured. Existing rows still list
 * either way — the owner just needs to add host keys to enable new uploads.
 */

/**
 * Maps a video status onto the console StatusChip's semantic Status + label:
 * 'ready' reads as playable (positive/live, "Ready"); 'processing' as pending
 * (warning, "Processing"). 'removed' never renders (filtered out) but maps to a
 * neutral 'ended' for exhaustiveness.
 */
const STATUS_CHIP: Record<
  VideoListItem['status'],
  { status: 'live' | 'pending' | 'ended'; label: string }
> = {
  ready: { status: 'live', label: 'Ready' },
  processing: { status: 'pending', label: 'Processing' },
  removed: { status: 'ended', label: 'Removed' },
};

/** Small, dim-formatted mm:ss (or "—") for the duration column. */
function formatDuration(sec: number | null | undefined): string {
  if (sec == null || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function VideoLibrary({
  initialVideos,
  videoConfigured,
}: {
  initialVideos: VideoListItem[];
  videoConfigured: boolean;
}) {
  const [videos, setVideos] = useState<VideoListItem[]>(initialVideos);
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
    const rows = videos.filter((v) => v.status !== 'removed');
    if (!q) return rows;
    return rows.filter((v) => v.title.toLowerCase().includes(q));
  }, [videos, query]);

  function handleUploaded(v: VideoDetail) {
    const item: VideoListItem = {
      id: v.id,
      title: v.title,
      tierRequired: v.tierRequired,
      status: v.status,
      position: v.position,
      thumbnailUrl: v.thumbnailUrl,
      durationSec: v.durationSec,
      createdAt: v.createdAt,
    };
    setVideos((prev) => [item, ...prev.filter((x) => x.id !== item.id)]);
  }

  async function changeTier(row: VideoListItem, tierRequired: Tier) {
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
        setRowError({ id: row.id, msg: 'Could not update the tier.' });
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

  async function remove(row: VideoListItem) {
    setBusyId(row.id);
    setRowError(null);
    try {
      const res = await fetch(
        `/api/admin/videos/${encodeURIComponent(row.id)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        setRowError({ id: row.id, msg: 'Could not remove the video.' });
        setBusyId(null);
        return;
      }
      setVideos((prev) => prev.filter((x) => x.id !== row.id));
    } catch {
      setRowError({ id: row.id, msg: 'Network error.' });
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<VideoListItem>[] = [
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
        <div style={{ minWidth: 0 }}>
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
            <div style={{ color: 'var(--gt-danger)', fontSize: 12, marginTop: 4 }}>
              {rowError.msg}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'tier',
      header: 'Required tier',
      width: 150,
      render: (v) => (
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
      key: 'duration',
      header: 'Length',
      width: 90,
      align: 'right',
      render: (v) => (
        <span className="gt-numeric" style={{ color: 'var(--gt-text-dim)' }}>
          {formatDuration(v.durationSec)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 120,
      align: 'right',
      render: (v) => (
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

  const hasAny = videos.some((v) => v.status !== 'removed');

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
