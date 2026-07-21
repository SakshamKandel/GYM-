import type { Metadata } from 'next';
import { Shell } from '@/components/marketing/Shell';
import { ClosingCta, CrossLinks, PhotoInterlude } from '@/components/marketing/progress/Closing';
import { ProgressHero } from '@/components/marketing/progress/Hero';
import { MeasurementsSection } from '@/components/marketing/progress/MeasurementsSection';
import { PhotosSection } from '@/components/marketing/progress/PhotosSection';
import { PRSection } from '@/components/marketing/progress/PRSection';
import { ProofBand } from '@/components/marketing/progress/ProofBand';
import { TrendExplainer } from '@/components/marketing/progress/TrendExplainer';

export const metadata: Metadata = {
  title: 'Progress tracking — The GM Method',
  description:
    'Daily weight smoothed into a trend you can trust, tape measurements with deltas, auto-detected PRs, workout streaks and private progress photos. Proof, not vibes.',
};

export default function ProgressPage() {
  return (
    <Shell>
      <ProgressHero />
      <ProofBand />
      <TrendExplainer />
      <MeasurementsSection />
      <PRSection />
      <PhotosSection />
      <PhotoInterlude />
      <CrossLinks />
      <ClosingCta />
    </Shell>
  );
}
