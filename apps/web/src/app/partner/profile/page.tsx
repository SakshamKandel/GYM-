import { mealPartners } from '@gym/db';
import { eq } from 'drizzle-orm';
import { Card, PageHeader } from '@/components/console';
import type { LocationValue } from '@/components/console/LocationPicker';
import { getDb } from '@/lib/db';
import { ServiceAreaView } from '../_components/ServiceAreaView';
import { requirePartnerPage } from '../_data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Partner profile — read-only view of the restaurant's own record, including
 * the delivery service area an admin drew on the map. A partner can SEE this
 * geometry but cannot change it here: service areas are admin-controlled, so
 * the page shows a "request changes" note pointing at admin support rather than
 * an editor.
 */
export default async function PartnerProfilePage() {
  const { partnerId, partnerName } = await requirePartnerPage();
  const db = getDb();

  const [row] = await db
    .select({
      addressText: mealPartners.addressText,
      serviceAreas: mealPartners.serviceAreas,
      serviceLat: mealPartners.serviceLat,
      serviceLng: mealPartners.serviceLng,
      serviceRadiusKm: mealPartners.serviceRadiusKm,
      phone: mealPartners.phone,
      contact: mealPartners.contact,
    })
    .from(mealPartners)
    .where(eq(mealPartners.id, partnerId))
    .limit(1);

  const serviceArea: LocationValue | null =
    row && row.serviceLat != null && row.serviceLng != null
      ? { lat: row.serviceLat, lng: row.serviceLng, radiusKm: row.serviceRadiusKm ?? undefined }
      : null;

  return (
    <div style={{ maxWidth: 860 }}>
      <PageHeader
        title="Restaurant profile"
        subtitle={`${partnerName} · Your delivery service area and contact details.`}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontSize: 18 }}>
              Delivery service area
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--gt-text-dim)' }}>
              This is the delivery reach configured for your kitchen. It is managed by the platform
              team — to request a change to your center point or radius, contact admin support with
              the new area and we&apos;ll update it for you.
            </p>
          </div>

          <ServiceAreaView value={serviceArea} />

          {row && row.serviceAreas.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <div
                style={{
                  fontSize: 12,
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  color: 'var(--gt-text-dim)',
                  fontFamily: 'var(--font-heading)',
                  marginBottom: 6,
                }}
              >
                Named service areas
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {row.serviceAreas.map((area) => (
                  <span
                    key={area}
                    style={{
                      fontSize: 13,
                      padding: '4px 10px',
                      borderRadius: 999,
                      background: 'var(--gt-surface-sunken)',
                      border: '1px solid var(--gt-border)',
                    }}
                  >
                    {area}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </Card>

        <Card>
          <h2 style={{ margin: '0 0 12px', fontFamily: 'var(--font-heading)', fontSize: 18 }}>
            Contact details
          </h2>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: '160px 1fr',
              gap: '10px 16px',
              margin: 0,
              fontSize: 14,
            }}
          >
            <ProfileRow label="Address" value={row?.addressText} />
            <ProfileRow label="Contact person" value={row?.contact} />
            <ProfileRow label="Phone" value={row?.phone} />
          </dl>
        </Card>
      </div>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value?: string }) {
  return (
    <>
      <dt style={{ color: 'var(--gt-text-dim)' }}>{label}</dt>
      <dd style={{ margin: 0 }}>
        {value && value.trim() ? value : <span style={{ color: 'var(--gt-text-dim)' }}>—</span>}
      </dd>
    </>
  );
}
