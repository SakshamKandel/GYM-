import { gyms } from '@gym/db';
import {
  GYM_AMENITIES,
  GYM_CATEGORIES,
  GYM_DAY_KEYS,
  gymCrowdStatusSchema,
  gymEquipmentItemSchema,
  gymPassOptionSchema,
  type GymAmenity,
  type GymCategory,
} from '@gym/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { clientIp } from '@/lib/rateLimit';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin — edit/publish/archive/verify one gym listing (plan §4/§8).
 *
 * `status` may only become `'published'` when `verifiedByAdmin` is (already,
 * or in the SAME request becomes) `true` — "Publish gated behind
 * verifiedByAdmin" (plan §4). This is the write-side half of that gate; the
 * public list/detail routes re-check both columns as defense-in-depth.
 */

const shiftSchema = z.object({
  open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 24h'),
  close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 24h'),
});

const hoursSchema = z
  .object(Object.fromEntries(GYM_DAY_KEYS.map((k) => [k, z.array(shiftSchema).max(6).optional()])))
  .partial();

const socialLinkSchema = z.object({
  platform: z.string().trim().min(1).max(40),
  url: z.string().trim().url().max(500),
});

// z.enum needs a non-empty tuple type; GYM_CATEGORIES/GYM_AMENITIES are typed
// as plain readonly arrays in @gym/shared (their values are still the exact
// literal unions at runtime), so this cast is a type-only adjustment.
const categorySchema = z.enum(GYM_CATEGORIES as unknown as [GymCategory, ...GymCategory[]]);
const amenitySchema = z.enum(GYM_AMENITIES as unknown as [GymAmenity, ...GymAmenity[]]);

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    category: categorySchema.optional(),
    addressText: z.string().trim().max(500).optional(),
    city: z.string().trim().max(120).optional(),
    district: z.string().trim().max(120).optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    phone: z.string().trim().max(40).optional(),
    website: z.string().trim().url().max(500).nullable().optional(),
    socialLinks: z.array(socialLinkSchema).max(10).optional(),
    hours: hoursSchema.optional(),
    amenities: z.array(amenitySchema).max(GYM_AMENITIES.length).optional(),
    equipment: z.array(gymEquipmentItemSchema).max(200).optional(),
    crowdData: gymCrowdStatusSchema.nullable().optional(),
    passOptions: z.array(gymPassOptionSchema).max(40).optional(),
    coachIds: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    externalImageUrl: z.string().trim().url().max(2000).nullable().optional(),
    priceNote: z.string().trim().max(300).optional(),
    description: z.string().trim().max(4000).optional(),
    status: z.enum(['draft', 'published', 'archived']).optional(),
    verifiedByAdmin: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' });

export function OPTIONS() {
  return preflight();
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'gyms.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const fields = parsed.data;

  const db = getDb();

  if (fields.status === 'published') {
    const verifiedNext = fields.verifiedByAdmin ?? (
      await db.select({ v: gyms.verifiedByAdmin }).from(gyms).where(eq(gyms.id, id)).limit(1)
    )[0]?.v;
    if (verifiedNext !== true) {
      return json({ error: 'must_verify_before_publish' }, 400);
    }
  }

  const updated = await db
    .update(gyms)
    .set({
      ...fields,
      website: fields.website === undefined ? undefined : fields.website || null,
      externalImageUrl:
        fields.externalImageUrl === undefined ? undefined : fields.externalImageUrl || null,
      lastEditedBy: principal.id,
      updatedAt: new Date(),
    })
    .where(eq(gyms.id, id))
    .returning({ id: gyms.id });

  if (updated.length === 0) return json({ error: 'not_found' }, 404);

  await logAudit(principal, 'gym.update', 'gym', id, { fields: Object.keys(fields) }, clientIp(req));

  return json({ id }, 200);
}
