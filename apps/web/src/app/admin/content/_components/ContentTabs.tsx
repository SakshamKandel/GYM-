'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  ConfirmButton,
  type Column,
  DataTable,
  SkeletonRows,
} from '@/components/console';
import { MilestonesModeration } from './MilestonesModeration';
import { ProgressPhotosModeration } from './ProgressPhotosModeration';
import type { VideoListItem } from './types';
import { VideoLibrary } from './VideoLibrary';

/**
 * Tab shell for the content section, added this wave (ADMIN-MASTER-PLAN §3
 * P1-9) alongside the existing video library. `videos` tab is content.manage
 * only (unchanged behavior); the three moderation tabs are moderation.manage
 * only. A caller with just one of the two permissions sees only their tab(s)
 * — no empty tab bar with a single disabled entry.
 */

type Tab = 'videos' | 'milestones' | 'photos' | 'foods';

export function ContentTabs({
  videos,
  videoConfigured,
  canManageContent,
  canModerate,
  canViewMembers,
}: {
  videos: VideoListItem[];
  videoConfigured: boolean;
  canManageContent: boolean;
  canModerate: boolean;
  /** Viewer holds `members.read`, so member names can link to the record. */
  canViewMembers: boolean;
}) {
  const [tab, setTab] = useState<Tab>(canManageContent ? 'videos' : 'milestones');

  const tabs: Array<{ key: Tab; label: string }> = [
    ...(canManageContent ? [{ key: 'videos' as const, label: 'Videos' }] : []),
    ...(canModerate
      ? [
          { key: 'milestones' as const, label: 'Milestones' },
          { key: 'photos' as const, label: 'Progress photos' },
          { key: 'foods' as const, label: 'Custom foods' },
        ]
      : []),
  ];

  // Nothing to show a tab bar for — single-permission caller, one tab only.
  if (tabs.length <= 1) {
    return (
      <div>
        {canManageContent ? (
          <VideoLibrary initialVideos={videos} videoConfigured={videoConfigured} />
        ) : canModerate ? (
          <MilestonesModeration canViewMembers={canViewMembers} />
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        role="tablist"
        aria-label="Content sections"
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
      >
        {tabs.map((t) => (
          <Button
            key={t.key}
            variant={tab === t.key ? 'primary' : 'ghost'}
            size="sm"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {tab === 'videos' && canManageContent ? (
        <VideoLibrary initialVideos={videos} videoConfigured={videoConfigured} />
      ) : null}
      {tab === 'milestones' && canModerate ? <MilestonesModeration canViewMembers={canViewMembers} /> : null}
      {tab === 'photos' && canModerate ? <ProgressPhotosModeration canViewMembers={canViewMembers} /> : null}
      {tab === 'foods' && canModerate ? <CustomFoodsModeration /> : null}
    </div>
  );
}

// ── Custom foods queue ──────────────────────────────────────────

interface CustomFood {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  kcalPer100: number;
  proteinPer100: number;
  carbsPer100: number;
  fatPer100: number;
  createdAt: string;
  account: { id: string; email: string; displayName: string };
}

/**
 * Member-authored custom foods (the third moderation queue). Removal is a
 * soft delete server-side so the member's phone actually learns about it on
 * its next sync — see the API route for the tombstone contract.
 *
 * Colocated here rather than in its own file only because this wave's file
 * ownership was split that way; it is a straight sibling of
 * MilestonesModeration / ProgressPhotosModeration and can be lifted out
 * verbatim.
 */
function CustomFoodsModeration() {
  const [foods, setFoods] = useState<CustomFood[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/moderation/custom-foods');
      if (!res.ok) {
        setError("Couldn't load custom foods.");
        return;
      }
      const data = (await res.json()) as { foods: CustomFood[] };
      setFoods(data.foods);
    } catch {
      setError('Could not reach us just now. Try again.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: CustomFood) {
    setBusyId(row.id);
    setError(null);
    try {
      // accountId disambiguates the composite (accountId, id) key.
      const res = await fetch(
        `/api/admin/moderation/custom-foods/${encodeURIComponent(row.id)}?accountId=${encodeURIComponent(row.account.id)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        setError(res.status === 404 ? 'Already removed. Refreshing.' : "Couldn't remove that.");
        await load();
        return;
      }
      setFoods((prev) => (prev ? prev.filter((f) => f.id !== row.id) : prev));
    } catch {
      setError('Could not reach us just now. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<CustomFood>[] = [
    {
      key: 'food',
      header: 'Food',
      render: (f) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{f.name}</div>
          <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
            {f.brand || 'No brand'}
            {f.barcode ? ` · ${f.barcode}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'member',
      header: 'Member',
      render: (f) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {f.account.displayName || f.account.email}
          </div>
          <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{f.account.email}</div>
        </div>
      ),
    },
    {
      key: 'macros',
      header: 'Per 100 g',
      width: 200,
      render: (f) => (
        <span className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          {Math.round(f.kcalPer100)} kcal · P {Math.round(f.proteinPer100)} · C{' '}
          {Math.round(f.carbsPer100)} · F {Math.round(f.fatPer100)}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Added',
      width: 110,
      render: (f) => (
        <span className="gt-numeric" style={{ fontSize: 13 }}>
          {f.createdAt.slice(0, 10)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 110,
      align: 'right',
      render: (f) => (
        <ConfirmButton
          label="Remove"
          confirmLabel="Confirm"
          busyLabel="Removing…"
          size="sm"
          busy={busyId === f.id}
          onConfirm={() => void remove(f)}
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
      {foods === null ? (
        <SkeletonRows rows={4} cols={5} />
      ) : (
        <DataTable
          columns={columns}
          rows={foods}
          rowKey={(f) => `${f.account.id}:${f.id}`}
          empty="No member-created foods yet."
        />
      )}
    </div>
  );
}
