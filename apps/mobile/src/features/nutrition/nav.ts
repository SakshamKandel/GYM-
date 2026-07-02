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

export function customHref(meal: Meal, date: string): Href {
  return asHref(`/food/custom?meal=${meal}&date=${date}`);
}

export function portionHref(foodId: string, meal: Meal, date: string): Href {
  return asHref(`/food/portion?foodId=${encodeURIComponent(foodId)}&meal=${meal}&date=${date}`);
}
