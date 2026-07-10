import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * GET /api/health — unauthenticated server-identity probe.
 *
 * The mobile app targets a LAN host:port in dev (EXPO_PUBLIC_API_URL); if a
 * DIFFERENT app ever squats that port, its responses (e.g. a blanket 401)
 * must not be mistaken for "session revoked" and wipe a valid sign-in. The
 * auth store probes this endpoint before honoring a 401 as revocation — see
 * apps/mobile/src/state/auth.ts. The `ok` and `app` fields are the identity
 * contract zod-validated by confirmGymTrackerServer()
 * (apps/mobile/src/lib/api/client.ts) — never remove or rename them; only
 * ADD fields (that schema is non-strict).
 *
 * `db` is additive: a fast SELECT 1 with a ~1s cap. `db:false` means the
 * server is up but Neon is unreachable/slow — the endpoint still returns 200
 * because its primary job is identity, not readiness.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET() {
  let dbOk = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Swallow a late rejection if the timeout wins the race (no unhandled
    // rejection warnings), while the race itself still sees the failure.
    const probe = Promise.resolve(getDb().execute(sql`select 1`));
    probe.catch(() => undefined);
    await Promise.race([
      probe,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('db_health_timeout')), 1_000);
      }),
    ]);
    dbOk = true;
  } catch {
    dbOk = false;
  } finally {
    if (timer) clearTimeout(timer);
  }
  return json({ ok: true, app: 'gym-tracker', db: dbOk }, 200);
}
