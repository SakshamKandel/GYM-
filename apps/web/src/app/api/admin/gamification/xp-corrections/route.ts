import { accounts, xpEvents } from '@gym/db';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { runAwardEngineOrThrow } from '@/lib/gamification';
import { clientIp } from '@/lib/rateLimit';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin gamification oversight — manual XP corrections (gap build P2-17).
 *
 * `gamification_profiles.xp_total` is a CACHE fully recomputed on every
 * award-engine run as `sum(xp_events.amount) for that account` (see
 * @/lib/gamification's runAwardEngineInner) — so a correction cannot just
 * UPDATE the cached total (the next sync/check-in would silently erase it).
 * Instead we insert a bounded xp_events row of kind `admin_correction`
 * (delta may be negative) and immediately re-run the award engine so the
 * cache and the response both reflect the correction right away.
 *
 *  - GET  ?accountId= → recent admin_correction events (all accounts, or one
 *    when `accountId` is supplied), newest first, for the audit trail view.
 *  - POST {accountId, delta, reason} → apply one correction. `delta` is a
 *    non-zero integer (positive or negative); `reason` is required and
 *    audit-logged verbatim (P2 spec: "audit-logged delta with reason").
 *
 * Guarded by requirePermission('gamification.manage') — super_admin/
 * main_admin only (no sub-role preset carries this key).
 */

const postSchema = z.object({
  accountId: z.string().trim().min(1),
  delta: z.number().int().refine((n) => n !== 0, { message: 'delta must be non-zero' }),
  reason: z.string().trim().min(1).max(500),
});

const listQuerySchema = z.object({
  accountId: z.string().trim().min(1).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'gamification.manage');
  if (principal instanceof Response) return principal;

  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
    accountId: url.searchParams.get('accountId') ?? undefined,
  });
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();
  const where = parsed.data.accountId
    ? and(eq(xpEvents.kind, 'admin_correction'), eq(xpEvents.accountId, parsed.data.accountId))
    : eq(xpEvents.kind, 'admin_correction');

  const corrections = await db
    .select({
      id: xpEvents.id,
      accountId: xpEvents.accountId,
      accountEmail: accounts.email,
      accountName: accounts.displayName,
      amount: xpEvents.amount,
      createdAt: xpEvents.createdAt,
    })
    .from(xpEvents)
    .leftJoin(accounts, eq(accounts.id, xpEvents.accountId))
    .where(where)
    .orderBy(desc(xpEvents.createdAt))
    .limit(100);

  return json({ corrections }, 200);
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'gamification.manage');
  if (principal instanceof Response) return principal;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { accountId, delta, reason } = parsed.data;

  const db = getDb();
  const accountRows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (accountRows.length === 0) return json({ error: 'not_found' }, 404);

  await db.insert(xpEvents).values({
    accountId,
    kind: 'admin_correction',
    sourceKey: crypto.randomUUID(),
    amount: delta,
  });

  await logAudit(
    principal,
    'gamification.xp_correct',
    'account',
    accountId,
    { delta, reason },
    clientIp(req),
  );

  // Recompute the cache immediately so the console's response reflects the
  // correction without waiting for the account's next sync/GET.
  let xpTotal: number | null = null;
  try {
    const result = await runAwardEngineOrThrow(accountId);
    xpTotal = result.profile.xpTotal;
  } catch (err) {
    console.error('[gamification] award-engine refresh after correction failed', err);
  }

  return json({ accountId, delta, xpTotal }, 201);
}
