import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { Tier } from '@gym/shared';
import { BASE_URL, fetchWithTimeout } from '../../lib/api/client';
import { useAuth } from '../../state/auth';

/**
 * Member VIDEO LIBRARY read-path.
 *
 * Two endpoints back this module (both bearer-authed, tier-gated server-side):
 *   - GET /api/plan-videos            → the browseable catalogue of `ready`
 *     videos with a per-row `locked` flag (member tier vs required tier). No
 *     signed URL — playback is disposable, so it is NOT minted here.
 *   - GET /api/plan-videos/by-id/[id] → a short-lived signed playback URL for
 *     the exact video the member tapped (an exercise may have several, and
 *     plan-level videos have no exerciseId, so this is keyed on the row id, not
 *     the exercise like the exercise-detail "coach demo" route).
 *
 * Every fetch here is failure-tolerant: the list resolves to null and the
 * playback lookup to a fallback variant, so the Videos screen degrades to an
 * empty/error state instead of crashing.
 */

const tierEnum = z.enum(['starter', 'silver', 'gold', 'elite']);

const videoItemSchema = z.object({
  id: z.string(),
  exerciseId: z.string().nullable(),
  exerciseName: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  tierRequired: tierEnum,
  thumbnailUrl: z.string().nullable(),
  durationSec: z.number().nullable(),
  views: z.number(),
  locked: z.boolean(),
});

const librarySchema = z.object({ videos: z.array(videoItemSchema) });

export type VideoLibraryItem = z.infer<typeof videoItemSchema>;

/** List the ready-video catalogue. Returns null on any failure (never throws). */
export async function fetchVideoLibrary(token: string): Promise<VideoLibraryItem[] | null> {
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/api/plan-videos`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const parsed = librarySchema.safeParse(await res.json());
    return parsed.success ? parsed.data.videos : null;
  } catch {
    return null;
  }
}

/**
 * Discriminated playback result — the caller branches on `kind`. 'locked' is a
 * normal outcome that drives the paywall affordance, not an error.
 */
export type VideoPlaybackResult =
  | { kind: 'ok'; url: string; title: string; description: string; tierRequired: Tier }
  | { kind: 'locked'; requiredTier: Tier }
  | { kind: 'not_found' }
  | { kind: 'not_configured' }
  | { kind: 'unavailable' };

const playbackOkSchema = z.object({
  url: z.string(),
  title: z.string(),
  description: z.string(),
  tierRequired: tierEnum,
});

const playbackLockedSchema = z.object({
  error: z.literal('locked'),
  requiredTier: tierEnum,
});

/** Mint the signed playback URL for a specific library video. Never throws. */
export async function fetchVideoPlayback(id: string, token: string): Promise<VideoPlaybackResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${BASE_URL}/api/plan-videos/by-id/${encodeURIComponent(id)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      },
    );
  } catch {
    return { kind: 'unavailable' };
  }

  if (res.ok) {
    try {
      const parsed = playbackOkSchema.safeParse(await res.json());
      if (!parsed.success) return { kind: 'unavailable' };
      return { kind: 'ok', ...parsed.data };
    } catch {
      return { kind: 'unavailable' };
    }
  }

  if (res.status === 403) {
    try {
      const parsed = playbackLockedSchema.safeParse(await res.json());
      if (parsed.success) return { kind: 'locked', requiredTier: parsed.data.requiredTier };
    } catch {
      // fall through to unavailable
    }
    return { kind: 'unavailable' };
  }

  if (res.status === 404) return { kind: 'not_found' };
  if (res.status === 503) return { kind: 'not_configured' };
  return { kind: 'unavailable' };
}

export interface VideoLibraryState {
  status: 'loading' | 'ready' | 'error' | 'signedOut';
  videos: VideoLibraryItem[];
}

/** Load the video catalogue for the signed-in member; reload() refetches. */
export function useVideoLibrary(): VideoLibraryState & { reload: () => void } {
  const token = useAuth((s) => s.token);
  const [state, setState] = useState<VideoLibraryState>({ status: 'loading', videos: [] });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let mounted = true;
    if (!token) {
      setState({ status: 'signedOut', videos: [] });
      return;
    }
    setState((s) => ({ status: 'loading', videos: s.videos }));
    void (async () => {
      const videos = await fetchVideoLibrary(token);
      if (!mounted) return;
      if (videos === null) setState({ status: 'error', videos: [] });
      else setState({ status: 'ready', videos });
    })();
    return () => {
      mounted = false;
    };
  }, [token, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}

export type VideoPlaybackState =
  | { status: 'loading' }
  | { status: 'ready'; url: string; title: string; description: string }
  | { status: 'locked'; requiredTier: Tier }
  | { status: 'unavailable' };

/**
 * Resolve signed playback for one video. A short-lived URL is re-fetched
 * whenever the id or session token changes; it is never cached beyond state.
 */
export function useVideoPlayback(id: string): VideoPlaybackState {
  const token = useAuth((s) => s.token);
  const [state, setState] = useState<VideoPlaybackState>({ status: 'loading' });

  useEffect(() => {
    let mounted = true;
    if (!id || !token) {
      setState({ status: 'unavailable' });
      return;
    }
    setState({ status: 'loading' });
    void (async () => {
      const result = await fetchVideoPlayback(id, token);
      if (!mounted) return;
      switch (result.kind) {
        case 'ok':
          setState({
            status: 'ready',
            url: result.url,
            title: result.title,
            description: result.description,
          });
          break;
        case 'locked':
          setState({ status: 'locked', requiredTier: result.requiredTier });
          break;
        default:
          setState({ status: 'unavailable' });
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id, token]);

  return state;
}

/** mm:ss runtime label, or null when the duration is unknown. */
export function formatDuration(durationSec: number | null): string | null {
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec <= 0) return null;
  const total = Math.round(durationSec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
