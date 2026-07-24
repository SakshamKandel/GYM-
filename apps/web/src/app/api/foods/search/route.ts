import { z } from 'zod';
import { json, preflight } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

const querySchema = z.string().trim().min(2).max(80);
const nutrimentsSchema = z
  .object({
    'energy-kcal_100g': z.number().optional(),
    proteins_100g: z.number().optional(),
    carbohydrates_100g: z.number().optional(),
    fat_100g: z.number().optional(),
    fiber_100g: z.number().optional(),
    sugars_100g: z.number().optional(),
    sodium_100g: z.number().optional(),
  })
  .passthrough();
const hitSchema = z
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
const responseSchema = z.object({ hits: z.array(hitSchema) }).passthrough();
const FIELDS =
  'code,product_name,brands,nutriments,serving_quantity,serving_size,nutriscore_grade,nova_group';

export function OPTIONS() {
  return preflight();
}

/** CORS-safe web search backed by live Open Food Facts data. */
export async function GET(req: Request) {
  const limited = rateLimit({
    route: 'foods/search',
    // Open Food Facts documents a 10 search/min/IP ceiling. Apply it per
    // caller here and again to the shared upstream identity below.
    limit: 10,
    windowMs: 60_000,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const url = new URL(req.url);
  const query = querySchema.safeParse(url.searchParams.get('q'));
  if (!query.success) return json({ error: 'invalid' }, 400);

  // Native requests normally call OFF directly, while browsers use this
  // CORS bridge. The additional process-wide gate protects the provider from
  // bursts aggregated behind one server egress address. Production fetch
  // caching below further collapses repeated identical searches.
  const providerLimited = rateLimit({
    route: 'foods/search/provider',
    limit: 10,
    windowMs: 60_000,
    ip: 'shared-upstream',
  });
  if (providerLimited) return providerLimited;

  const upstream = new URL('https://search.openfoodfacts.org/search');
  upstream.searchParams.set('q', query.data);
  upstream.searchParams.set('page_size', '25');
  upstream.searchParams.set('fields', FIELDS);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(upstream, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'GymTracker/1.0 (https://gym-xi-tawny.vercel.app)',
      },
      signal: controller.signal,
      next: { revalidate: 300 },
    });
    if (!response.ok) return json({ error: 'provider_unavailable' }, 503);
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) return json({ error: 'provider_invalid' }, 502);
    return json({ hits: parsed.data.hits }, 200);
  } catch {
    return json({ error: 'provider_unavailable' }, 503);
  } finally {
    clearTimeout(timer);
  }
}
