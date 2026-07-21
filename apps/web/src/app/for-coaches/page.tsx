import type { Metadata } from 'next';
import { Shell } from '@/components/marketing/Shell';
import { ApplySection } from '@/components/marketing/for-coaches/Apply';
import { ClosingCta } from '@/components/marketing/for-coaches/Closing';
import { DiscoverSection } from '@/components/marketing/for-coaches/Discover';
import { EarnSection } from '@/components/marketing/for-coaches/Earn';
import { FaqSection } from '@/components/marketing/for-coaches/Faq';
import { CoachHero } from '@/components/marketing/for-coaches/Hero';
import { TiersSection } from '@/components/marketing/for-coaches/Tiers';
import { ToolsSection } from '@/components/marketing/for-coaches/Tools';
import { WalletSection } from '@/components/marketing/for-coaches/Wallet';

export const metadata: Metadata = {
  title: 'For coaches — The GM Method',
  description:
    'Coach on your own terms. Get verified, get discovered, and get paid — a public profile, a real client console, and a promo code that earns you 30% commission on every client subscription.',
};

export default function ForCoachesPage() {
  return (
    <Shell>
      <CoachHero />
      <EarnSection />
      <DiscoverSection />
      <ToolsSection />
      <WalletSection />
      <TiersSection />
      <ApplySection />
      <FaqSection />
      <ClosingCta />
    </Shell>
  );
}
