/**
 * Shared client types + constants for the admin content section. Mirrors the
 * projections the /api/admin/videos routes return — the uid-free list shape from
 * GET and the fuller row from POST/PATCH. Kept here so the manager, list, card,
 * and upload form all agree without re-declaring.
 */

export type Tier = 'starter' | 'silver' | 'gold' | 'elite';
export type VideoStatus = 'processing' | 'ready' | 'removed';

/** Tier options in ascending order — labels for the tier <select>. */
export const TIERS: readonly Tier[] = ['starter', 'silver', 'gold', 'elite'];

/**
 * Row shape the library table renders. The server page's initial read and the
 * client refetch (GET /api/admin/videos) both project into this — durationSec is
 * included from the server read so the table can show a runtime; the API's GET
 * list omits it, so treat it as optional/nullable on refetch.
 */
export interface VideoListItem {
  id: string;
  title: string;
  tierRequired: Tier;
  status: VideoStatus;
  position: number;
  thumbnailUrl: string | null;
  durationSec?: number | null;
  createdAt: string;
}

/** Fuller row returned by POST/PATCH (still uid-free). */
export interface VideoDetail {
  id: string;
  title: string;
  description: string;
  exerciseId: string | null;
  planId: string | null;
  tierRequired: Tier;
  status: VideoStatus;
  position: number;
  thumbnailUrl: string | null;
  durationSec: number | null;
  createdAt: string;
}
