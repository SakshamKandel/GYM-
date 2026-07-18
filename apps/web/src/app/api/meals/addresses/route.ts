import { savedAddresses } from '@gym/db';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Member saved delivery addresses (§8). GET/POST/PATCH/DELETE on the collection;
 * PATCH/DELETE key by `id` in the body. Every query is scoped to the caller's
 * accountId, so an id belonging to someone else is simply not found (no IDOR).
 * DELETE is a soft-delete (isDeleted) so prior orders' FK stays intact.
 */

const createSchema = z.object({
  label: z.string().trim().max(60).optional(),
  line: z.string().trim().min(1).max(200),
  area: z.string().trim().max(120).optional(),
  phone: z.string().trim().min(3).max(40),
  lat: z.number().finite().optional(),
  lng: z.number().finite().optional(),
  isDefault: z.boolean().optional(),
});

const patchSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().trim().max(60).optional(),
    line: z.string().trim().min(1).max(200).optional(),
    area: z.string().trim().max(120).optional(),
    phone: z.string().trim().min(3).max(40).optional(),
    lat: z.number().finite().nullable().optional(),
    lng: z.number().finite().nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

const deleteSchema = z.object({ id: z.string().min(1) });

export function OPTIONS() {
  return preflight();
}

function serialize(a: typeof savedAddresses.$inferSelect) {
  return {
    id: a.id,
    label: a.label,
    line: a.line,
    area: a.area,
    phone: a.phone,
    lat: a.lat,
    lng: a.lng,
    isDefault: a.isDefault,
  };
}

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const rows = await getDb()
    .select()
    .from(savedAddresses)
    .where(and(eq(savedAddresses.accountId, me.id), eq(savedAddresses.isDeleted, false)))
    .orderBy(desc(savedAddresses.isDefault), asc(savedAddresses.createdAt));

  return json({ addresses: rows.map(serialize) }, 200);
}

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'meals/addresses',
    limit: 40,
    windowMs: 24 * 60 * 60 * 1000,
    accountId: me.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const data = parsed.data;

  const db = getDb();
  // A new default demotes the account's other defaults first (best-effort; the
  // read below reflects the final state).
  if (data.isDefault) {
    await db
      .update(savedAddresses)
      .set({ isDefault: false })
      .where(and(eq(savedAddresses.accountId, me.id), eq(savedAddresses.isDefault, true)));
  }

  const [row] = await db
    .insert(savedAddresses)
    .values({
      accountId: me.id,
      label: data.label ?? '',
      line: data.line,
      area: data.area ?? '',
      phone: data.phone,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      isDefault: data.isDefault ?? false,
    })
    .returning();

  return json({ address: serialize(row) }, 201);
}

export async function PATCH(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { id, isDefault, ...fields } = parsed.data;

  const db = getDb();

  const set: Partial<typeof savedAddresses.$inferInsert> = {};
  if (fields.label !== undefined) set.label = fields.label;
  if (fields.line !== undefined) set.line = fields.line;
  if (fields.area !== undefined) set.area = fields.area;
  if (fields.phone !== undefined) set.phone = fields.phone;
  if (fields.lat !== undefined) set.lat = fields.lat;
  if (fields.lng !== undefined) set.lng = fields.lng;
  if (isDefault !== undefined) set.isDefault = isDefault;

  if (isDefault === true) {
    await db
      .update(savedAddresses)
      .set({ isDefault: false })
      .where(and(eq(savedAddresses.accountId, me.id), eq(savedAddresses.isDefault, true)));
  }

  const updated = await db
    .update(savedAddresses)
    .set(set)
    .where(
      and(
        eq(savedAddresses.id, id),
        eq(savedAddresses.accountId, me.id),
        eq(savedAddresses.isDeleted, false),
      ),
    )
    .returning();
  const row = updated[0];
  if (!row) return json({ error: 'not_found' }, 404);

  return json({ address: serialize(row) }, 200);
}

export async function DELETE(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const parsed = deleteSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const updated = await getDb()
    .update(savedAddresses)
    .set({ isDeleted: true, isDefault: false })
    .where(
      and(
        eq(savedAddresses.id, parsed.data.id),
        eq(savedAddresses.accountId, me.id),
        eq(savedAddresses.isDeleted, false),
      ),
    )
    .returning({ id: savedAddresses.id });
  if (updated.length === 0) return json({ error: 'not_found' }, 404);

  return json({ ok: true }, 200);
}
