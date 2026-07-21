import type { Metadata } from 'next';
import { Shell } from '@/components/marketing/Shell';
import { CtaBand, Testimonials } from '@/components/marketing/home/Closing';
import { HomeHero } from '@/components/marketing/home/Hero';
import { HomeModules } from '@/components/marketing/home/Modules';
import { PricingTeaser } from '@/components/marketing/home/PricingTeaser';
import { ScrollShowcase } from '@/components/marketing/home/ScrollShowcase';
import {
  CoachingSpotlight,
  FoodSpotlight,
  MealsSpotlight,
  ProgressSpotlight,
  TrainingSpotlight,
} from '@/components/marketing/home/Spotlights';
import { loadPublicCatalog } from '@/lib/publicCatalog';

export const metadata: Metadata = {
  title: 'The GM Method — every rep, every meal, one app',
  description:
    'Workouts, food, meal delivery, gyms and real human coaching in one offline-first fitness app. Built by coaches in Kathmandu, priced for Nepal and the world.',
};

// Live tier prices from Neon — refetched at most every 5 minutes.
export const revalidate = 300;

export default async function Home() {
  const catalog = await loadPublicCatalog();

  return (
    <Shell>
      <HomeHero />
      <HomeModules />
      <ScrollShowcase />
      <TrainingSpotlight />
      <FoodSpotlight />
      <MealsSpotlight />
      <ProgressSpotlight />
      <CoachingSpotlight />
      <Testimonials />
      <PricingTeaser catalog={catalog} />
      <CtaBand />
    </Shell>
  );
}
