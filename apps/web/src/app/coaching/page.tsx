import type { Metadata } from 'next';
import { Shell } from '@/components/marketing/Shell';
import {
  CoachingCrossLinks,
  CoachingCta,
  CoachingInterlude,
} from '@/components/marketing/coaching/Closing';
import { CoachingHero } from '@/components/marketing/coaching/Hero';
import { CoachingHowItWorks } from '@/components/marketing/coaching/HowItWorks';
import { CoachingMilestones } from '@/components/marketing/coaching/Milestones';
import { CoachingProfiles } from '@/components/marketing/coaching/Profiles';
import { CoachingSafety } from '@/components/marketing/coaching/Safety';
import { CoachingWhatYouGet } from '@/components/marketing/coaching/WhatYouGet';

export const metadata: Metadata = {
  title: 'Coaching — real human coaches | The GM Method',
  description:
    'Browse admin-verified coaches with public track records, send one request, and get programmed: assigned workouts, diet plans and PII-masked chat inside The GM Method app.',
};

export default function CoachingPage() {
  return (
    <Shell>
      <CoachingHero />
      <CoachingHowItWorks />
      <CoachingProfiles />
      <CoachingWhatYouGet />
      <CoachingSafety />
      <CoachingMilestones />
      <CoachingInterlude />
      <CoachingCrossLinks />
      <CoachingCta />
    </Shell>
  );
}
