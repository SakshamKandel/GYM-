import type { Metadata } from 'next';
import { Shell } from '@/components/marketing/Shell';
import { CardShowcase } from '@/components/marketing/pricing/CardShowcase';
import { ClosingCta } from '@/components/marketing/pricing/ClosingCta';
import { Comparison } from '@/components/marketing/pricing/Comparison';
import { Faq } from '@/components/marketing/pricing/Faq';
import { Payments } from '@/components/marketing/pricing/Payments';
import { PricingHero } from '@/components/marketing/pricing/Tiers';
import { loadPublicCatalog } from '@/lib/publicCatalog';

export const metadata: Metadata = {
  title: 'Pricing — The GM Method',
  description:
    'Live regional pricing in NPR and USD. Start free with the full self-tracking app; add coach-assigned workouts, a personal diet plan or full mentorship. Pay via eSewa or Khalti in Nepal — verified coach codes take 30% off.',
};

// Live tier prices from Neon — refetched at most every 5 minutes.
export const revalidate = 300;

export default async function PricingPage() {
  const catalog = await loadPublicCatalog();

  return (
    <Shell>
      <PricingHero catalog={catalog} />
      <Comparison />
      <CardShowcase />
      <Payments />
      <Faq />
      <ClosingCta />
    </Shell>
  );
}
