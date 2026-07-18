'use client';

import dynamic from 'next/dynamic';
import type { LocationValue } from '@/components/console/LocationPicker';

/**
 * Read-only service-area map for the partner portal. A partner may VIEW the
 * delivery area an admin set for them, but never edit it here — changes are
 * admin-controlled (see the note on the profile page). Leaflet is client-only,
 * so the picker is dynamically imported with `ssr: false`.
 */
const LocationPicker = dynamic(
  () => import('@/components/console/LocationPicker').then((m) => m.LocationPicker),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          height: 320,
          borderRadius: 10,
          border: '1px solid var(--gt-border)',
          background: 'var(--gt-surface-sunken)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--gt-text-dim)',
          fontSize: 13,
        }}
      >
        Loading map…
      </div>
    ),
  },
);

export function ServiceAreaView({ value }: { value: LocationValue | null }) {
  return (
    <LocationPicker
      mode="radius"
      value={value}
      readOnly
      searchEnabled={false}
      height={320}
      ariaLabel="Your delivery service area"
    />
  );
}
