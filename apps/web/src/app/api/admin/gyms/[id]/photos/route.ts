import { gymPhotos, gyms } from '@gym/db';
import { asc, eq, max } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { clientIp } from '@/lib/rateLimit';
import { json, preflight, readJson } from '@/lib/http';
import { isOwnImageDeliveryUrl } from '@/lib/uploads';

export const runtime = 'nodejs';

/**
 * Admin gym photos (plan §4) — always admin-uploaded via Cloudinary (`kind:
 * 'gym_photo'` at POST /api/uploads/image, public access), NEVER
 * scraped/hotlinked. `{uid, deliveryUrl}` from that reservation is handed
 * straight to this route; `deliveryUrl` must be one of OUR OWN Cloudinary
 * `gym_photo` URLs (isOwnImageDeliveryUrl) — a foreign cloud or a
 * `image/fetch/<remote-url>` delivery type would proxy attacker-controlled
 * content to every viewer, so it's rejected rather than trusted at face value.
 *
 *  - POST  → append one photo at the end of the gym's ordering.
 *  - PATCH → `{order: string[]}` reassigns sortOrder to match the given id
 *    order. Every id must already belong to this gym — a foreign or unknown
 *    id 400s rather than silently reordering a partial/wrong set.
 */

const createSchema = z.object({
  uid: z.string().trim().min(1).max(300),
  deliveryUrl: z.string().trim().url().max(2000),
});

const reorderSchema = z.object({
  order: z.array(z.string().trim().min(1)).min(1).max(50),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'gyms.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  if (!isOwnImageDeliveryUrl(parsed.data.deliveryUrl, ['gym_photo'])) {
    return json({ error: 'deliveryUrl_invalid' }, 400);
  }

  const db = getDb();

  const gymRows = await db.select({ id: gyms.id }).from(gyms).where(eq(gyms.id, id)).limit(1);
  if (gymRows.length === 0) return json({ error: 'not_found' }, 404);

  const maxRow = await db
    .select({ max: max(gymPhotos.sortOrder) })
    .from(gymPhotos)
    .where(eq(gymPhotos.gymId, id));
  const nextOrder = (maxRow[0]?.max ?? -1) + 1;

  const inserted = await db
    .insert(gymPhotos)
    .values({ gymId: id, uid: parsed.data.uid, deliveryUrl: parsed.data.deliveryUrl, sortOrder: nextOrder })
    .returning({ id: gymPhotos.id, deliveryUrl: gymPhotos.deliveryUrl, sortOrder: gymPhotos.sortOrder });

  await logAudit(principal, 'gym.photo.add', 'gym', id, { photoId: inserted[0]?.id }, clientIp(req));

  return json({ photo: inserted[0] }, 201);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'gyms.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const parsed = reorderSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { order } = parsed.data;

  const db = getDb();
  const existing = await db
    .select({ id: gymPhotos.id })
    .from(gymPhotos)
    .where(eq(gymPhotos.gymId, id));
  const existingIds = new Set(existing.map((r) => r.id));

  const uniqueOrderIds = new Set(order);
  if (
    uniqueOrderIds.size !== order.length ||
    order.length !== existingIds.size ||
    !order.every((pid) => existingIds.has(pid))
  ) {
    return json({ error: 'invalid_order' }, 400);
  }

  // No transactions on neon-http — sequential, scoped-by-gymId updates. A
  // partial failure leaves a stale-but-valid ordering, never cross-gym data.
  for (let i = 0; i < order.length; i++) {
    await db
      .update(gymPhotos)
      .set({ sortOrder: i })
      .where(eq(gymPhotos.id, order[i]));
  }

  await logAudit(principal, 'gym.photo.reorder', 'gym', id, {}, clientIp(req));

  const rows = await db
    .select({ id: gymPhotos.id, deliveryUrl: gymPhotos.deliveryUrl, sortOrder: gymPhotos.sortOrder })
    .from(gymPhotos)
    .where(eq(gymPhotos.gymId, id))
    .orderBy(asc(gymPhotos.sortOrder));

  return json({ photos: rows }, 200);
}
