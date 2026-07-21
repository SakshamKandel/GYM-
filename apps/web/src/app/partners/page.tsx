import type { Metadata } from 'next';
import { Shell } from '@/components/marketing/Shell';
import { PartnersClosing } from '@/components/marketing/partners/Closing';
import { PartnersFaq } from '@/components/marketing/partners/Faq';
import { PartnersHero } from '@/components/marketing/partners/Hero';
import { JoinSteps } from '@/components/marketing/partners/JoinSteps';
import { EarningsTour, OrdersBoardTour, PrepMenuTour } from '@/components/marketing/partners/PortalTour';
import { PrivacySection } from '@/components/marketing/partners/PrivacySection';
import { PartnersValue } from '@/components/marketing/partners/ValueBand';
import { VerifySection } from '@/components/marketing/partners/VerifySection';

export const metadata: Metadata = {
  title: 'Partner kitchens — The GM Method',
  description:
    'Sell macro-counted meals to GM members. A live order board, aggregated prep queue, menu manager, wallet payouts and a privacy-first partner portal — with onboarding run by the GM team.',
};

export default function PartnersPage() {
  return (
    <Shell>
      <PartnersHero />
      <PartnersValue />
      <OrdersBoardTour />
      <PrepMenuTour />
      <EarningsTour />
      <VerifySection />
      <PrivacySection />
      <JoinSteps />
      <PartnersFaq />
      <PartnersClosing />
    </Shell>
  );
}
