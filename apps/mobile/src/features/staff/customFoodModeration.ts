import { z } from 'zod';
import { BASE_URL, fetchWithTimeout } from '../../lib/api/client';
import { StaffApiError, type ModerationItem } from './api';

/**
 * Admin console — the custom-foods moderation queue client.
 *
 * `getModerationQueue`/`removeModerationItem` in ./api.ts still short-circuit
 * 'custom-foods' to a 'not_configured' stub, written when no server route
 * existed. The route exists now (GET/DELETE /api/admin/moderation/custom-foods
 * [/id]), so the two staff screens call through here instead for that one tab.
 *
 * FOLLOW-UP: this is a drop-in for the two stub branches in ./api.ts — fold it
 * in there and delete this module, at which point the screens go back to the
 * plain getModerationQueue(kind)/removeModerationItem(kind, id) calls they
 * already make for the other two tabs. It lives apart only because this wave
 * split file ownership that way.
 *
 * Same house contract as ./api.ts: zod at the boundary, and nothing throws a
 * raw error — every failure surfaces as a StaffApiError code.
 */

const REQUEST_TIMEOUT_MS = 15_000;

const customFoodRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  kcalPer100: z.number(),
  createdAt: z.string(),
  account: z.object({
    id: z.string(),
    email: z.string(),
    displayName: z.string(),
  }),
});

/** Resilient: drop unparseable rows rather than blanking the whole queue. */
const customFoodsQueueSchema = z.object({
  foods: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): ModerationItem[] => {
      const parsed = customFoodRowSchema.safeParse(raw);
      if (!parsed.success) return [];
      const r = parsed.data;
      const brand = r.brand?.trim();
      const macros = `${Math.round(r.kcalPer100)} kcal / 100 g`;
      return [
        {
          id: r.id,
          accountId: r.account.id,
          accountDisplayName: r.account.displayName.trim() || r.account.email,
          title: r.name,
          detail: brand ? `${brand} · ${macros}` : macros,
          imageUrl: null,
          createdAt: r.createdAt,
        },
      ];
    }),
  ),
});

const okSchema = z.object({ ok: z.literal(true) });

/** Mirrors ./api.ts's statusToCode — same status → typed-code mapping. */
async function request(method: 'GET' | 'DELETE', path: string, token: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${BASE_URL}${path}`,
      {
        method,
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      },
      REQUEST_TIMEOUT_MS,
    );
  } catch {
    throw new StaffApiError('network', "Can't reach the server");
  }

  if (res.ok) {
    try {
      return (await res.json()) as unknown;
    } catch {
      return null;
    }
  }
  if (res.status === 401) throw new StaffApiError('unauthorized');
  if (res.status === 403) throw new StaffApiError('forbidden');
  if (res.status === 404) throw new StaffApiError('not_found');
  if (res.status === 400) throw new StaffApiError('invalid');
  // 409 here means the food id resolved to more than one account — the server
  // refuses to guess. Both callers below always send accountId, so this is a
  // guard against a future caller, not a state the screens can reach.
  if (res.status === 409) throw new StaffApiError('conflict');
  if (res.status === 429) throw new StaffApiError('rate_limited');
  if (res.status === 503) throw new StaffApiError('not_configured');
  throw new StaffApiError('network');
}

/**
 * GET /api/admin/moderation/custom-foods → member-authored foods across every
 * account, adapted to the flat ModerationItem shape the two screens render.
 * Requires `moderation.manage`.
 */
export async function getCustomFoodQueue(token: string): Promise<ModerationItem[]> {
  const data = await request('GET', '/api/admin/moderation/custom-foods', token);
  const parsed = customFoodsQueueSchema.safeParse(data);
  if (!parsed.success) throw new StaffApiError('network', 'Unexpected server response');
  return parsed.data.foods;
}

/**
 * DELETE /api/admin/moderation/custom-foods/[id]?accountId= → soft-removes the
 * food (tombstone), so the owning member's device drops it on its next sync
 * rather than keeping it forever. `accountId` is sent because the row key is
 * composite. Requires `moderation.manage`.
 */
export async function removeCustomFood(item: ModerationItem, token: string): Promise<void> {
  const path =
    `/api/admin/moderation/custom-foods/${encodeURIComponent(item.id)}` +
    `?accountId=${encodeURIComponent(item.accountId)}`;
  const data = await request('DELETE', path, token);
  const parsed = okSchema.safeParse(data);
  if (!parsed.success) throw new StaffApiError('network', 'Unexpected server response');
}
