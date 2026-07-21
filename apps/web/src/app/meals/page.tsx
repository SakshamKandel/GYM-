import type { Metadata } from 'next';
import { Shell } from '@/components/marketing/Shell';
import { AutoLogging } from '@/components/marketing/meals/AutoLogging';
import { CrossLinks, MealsCta } from '@/components/marketing/meals/Closing';
import { MealsHero } from '@/components/marketing/meals/Hero';
import { Kitchens } from '@/components/marketing/meals/Kitchens';
import { MemberDiscount } from '@/components/marketing/meals/MemberDiscount';
import { OrderJourney } from '@/components/marketing/meals/OrderJourney';
import { Subscriptions } from '@/components/marketing/meals/Subscriptions';

export const metadata: Metadata = {
  title: 'GM Meals — macro-counted meals, delivered | The GM Method',
  description:
    'Macro-counted meals from vetted partner kitchens across Kathmandu valley. One-off orders or weekly subscriptions, live 7-state tracking, cash on delivery or eSewa/Khalti — every meal auto-logged into your food diary.',
};

export default function MealsPage() {
  return (
    <Shell>
      <MealsHero />
      <OrderJourney />
      <Subscriptions />
      <AutoLogging />
      <MemberDiscount />
      <Kitchens />
      <CrossLinks />
      <MealsCta />
    </Shell>
  );
}
