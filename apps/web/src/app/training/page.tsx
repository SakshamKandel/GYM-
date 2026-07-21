import type { Metadata } from 'next';
import { Shell } from '@/components/marketing/Shell';
import { AnatomySection } from '@/components/marketing/training/AnatomySection';
import { GymModeSection } from '@/components/marketing/training/GymModeSection';
import { OfflinePrSection } from '@/components/marketing/training/OfflinePrSection';
import { PlansSection } from '@/components/marketing/training/PlansSection';
import {
  TrainingCrossLinks,
  TrainingCta,
  TrainingPhotoInterlude,
} from '@/components/marketing/training/TrainingClosing';
import { TrainingHero } from '@/components/marketing/training/TrainingHero';

export const metadata: Metadata = {
  title: 'Training — the fastest logbook in the gym · The GM Method',
  description:
    'Coach-built plans, a gym mode that flows set to set, true-3D muscle anatomy with 17 heat-mapped zones, and offline-first logging that confirms in under 100 ms. PR detection included, signal not required.',
};

export default function TrainingPage() {
  return (
    <Shell>
      <TrainingHero />
      <GymModeSection />
      <AnatomySection />
      <PlansSection />
      <OfflinePrSection />
      <TrainingPhotoInterlude />
      <TrainingCrossLinks />
      <TrainingCta />
    </Shell>
  );
}
