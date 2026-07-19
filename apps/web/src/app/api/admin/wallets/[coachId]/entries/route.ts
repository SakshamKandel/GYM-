import { accounts, admins, coachProfiles, walletLedger } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { coachWalletBalances, recordWalletEntry } from '@/lib/promoEconomy';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin console — record a manual wallet_ledger entry for one coach
 * (SCALE-UP-PLAN §4.1 / §5.4): an adjustment (correction, either sign, never
 * zero) or a payout (money actually paid out to the coach — represented as a
 * NEGATIVE amount, since the eSewa/Khalti disbursement itself happens outside
 * the app per §9's out-of-scope list; this just records that it happened).
 *
 *  - POST {type:'adjustment'|'payout', amountMinor, currency, note?} → 201.
 *    `commission` entries are never created here — those are exclusively
 *    settlePromoOnPurchase's job.
 *
 * Guarded by requirePermission('wallet.manage'); super_admin/main_admin pass.
 */

const bodySchema = z
  .object({
    type: z.enum(['adjustment', 'payout']),
    amountMinor: z.number().int(),
    // Currency is a fixed enum, not free text (E7): a typo like 'NPRR' would
    // otherwise mint a phantom balance bucket that fragments the coach's real
    // balance so a genuine payout can never reconcile.
    currency: z.enum(['NPR', 'USD']),
    note: z.string().trim().max(500).optional(),
    // Escape hatch to record a payout that exceeds the tracked balance (e.g.
    // reconciling a pre-app disbursement); off by default so the floor holds.
    override: z.boolean().optional(),
    // Optional idempotency key: a double-clicked or network-retried payout/
    // adjustment carrying the same key records ONE ledger row instead of
    // double-deducting the coach's tracked balance (manual entries otherwise
    // land with NULL source and never dedup against each other).
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => (v.type === 'payout' ? v.amountMinor < 0 : v.amountMinor !== 0), {
    message: 'payout must be negative; adjustment must be non-zero',
    path: ['amountMinor'],
  });

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ coachId: string }> }) {
  const principal = await requirePermission(req, 'wallet.manage');
  if (principal instanceof Response) return principal;

  const { coachId } = await params;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { type, amountMinor, currency, note, override, idempotencyKey } = parsed.data;

  const db = getDb();
  // Resolve the coach off any account that IS currently role='coach', HAS a
  // coach profile, OR appears in wallet_ledger history (P0-4). Gating on the
  // live `admins.role` alone 404'd every REVOKED coach (E10 / C2 offboarding
  // cascade), making a final settlement payout impossible — the exact flow the
  // wallet roster unions revoked coaches back in for. Mirrors the roster filter
  // in wallets/page.tsx and the sibling GET route's account-scoped resolution.
  const [resolved] = await db
    .select({
      id: accounts.id,
      role: admins.role,
      profileId: coachProfiles.accountId,
    })
    .from(accounts)
    .leftJoin(admins, eq(admins.accountId, accounts.id))
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .where(eq(accounts.id, coachId))
    .limit(1);
  if (!resolved) return json({ error: 'coach_not_found' }, 404);

  let eligible = resolved.role === 'coach' || resolved.profileId != null;
  if (!eligible) {
    // Last resort: a coach whose profile was also torn down still owns their
    // ledger balance. Any historical wallet row makes them a valid payout target.
    const [ledgerRow] = await db
      .select({ id: walletLedger.id })
      .from(walletLedger)
      .where(eq(walletLedger.coachId, coachId))
      .limit(1);
    eligible = ledgerRow != null;
  }
  if (!eligible) return json({ error: 'coach_not_found' }, 404);

  // Payout balance floor (E7): a payout must not drive the coach's balance in
  // that currency negative — over-paid money is unrecoverable in-app. The floor
  // is now enforced ATOMICALLY inside recordWalletEntry (enforceFloor) so two
  // concurrent payouts can't both read the same balance and race past it.
  // override:true records a reconciling payout beyond the balance.
  const result = await recordWalletEntry({
    coachId,
    type,
    amountMinor,
    currency,
    note: note ?? null,
    createdBy: principal.id,
    enforceFloor: type === 'payout' && !override,
    sourceType: idempotencyKey ? 'admin_manual' : null,
    sourceId: idempotencyKey ?? null,
  });

  if (!result.ok) {
    const balances = await coachWalletBalances(coachId);
    const current = balances.find((b) => b.currency === currency)?.amountMinor ?? 0;
    return json({ error: 'insufficient_balance', balanceMinor: current, currency }, 409);
  }

  const { entry, duplicate } = result;

  // A deduped replay is a no-op — don't write a second audit row for it.
  if (!duplicate) {
    await logAudit(
      principal,
      'wallet.adjust',
      'wallet_ledger',
      entry.id,
      { coachId, type, amountMinor, currency: entry.currency },
      clientIp(req),
    );
  }

  return json({ entry }, duplicate ? 200 : 201);
}
