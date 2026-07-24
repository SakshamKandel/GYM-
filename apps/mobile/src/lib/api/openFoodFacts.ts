import { Platform } from 'react-native';
import { z } from 'zod';
import type { FoodItem, NutriScore } from '@gym/shared';
import { BASE_URL } from './client';

/**
 * Live public food APIs — no bundled/demo records.
 *
 * Search strategy:
 *  - Native app → Open Food Facts search-a-licious (best coverage, no key,
 *    no CORS restrictions outside browsers).
 *  - Web → the app API's CORS-safe Open Food Facts proxy.
 *  - USDA is an optional secondary provider only when an explicit
 *    EXPO_PUBLIC_USDA_API_KEY is configured.
 *  - Barcode → OFF v2 product endpoint (CORS-enabled, works everywhere).
 *
 * Every payload is zod-validated at the boundary (CLAUDE.md rule 8).
 */

const USER_AGENT = 'GymTracker/0.1 (contact: nlooptech@gmail.com)';
const USDA_KEY = process.env.EXPO_PUBLIC_USDA_API_KEY?.trim() || null;

const nutrimentsSchema = z
  .object({
    'energy-kcal_100g': z.number().optional(),
    proteins_100g: z.number().optional(),
    carbohydrates_100g: z.number().optional(),
    fat_100g: z.number().optional(),
    fiber_100g: z.number().optional(),
    sugars_100g: z.number().optional(),
    /** OFF reports sodium in GRAMS per 100 g. */
    sodium_100g: z.number().optional(),
  })
  .passthrough();

const searchHitSchema = z
  .object({
    code: z.string(),
    product_name: z.string().nullish(),
    brands: z.union([z.string(), z.array(z.string())]).nullish(),
    nutriments: nutrimentsSchema.nullish(),
    serving_quantity: z.union([z.number(), z.string()]).nullish(),
    serving_size: z.string().nullish(),
    nutriscore_grade: z.string().nullish(),
    nova_group: z.number().nullish(),
  })
  .passthrough();

const searchResponseSchema = z.object({ hits: z.array(searchHitSchema) }).passthrough();

const productResponseSchema = z
  .object({
    status: z.union([z.literal(0), z.literal(1)]).optional(),
    code: z.string().optional(),
    product: searchHitSchema.nullish(),
  })
  .passthrough();

type SearchHit = z.infer<typeof searchHitSchema>;

function firstBrand(brands: SearchHit['brands']): string | null {
  if (!brands) return null;
  const s = Array.isArray(brands) ? brands[0] : brands.split(',')[0];
  return s?.trim() || null;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function toNutriScore(raw: string | null | undefined): NutriScore | null {
  return raw === 'a' || raw === 'b' || raw === 'c' || raw === 'd' || raw === 'e' ? raw : null;
}

function toNovaGroup(raw: number | null | undefined): 1 | 2 | 3 | 4 | null {
  return raw === 1 || raw === 2 || raw === 3 || raw === 4 ? raw : null;
}

function toFoodItem(hit: SearchHit): FoodItem | null {
  const n = hit.nutriments;
  const kcal = n?.['energy-kcal_100g'];
  const name = hit.product_name?.trim();
  // A food without a name or kcal is useless in a tracker — drop it.
  if (!name || kcal === undefined) return null;
  const servingRaw = hit.serving_quantity;
  const servingGrams =
    typeof servingRaw === 'number' ? servingRaw : servingRaw ? parseFloat(servingRaw) : null;
  return {
    id: `off-${hit.code}`,
    name,
    brand: firstBrand(hit.brands),
    source: 'off',
    barcode: hit.code,
    kcalPer100: round1(kcal),
    proteinPer100: round1(n?.proteins_100g ?? 0),
    carbsPer100: round1(n?.carbohydrates_100g ?? 0),
    fatPer100: round1(n?.fat_100g ?? 0),
    servingGrams: servingGrams && Number.isFinite(servingGrams) ? servingGrams : null,
    servingLabel: hit.serving_size ?? null,
    fiberPer100: n?.fiber_100g !== undefined ? round1(n.fiber_100g) : null,
    sugarPer100: n?.sugars_100g !== undefined ? round1(n.sugars_100g) : null,
    // OFF sodium is grams — the app stores mg.
    sodiumPer100: n?.sodium_100g !== undefined ? Math.round(n.sodium_100g * 1000) : null,
    nutriScore: toNutriScore(hit.nutriscore_grade),
    novaGroup: toNovaGroup(hit.nova_group),
  };
}

const FIELDS =
  'code,product_name,brands,nutriments,serving_quantity,serving_size,nutriscore_grade,nova_group';

async function searchOpenFoodFacts(query: string, signal?: AbortSignal): Promise<FoodItem[]> {
  const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(query)}&page_size=25&fields=${FIELDS}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal });
  if (!res.ok) throw new Error(`Food search failed (${res.status})`);
  const parsed = searchResponseSchema.parse(await res.json());
  return parsed.hits
    .map(toFoodItem)
    .filter((f): f is FoodItem => f !== null);
}

/** Same live provider through the app API, used by browsers to avoid CORS. */
async function searchOpenFoodFactsProxy(
  query: string,
  signal?: AbortSignal,
): Promise<FoodItem[]> {
  const url = `${BASE_URL}/api/foods/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!res.ok) throw new Error(`Food search failed (${res.status})`);
  const parsed = searchResponseSchema.parse(await res.json());
  return parsed.hits.map(toFoodItem).filter((food): food is FoodItem => food !== null);
}

// ── USDA FoodData Central ─────────────────────────────────────

const usdaNutrientSchema = z
  .object({
    nutrientId: z.number(),
    value: z.number().optional(),
  })
  .passthrough();

const usdaFoodSchema = z
  .object({
    fdcId: z.number(),
    description: z.string(),
    brandName: z.string().nullish(),
    brandOwner: z.string().nullish(),
    gtinUpc: z.string().nullish(),
    servingSize: z.number().nullish(),
    servingSizeUnit: z.string().nullish(),
    foodNutrients: z.array(usdaNutrientSchema).default([]),
  })
  .passthrough();

const usdaResponseSchema = z.object({ foods: z.array(usdaFoodSchema).default([]) }).passthrough();

const USDA_IDS = {
  kcal: 1008,
  protein: 1003,
  carbs: 1005,
  fat: 1004,
  fiber: 1079,
  sugars: 2000,
  /** USDA sodium is already mg per 100 g. */
  sodium: 1093,
} as const;

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s(])[a-z]/g, (m) => m.toUpperCase());
}

function usdaToFoodItem(f: z.infer<typeof usdaFoodSchema>): FoodItem | null {
  const nutrient = (id: number) =>
    f.foodNutrients.find((n) => n.nutrientId === id)?.value;
  const kcal = nutrient(USDA_IDS.kcal);
  if (kcal === undefined) return null;
  const servingGrams =
    f.servingSize && f.servingSizeUnit?.toLowerCase().startsWith('g') ? f.servingSize : null;
  const fiber = nutrient(USDA_IDS.fiber);
  const sugars = nutrient(USDA_IDS.sugars);
  const sodium = nutrient(USDA_IDS.sodium);
  return {
    id: `usda-${f.fdcId}`,
    name: titleCase(f.description),
    brand: f.brandName?.trim() || f.brandOwner?.trim() || null,
    source: 'usda',
    barcode: f.gtinUpc ?? null,
    kcalPer100: round1(kcal),
    proteinPer100: round1(nutrient(USDA_IDS.protein) ?? 0),
    carbsPer100: round1(nutrient(USDA_IDS.carbs) ?? 0),
    fatPer100: round1(nutrient(USDA_IDS.fat) ?? 0),
    servingGrams,
    servingLabel: servingGrams ? `${servingGrams} g serving` : null,
    fiberPer100: fiber !== undefined ? round1(fiber) : null,
    sugarPer100: sugars !== undefined ? round1(sugars) : null,
    sodiumPer100: sodium !== undefined ? Math.round(sodium) : null,
    nutriScore: null,
    novaGroup: null,
  };
}

async function searchUsda(query: string, signal?: AbortSignal): Promise<FoodItem[]> {
  if (!USDA_KEY) throw new Error('USDA search is not configured');
  const url =
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_KEY}` +
    `&query=${encodeURIComponent(query)}&pageSize=25&dataType=Foundation,SR%20Legacy,Branded`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`USDA search failed (${res.status})`);
  const parsed = usdaResponseSchema.parse(await res.json());
  return parsed.foods
    .map(usdaToFoodItem)
    .filter((f): f is FoodItem => f !== null);
}

/**
 * Unified food search: browsers use the app API's OFF proxy; native tries OFF
 * directly first, then the proxy. USDA is used only with an explicit key.
 */
export async function searchFoods(query: string, signal?: AbortSignal): Promise<FoodItem[]> {
  let providerError: unknown = null;
  try {
    const results =
      Platform.OS === 'web'
        ? await searchOpenFoodFactsProxy(query, signal)
        : await searchOpenFoodFacts(query, signal);
    if (results.length > 0 || !USDA_KEY) return results;
  } catch (err) {
    if (signal?.aborted) throw err;
    providerError = err;
  }

  // Native can retry the same live provider through our CORS-safe API before
  // using an explicitly configured USDA key.
  if (Platform.OS !== 'web') {
    try {
      const proxied = await searchOpenFoodFactsProxy(query, signal);
      if (proxied.length > 0 || !USDA_KEY) return proxied;
    } catch (err) {
      if (signal?.aborted) throw err;
      providerError = err;
    }
  }
  if (USDA_KEY) return searchUsda(query, signal);
  throw providerError instanceof Error ? providerError : new Error('Food search unavailable');
}

export async function lookupBarcode(barcode: string): Promise<FoodItem | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Barcode lookup failed (${res.status})`);
  const parsed = productResponseSchema.parse(await res.json());
  if (!parsed.product) return null;
  return toFoodItem({ ...parsed.product, code: parsed.product.code ?? barcode });
}
