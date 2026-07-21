import type { Metadata } from 'next';
import { Shell } from '@/components/marketing/Shell';
import {
  MealsCrossSell,
  NutritionClosing,
  NutritionCrossLinks,
  NutritionInterlude,
} from '@/components/marketing/nutrition/Closing';
import { NutritionHero } from '@/components/marketing/nutrition/Hero';
import { NutritionProof } from '@/components/marketing/nutrition/Proof';
import { NutritionQuality } from '@/components/marketing/nutrition/Quality';
import { NutritionSearch } from '@/components/marketing/nutrition/Search';
import { NutritionTargets } from '@/components/marketing/nutrition/Targets';

export const metadata: Metadata = {
  title: 'Food — kcal & macro tracking | The GM Method',
  description:
    'Scan barcodes, search Nepali and global foods across Open Food Facts + USDA, read Nutri-Score and NOVA signals, and hit computed kcal, protein and water targets — offline-first, no ads.',
};

export default function NutritionPage() {
  return (
    <Shell>
      <NutritionHero />
      <NutritionProof />
      <NutritionSearch />
      <NutritionQuality />
      <NutritionTargets />
      <MealsCrossSell />
      <NutritionInterlude />
      <NutritionCrossLinks />
      <NutritionClosing />
    </Shell>
  );
}
