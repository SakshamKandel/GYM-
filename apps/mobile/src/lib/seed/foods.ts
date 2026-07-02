import type { FoodItem } from '@gym/shared';

/**
 * Curated seed foods for GM suggestions — regional-first (Greece Maharjan
 * coaches in Nepal), so Nepali / South-Asian staples sit next to the global
 * gym staples. Values are per 100 g (cooked where noted) and sanity-checked
 * against kcal ≈ 4·P + 4·C + 9·F (within ~15%; whole foods drift a little
 * because of fiber and rounding).
 */

type Row = readonly [
  slug: string,
  name: string,
  kcalPer100: number,
  proteinPer100: number,
  carbsPer100: number,
  fatPer100: number,
  servingGrams: number,
  servingLabel: string,
];

// ── Nepali / South-Asian staples ────────────────────────────────
const REGIONAL: readonly Row[] = [
  ['dal-cooked', 'Dal (lentil soup, cooked)', 65, 4.5, 10, 0.8, 200, '1 bowl'],
  ['white-rice-cooked', 'White rice (bhat, cooked)', 130, 2.7, 28, 0.3, 180, '1 plate'],
  ['roti-chapati', 'Roti / chapati (whole wheat)', 300, 9.5, 55, 6, 40, '1 roti'],
  ['chicken-curry', 'Chicken curry (home-style)', 150, 14, 4, 9, 180, '1 bowl'],
  ['goat-curry', 'Goat curry (khasi ko masu)', 145, 16, 3, 8, 150, '1 bowl'],
  ['momo-chicken', 'Chicken momo (steamed)', 180, 9, 22, 6.5, 300, '1 plate (10 pcs)'],
  ['chiura', 'Chiura (beaten rice, dry)', 350, 7, 77, 1.2, 50, '1 cup'],
  ['saag', 'Saag (stir-fried greens)', 60, 3.5, 4.5, 3.5, 100, '1 serving'],
  ['aloo-curry', 'Aloo curry (potato curry)', 110, 2, 15, 5, 150, '1 bowl'],
  ['chana-masala', 'Chana masala (chickpea curry)', 130, 6.5, 17, 4.5, 200, '1 bowl'],
  ['rajma', 'Rajma (kidney bean curry)', 120, 6, 15, 4, 200, '1 bowl'],
  ['dahi', 'Dahi (plain curd, whole milk)', 65, 3.5, 4.7, 3.7, 150, '1 cup'],
  ['paneer', 'Paneer', 296, 18, 4, 23, 80, '1 serving'],
  ['sel-roti', 'Sel roti', 330, 5, 55, 10, 50, '1 piece'],
  ['gundruk-soup', 'Gundruk soup (fermented greens)', 40, 3, 5, 0.8, 200, '1 bowl'],
  ['milk-tea', 'Milk tea (chiya, sweetened)', 55, 1.8, 8, 1.8, 150, '1 cup'],
  ['aloo-paratha', 'Aloo paratha', 280, 6, 38, 11, 100, '1 paratha'],
  ['veg-chowmein', 'Veg chowmein', 160, 4.5, 22, 6, 250, '1 plate'],
  ['thukpa-chicken', 'Chicken thukpa (noodle soup)', 65, 4, 8.5, 1.5, 350, '1 bowl'],
  ['kheer', 'Kheer (rice pudding)', 120, 3, 20, 3, 150, '1 bowl'],
];

// ── Gym staples ─────────────────────────────────────────────────
const GYM: readonly Row[] = [
  ['chicken-breast', 'Chicken breast (cooked)', 165, 31, 0, 3.6, 120, '1 breast'],
  ['chicken-thigh', 'Chicken thigh (cooked)', 209, 26, 0, 11, 100, '1 thigh'],
  ['egg-boiled', 'Egg, boiled', 155, 13, 1.1, 10.6, 50, '1 egg'],
  ['egg-white-boiled', 'Egg white, boiled', 52, 11, 0.7, 0.2, 33, '1 egg white'],
  ['whole-milk', 'Whole milk', 62, 3.2, 4.8, 3.4, 250, '1 glass'],
  ['greek-yogurt', 'Greek yogurt (plain, nonfat)', 59, 10, 3.6, 0.4, 170, '1 tub'],
  ['oats-dry', 'Oats (dry)', 379, 13, 68, 6.5, 40, '1/2 cup dry'],
  ['banana', 'Banana', 89, 1.1, 23, 0.3, 120, '1 medium'],
  ['apple', 'Apple', 52, 0.3, 14, 0.2, 180, '1 medium'],
  ['orange', 'Orange (suntala)', 47, 0.9, 11.8, 0.1, 130, '1 medium'],
  ['peanut-butter', 'Peanut butter', 588, 25, 20, 50, 16, '1 tbsp'],
  ['almonds', 'Almonds', 579, 21, 22, 50, 28, '1 handful'],
  ['whey-protein', 'Whey protein powder', 400, 80, 8, 6, 30, '1 scoop'],
  ['tuna-canned', 'Tuna (canned in water)', 116, 26, 0, 1, 100, '1 can'],
  ['tofu-firm', 'Tofu (firm)', 144, 15.5, 3.9, 8.7, 100, '1/2 block'],
  ['sweet-potato-boiled', 'Sweet potato (boiled)', 76, 1.4, 17.7, 0.1, 150, '1 medium'],
  ['brown-rice-cooked', 'Brown rice (cooked)', 112, 2.3, 24, 0.8, 180, '1 plate'],
  ['whole-wheat-bread', 'Whole-wheat bread', 250, 12, 43, 3.5, 32, '1 slice'],
  ['potato-boiled', 'Potato (boiled)', 87, 1.9, 20, 0.1, 150, '1 medium'],
];

// ── Fats, snacks & extras ───────────────────────────────────────
const SNACKS: readonly Row[] = [
  ['honey', 'Honey', 304, 0.3, 82, 0, 21, '1 tbsp'],
  ['ghee', 'Ghee', 900, 0, 0, 100, 5, '1 tsp'],
  ['olive-oil', 'Olive oil', 884, 0, 0, 100, 14, '1 tbsp'],
  ['samosa', 'Samosa', 290, 5, 30, 16.5, 60, '1 piece'],
  ['bhatmas', 'Bhatmas (roasted soybeans)', 450, 38, 28, 22, 30, '1 handful'],
  ['sukuti', 'Sukuti (dried meat)', 250, 45, 4, 6, 30, '1 handful'],
  ['peanuts-roasted', 'Peanuts (roasted)', 585, 24, 21, 50, 30, '1 handful'],
  ['dark-chocolate', 'Dark chocolate (70%)', 546, 4.9, 61, 31, 25, '2 squares'],
];

function toFoodItem(row: Row): FoodItem {
  const [slug, name, kcalPer100, proteinPer100, carbsPer100, fatPer100, servingGrams, servingLabel] =
    row;
  return {
    id: `seed-${slug}`,
    name,
    brand: null,
    source: 'seed',
    barcode: null,
    kcalPer100,
    proteinPer100,
    carbsPer100,
    fatPer100,
    servingGrams,
    servingLabel,
  };
}

/** All curated seed foods, ready to save into the repo when picked. */
export const SEED_FOODS: readonly FoodItem[] = [...REGIONAL, ...GYM, ...SNACKS].map(toFoodItem);
