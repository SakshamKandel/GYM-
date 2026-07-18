import { gymPhotos, gyms } from '@gym/db';
import { GYM_AMENITIES, GYM_CATEGORIES, GYM_DAY_KEYS, type GymAmenity, type GymCategory } from '@gym/shared';
import { asc, count } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { clientIp } from '@/lib/rateLimit';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin nearby-gyms CRUD list (plan §4/§7 P7). Guarded by `gyms.manage`
 * (super_admin/main_admin bypass only — not delegable to any sub-role preset,
 * only via a per-account override, per plan §8).
 *
 *  - GET  → every gym regardless of status (draft/published/archived), so the
 *    console can show what's not live yet. Includes `photoCount`.
 *  - POST → create a new listing. Always starts `status:'draft'`,
 *    `verifiedByAdmin:false` regardless of what the client sends — a listing
 *    only goes live through the PATCH route once an editor has actually
 *    reviewed it (never let create-time input silently publish a gym).
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

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'gym';
}

// z.enum needs a non-empty tuple type; GYM_CATEGORIES/GYM_AMENITIES are typed
// as plain readonly arrays in @gym/shared (their values are still the exact
// literal unions at runtime), so this cast is a type-only adjustment.
const categorySchema = z.enum(GYM_CATEGORIES as unknown as [GymCategory, ...GymCategory[]]);
const amenitySchema = z.enum(GYM_AMENITIES as unknown as [GymAmenity, ...GymAmenity[]]);

const createSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, 'lowercase letters, numbers, and hyphens only')
    .optional(),
  name: z.string().trim().min(1).max(200),
  category: categorySchema.default('gym'),
  addressText: z.string().trim().max(500).default(''),
  city: z.string().trim().max(120).default(''),
  district: z.string().trim().max(120).default(''),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  phone: z.string().trim().max(40).default(''),
  website: z.string().trim().url().max(500).nullable().optional(),
  socialLinks: z.array(socialLinkSchema).max(10).default([]),
  hours: hoursSchema.default({}),
  amenities: z.array(amenitySchema).max(GYM_AMENITIES.length).default([]),
  externalImageUrl: z.string().trim().url().max(2000).nullable().optional(),
  priceNote: z.string().trim().max(300).default(''),
  description: z.string().trim().max(4000).default(''),
});

const MAX_SLUG_ATTEMPTS = 20;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'gyms.manage');
  if (principal instanceof Response) return principal;

  const db = getDb();
  const rows = await db.select().from(gyms).orderBy(asc(gyms.name));

  const ids = rows.map((r) => r.id);
  const photoCountMap = new Map<string, number>();
  if (ids.length > 0) {
    const photoCountRows = await db
      .select({ gymId: gymPhotos.gymId, n: count() })
      .from(gymPhotos)
      .groupBy(gymPhotos.gymId);
    for (const r of photoCountRows) photoCountMap.set(r.gymId, Number(r.n));
  }

  return json(
    { gyms: rows.map((r) => ({ ...r, photoCount: photoCountMap.get(r.id) ?? 0 })) },
    200,
  );
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'gyms.manage');
  if (principal instanceof Response) return principal;

  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { slug, ...rest } = parsed.data;

  const db = getDb();
  const values = {
    ...rest,
    lat: rest.lat ?? null,
    lng: rest.lng ?? null,
    website: rest.website || null,
    externalImageUrl: rest.externalImageUrl || null,
    status: 'draft' as const,
    verifiedByAdmin: false,
    createdBy: principal.id,
    lastEditedBy: principal.id,
  };

  let created: { id: string; slug: string } | undefined;
  const base = slug ?? slugify(rest.name);

  if (slug) {
    const inserted = await db
      .insert(gyms)
      .values({ slug, ...values })
      .onConflictDoNothing({ target: gyms.slug })
      .returning({ id: gyms.id, slug: gyms.slug });
    if (inserted.length === 0) return json({ error: 'slug_taken' }, 409);
    created = inserted[0];
  } else {
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS && !created; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const inserted = await db
        .insert(gyms)
        .values({ slug: candidate, ...values })
        .onConflictDoNothing({ target: gyms.slug })
        .returning({ id: gyms.id, slug: gyms.slug });
      created = inserted[0];
    }
    if (!created) return json({ error: 'slug_generation_failed' }, 500);
  }

  await logAudit(
    principal,
    'gym.create',
    'gym',
    created.id,
    { name: rest.name, slug: created.slug },
    clientIp(req),
  );

  return json({ id: created.id, slug: created.slug }, 201);
}
