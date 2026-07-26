import { accounts, tierPrices } from '@gym/db';
import { applyDiscount, resolveRegion, TIER_ORDER } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { billingMode } from '@/lib/billing';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { loadPayee } from '@/lib/paymentPayee';
import { bestActiveGrant } from '@/lib/promoEconomy';

export const runtime = 'nodejs';

/**
 * GET /api/subscription/catalog?region=XX — regional pricing + this account's
 * best active discount (SCALE-UP-PLAN §4.1).
 *
 * Region resolution for DISPLAY: `?region=` hint (raw ISO-3166 alpha-2, e.g.
 * from expo-localization) → stored accounts.country → 'INTL'. resolveRegion()
 * clamps whatever comes out to 'NP' | 'INTL'. The hint decides which prices the
 * paywall SHOWS and nothing else.
 *
 * accounts.country is NEVER written from that hint. It is the stored fact the
 * money paths trust: POST /api/payments/requests only hands out the cheaper NP
 * catalog when the stored country verifies NP (or the rail is Nepal-specific),
 * and the admin queue flags a request as self-reported when it does not
 * (`selfReportedRegion`). While this route wrote the client's own hint into that
 * column, one call to `?region=NP` verified the member's country for them, so
 * both the gate and the flag it feeds passed for anybody who asked. The country
 * now comes only from the platform edge (`x-vercel-ip-country`, or `cf-ipcountry`
 * behind Cloudflare), which the client cannot set. A member whose real location
 * is Nepal is still recognised on the first catalog load, so nothing changes for
 * them; admin analytics keeps a country per account too, now an observed one.
 *
 * Pricing: reads active tier_prices for the resolved region and requires a
 * complete, single-currency four-tier catalog. Missing rows return 503 rather
 * than silently inventing prices.
 *
 * Discount: the account's single best active discount_grants row (if any) is
 * applied to every non-zero tier price.
 *
 * Payee (ADDITIVE `payee` key, null when unconfigured): where a member actually
 * sends the money for the manual-payment rail this response already implies.
 * Without it the paywall asked for a transfer and a receipt while naming no
 * wallet or account, so the only working way to buy anything could not be
 * completed. `null` means no rail is configured and the paywall hides manual
 * payment entirely rather than offering a destination-less transfer.
 */

const TRIAL_DAYS = 2;

const querySchema = z.object({
  region: z.string().trim().min(2).max(8).optional(),
});

/**
 * The country the platform edge observed for this request, or null when there
 * is no trustworthy answer (local development, a self-hosted deploy, an edge
 * that could not place the address).
 *
 * These headers are set by the platform in front of the app and are stripped
 * from anything a client sends, so unlike the `?region=` hint they cannot be
 * chosen by the caller. Cloudflare's placeholders for "unknown" ('XX') and Tor
 * ('T1') are treated as no answer rather than stored as a country.
 */
function edgeCountry(req: Request): string | null {
  const raw = req.headers.get('x-vercel-ip-country') ?? req.headers.get('cf-ipcountry');
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') return null;
  return code;
}

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const rawRegion = new URL(req.url).searchParams.get('region') ?? undefined;
  const parsed = querySchema.safeParse({ region: rawRegion });
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();

  const [account] = await db
    .select({ country: accounts.country })
    .from(accounts)
    .where(eq(accounts.id, me.id))
    .limit(1);

  const regionParam = parsed.data.region?.toUpperCase();
  const region = resolveRegion(regionParam ?? account?.country ?? null);

  // Server-determined only — see the note above. The hint above never lands here.
  const observed = edgeCountry(req);
  if (observed && observed !== account?.country) {
    await db.update(accounts).set({ country: observed }).where(eq(accounts.id, me.id));
  }

  const priceRows = await db
    .select({
      tier: tierPrices.tier,
      amountMinor: tierPrices.amountMinor,
      currency: tierPrices.currency,
    })
    .from(tierPrices)
    .where(and(eq(tierPrices.region, region), eq(tierPrices.active, true)));

  const byTier = new Map(priceRows.map((r) => [r.tier, r]));
  const ordered = TIER_ORDER.map((tier) => byTier.get(tier));
  if (ordered.some((row) => row === undefined)) {
    return json({ error: 'catalog_unavailable' }, 503);
  }
  const complete = ordered.filter((row): row is NonNullable<typeof row> => row !== undefined);
  const currencies = new Set(complete.map((row) => row.currency));
  if (currencies.size !== 1) return json({ error: 'catalog_unavailable' }, 503);

  const [grant, payee] = await Promise.all([bestActiveGrant(me.id), loadPayee()]);

  const tiers = complete.map((p) => {
    if (p.tier === 'starter' || p.amountMinor === 0 || !grant) {
      return { tier: p.tier, amountMinor: p.amountMinor };
    }
    return {
      tier: p.tier,
      amountMinor: p.amountMinor,
      discountedMinor: applyDiscount(p.amountMinor, grant.pct),
      discountPct: grant.pct,
      discountSource: grant.source,
    };
  });

  const currency = complete[0]!.currency;

  // `billingMode` lets the paywall pre-detect (before any tap) whether a paid
  // tier can be granted by the self-serve POST /api/subscription/tier or must
  // route through the store / manual-payment flow (Pack J honest affordance +
  // B23: no optimistic apply → 402 → revert flicker). In 'live' mode the
  // self-serve endpoint returns 402 for every paid tier, so the client shows an
  // "Available in the app store" affordance (INTL) or the eSewa/Khalti section
  // (NP) instead of a Choose CTA that always fails.
  return json(
    { region, currency, tiers, trialDays: TRIAL_DAYS, billingMode: billingMode(), payee },
    200,
  );
}
