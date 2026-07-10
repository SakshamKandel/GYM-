import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { setAccountTier } from '@/lib/tier';

export const runtime = 'nodejs';

/**
 * POST /api/subscription/tier — SELF-SERVE tier selection (Bearer).
 *
 * This is the ONLY way a member changes their own accounts.tier (the old
 * PUT /api/profile mirror is gone). It routes through setAccountTier(), so the
 * write is audited ('subscription.override', reason 'self_serve_paywall'),
 * mirrored onto the profile blob, and the Greece elite auto-assignment stays
 * in sync.
 *
 * TODO(billing): this endpoint currently grants whatever tier the client asks
 * for, because tiers are a preview selection with no money attached. Before
 * charging real money it MUST be replaced with RevenueCat/Stripe receipt
 * validation — the client sends a purchase receipt, the SERVER verifies it
 * with the provider and derives {tier, expiresAt} from the entitlement. Never
 * ship a paid build with this trust-the-client version.
 *
 * Response: 200 { user } — the exact same shape GET /api/me returns (the
 * token is re-resolved through userForToken, the shared serializer, so the
 * client sees the post-write EFFECTIVE tier).
 */

const bodySchema = z.object({
  tier: z.enum(['starter', 'silver', 'gold', 'elite']),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'subscription/tier',
    limit: 5,
    windowMs: 60_000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { tier } = parsed.data;

  // Self-serve selection starts now and carries NO expiry (billing will own
  // real windows). Clearing expiresAt matters: a stale past tierExpiresAt
  // (e.g. from a lapsed buddy trial) would otherwise collapse the new tier to
  // 'starter' at the auth choke point despite this successful write.
  await setAccountTier(user.id, tier, { id: user.id }, 'self_serve_paywall', {
    startsAt: new Date(),
    expiresAt: null,
  });

  // Same serializer as GET /api/me: re-resolve the token so the response is
  // the post-write effective user.
  const updated = await userForToken(token);
  if (!updated) return json({ error: 'unauthorized' }, 401);
  return json({ user: updated }, 200);
}
