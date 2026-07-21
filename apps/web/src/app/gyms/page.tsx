import type { Metadata } from 'next';
import { Shell } from '@/components/marketing/Shell';
import { GymsClosingCta } from '@/components/marketing/gyms/ClosingCta';
import { CrossLinks } from '@/components/marketing/gyms/CrossLinks';
import { DetailTour } from '@/components/marketing/gyms/DetailTour';
import { GymsHero } from '@/components/marketing/gyms/Hero';
import { GymsInterlude } from '@/components/marketing/gyms/Interlude';
import { MapSection } from '@/components/marketing/gyms/MapSection';
import { OwnersBand } from '@/components/marketing/gyms/Owners';
import { VerifiedBand } from '@/components/marketing/gyms/Verified';

export const metadata: Metadata = {
  title: 'Gyms — know the gym before you go',
  description:
    'Curated, admin-verified gym listings across Kathmandu valley — real photos, current hours, exact locations and contact. Browse the Gyms tab and walk in already sure.',
};

export default function GymsPage() {
  return (
    <Shell>
      <GymsHero />
      <VerifiedBand />
      <DetailTour />
      <MapSection />
      <OwnersBand />
      <GymsInterlude />
      <CrossLinks />
      <GymsClosingCta />
    </Shell>
  );
}
