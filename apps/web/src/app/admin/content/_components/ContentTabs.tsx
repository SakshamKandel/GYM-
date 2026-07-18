'use client';

import { useState } from 'react';
import { Button } from '@/components/console';
import { MilestonesModeration } from './MilestonesModeration';
import { ProgressPhotosModeration } from './ProgressPhotosModeration';
import type { VideoListItem } from './types';
import { VideoLibrary } from './VideoLibrary';

/**
 * Tab shell for the content section, added this wave (ADMIN-MASTER-PLAN §3
 * P1-9) alongside the existing video library. `videos` tab is content.manage
 * only (unchanged behavior); the two moderation tabs are moderation.manage
 * only. A caller with just one of the two permissions sees only their tab(s)
 * — no empty tab bar with a single disabled entry.
 */

type Tab = 'videos' | 'milestones' | 'photos';

export function ContentTabs({
  videos,
  videoConfigured,
  canManageContent,
  canModerate,
}: {
  videos: VideoListItem[];
  videoConfigured: boolean;
  canManageContent: boolean;
  canModerate: boolean;
}) {
  const [tab, setTab] = useState<Tab>(canManageContent ? 'videos' : 'milestones');

  const tabs: Array<{ key: Tab; label: string }> = [
    ...(canManageContent ? [{ key: 'videos' as const, label: 'Videos' }] : []),
    ...(canModerate
      ? [
          { key: 'milestones' as const, label: 'Milestones' },
          { key: 'photos' as const, label: 'Progress photos' },
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
          <MilestonesModeration />
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
      {tab === 'milestones' && canModerate ? <MilestonesModeration /> : null}
      {tab === 'photos' && canModerate ? <ProgressPhotosModeration /> : null}
    </div>
  );
}
