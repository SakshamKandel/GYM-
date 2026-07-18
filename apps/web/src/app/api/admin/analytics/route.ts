import { requirePermission } from '@/lib/authz';
import { json, preflight } from '@/lib/http';
import { loadAnalytics } from '@/app/admin/analytics/_components/data';

export const runtime = 'nodejs';

/**
 * Admin console — platform analytics (plan §3 item 15, P2).
 *
 *  GET /api/admin/analytics
 *    → AnalyticsData (revenue by month × currency, promo performance, coach
 *      performance, tier + country breakdowns, trailing-30-day deltas)
 *
 * API twin of the server-rendered /admin/analytics page — both call the SAME
 * loadAnalytics() so they can never drift. Gated on `analytics.read`
 * (super/main only; reachable by others solely via a per-account override).
 * Every figure is a server-side COUNT/SUM GROUP BY aggregate; no member PII is
 * returned (only coach/owner display names, which are staff identity).
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'analytics.read');
  if (principal instanceof Response) return principal;

  const data = await loadAnalytics();
  return json(data, 200);
}
