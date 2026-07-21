import type { Metadata } from 'next';
import { Shell } from '@/components/marketing/Shell';
import { AboutAttribution } from '@/components/marketing/about/Attribution';
import { AboutCrossLinks } from '@/components/marketing/about/CrossLinks';
import { AboutCta } from '@/components/marketing/about/Cta';
import { AboutHero } from '@/components/marketing/about/Hero';
import { AboutMascot } from '@/components/marketing/about/Mascot';
import { AboutMethod } from '@/components/marketing/about/Method';
import { AboutPhotos } from '@/components/marketing/about/Photos';
import { AboutPrinciples } from '@/components/marketing/about/Principles';
import { AboutStory } from '@/components/marketing/about/Story';

export const metadata: Metadata = {
  title: 'About The GM Method — built in Kathmandu, built to be used',
  description:
    'The GM Method is a coach-built, offline-first fitness app made by coaches and engineers in Kathmandu. Our principles: offline-first, accessible, private and unit-tested. Nepal first, the world second.',
};

export default function AboutPage() {
  return (
    <Shell>
      <AboutHero />
      <AboutStory />
      <AboutPrinciples />
      <AboutMethod />
      <AboutAttribution />
      <AboutPhotos />
      <AboutMascot />
      <AboutCrossLinks />
      <AboutCta />
    </Shell>
  );
}
