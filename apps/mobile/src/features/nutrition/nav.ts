import type { Href } from 'expo-router';
import type { Meal } from '@gym/shared';

/**
 * Route builders for the nutrition flow. Typed-routes codegen
 * (.expo/types/router.d.ts) only regenerates when the dev server runs,
 * so fresh routes are cast through a single seam here.
 */
function asHref(path: string): Href {
  return path as Href;
}

export const FOOD_TAB_HREF = asHref('/(tabs)/food');

export function searchHref(meal: Meal, date: string): Href {
  return asHref(`/food/search?meal=${meal}&date=${date}`);
}

export function scanHref(meal: Meal, date: string): Href {
  return asHref(`/food/scan?meal=${meal}&date=${date}`);
}

/**
 * `barcode` is carried through from a scan that found nothing, so the food the
 * member creates is filed under that barcode and the next scan of the same
 * packet lands straight on the portion screen.
 */
export function customHref(meal: Meal, date: string, barcode?: string): Href {
  const suffix = barcode ? `&barcode=${encodeURIComponent(barcode)}` : '';
  return asHref(`/food/custom?meal=${meal}&date=${date}${suffix}`);
}

export function portionHref(foodId: string, meal: Meal, date: string): Href {
  return asHref(`/food/portion?foodId=${encodeURIComponent(foodId)}&meal=${meal}&date=${date}`);
}

/**
 * The portion screen in correction mode: same screen, but it opens on the
 * portion and meal already logged and saves over the existing entry instead of
 * adding a second one.
 */
export function editLogHref(args: {
  logId: string;
  foodId: string;
  meal: Meal;
  date: string;
  grams: number;
}): Href {
  return asHref(
    `/food/portion?foodId=${encodeURIComponent(args.foodId)}&meal=${args.meal}` +
      `&date=${args.date}&logId=${encodeURIComponent(args.logId)}&grams=${Math.round(args.grams)}`,
  );
}
