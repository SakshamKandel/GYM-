import { gymPhotos, gyms } from '@gym/db';
import type { GymAmenity } from '@gym/shared';
import { asc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import { GymsManager } from './_components/GymsManager';
import type { GymRow } from './_components/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin nearby-gyms CRUD (plan §4/§7 P7). Guarded by `gyms.manage`
 * (super_admin/main_admin bypass only, per plan §8 — not in any sub-role
 * preset, delegable only via a per-account override).
 *
 * Loads every gym + its photos (grouped, sortOrder-ordered) server-side so
 * the edit drawer has everything it needs with no extra client fetch — every
 * MUTATION still goes through the guarded /api/admin/gyms/* routes.
 */

async function loadGyms(): Promise<GymRow[]> {
  const db = getDb();
  const rows = await db.select().from(gyms).orderBy(asc(gyms.name));

  const photoRows = await db
    .select({
      id: gymPhotos.id,
      gymId: gymPhotos.gymId,
      deliveryUrl: gymPhotos.deliveryUrl,
      sortOrder: gymPhotos.sortOrder,
    })
    .from(gymPhotos)
    .orderBy(asc(gymPhotos.sortOrder));

  const photosByGym = new Map<string, { id: string; deliveryUrl: string; sortOrder: number }[]>();
  for (const p of photoRows) {
    const list = photosByGym.get(p.gymId) ?? [];
    list.push({ id: p.id, deliveryUrl: p.deliveryUrl, sortOrder: p.sortOrder });
    photosByGym.set(p.gymId, list);
  }

  return rows.map((r) => ({
    ...r,
    // The DB column is a plain text[] (schema.ts owns that decision); every
    // value in it was written through this package's own validated
    // POST/PATCH routes, which already restrict it to GYM_AMENITIES.
    amenities: r.amenities as unknown as GymAmenity[],
    photos: photosByGym.get(r.id) ?? [],
  }));
}

export default async function AdminGymsPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('gyms.manage')) redirect('/admin');

  const rows = await loadGyms();
  const published = rows.filter((r) => r.status === 'published').length;
  const draft = rows.filter((r) => r.status === 'draft').length;
  const verified = rows.filter((r) => r.verifiedByAdmin).length;

  return (
    <div style={{ maxWidth: 1200 }}>
      <PageHeader
        title="Nearby gyms"
        subtitle="Discoverable gym/studio listings for the member app. A listing can only be published once it's marked verified — fill in real details before flipping either switch. Photos are admin-uploaded only; never hotlink or scrape third-party images."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile label="Total listings" value={rows.length} />
        <StatTile label="Published" value={published} />
        <StatTile label="Draft" value={draft} />
        <StatTile label="Verified" value={verified} />
      </div>

      <GymsManager gyms={rows} />
    </div>
  );
}
