import { z } from 'zod';
import { BASE_URL, fetchWithTimeout } from '../../lib/api/client';

/**
 * Support unread badge — one tiny, self-contained fetcher for
 * GET /api/me/unread (SCALE-UP-PLAN §4.4), kept in its own feature module
 * so the support screen depends on nothing outside this module.
 * NEVER throws: any failure (offline, expired
 * session, malformed body) resolves to 0 so the badge just quietly stays
 * hidden instead of breaking the screen.
 */

const REQUEST_TIMEOUT_MS = 8_000;

const unreadSchema = z.object({ support: z.number() });

/** Signed-in users only see priority-support unread here — coach chat has
 * its own badge elsewhere (features/coach). */
export async function getSupportUnread(token: string): Promise<number> {
  try {
    const res = await fetchWithTimeout(
      `${BASE_URL}/api/me/unread`,
      {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      },
      REQUEST_TIMEOUT_MS,
    );
    if (!res.ok) return 0;
    const parsed = unreadSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.support : 0;
  } catch {
    return 0;
  }
}
