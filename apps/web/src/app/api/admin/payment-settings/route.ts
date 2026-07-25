import { paymentSettings } from '@gym/db';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import {
  loadPayee,
  loadPaymentSettingsRow,
  PAYEE_FIELDS,
  PAYMENT_SETTINGS_ID,
  paymentSettingsView,
  type PaymentSettingsView,
} from '@/lib/paymentPayee';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin — the payee editor for the `payment_settings` singleton: the eSewa /
 * Khalti / bank details a member has to send money to before uploading a
 * receipt, plus an optional scan-to-pay QR.
 *
 * This closes the worst gap in the product. Manual payment is the only working
 * way to buy a membership or a meal, and every member surface said "transfer
 * first, then upload the receipt" while naming no destination at all, so the
 * instruction could not be followed. The member-facing rule now is: a rail with
 * no identifier is not offered.
 *
 *  - GET   → { settings, updatedAt, updatedBy, persisted, payee }. `settings`
 *    is the raw editable row (nulls where unset); `payee` is exactly what
 *    members see through the catalog and meal-partner routes, so the console
 *    can show the live member view next to the form.
 *  - PATCH → partial update. Any subset of fields may be sent; an omitted field
 *    keeps its current value and an empty string CLEARS it (which also retires
 *    that rail from every member surface). Upserts the singleton, stamps
 *    updatedBy/updatedAt and audits which fields changed.
 *
 * Guarded by requirePermission('pricing.manage') — the existing money-config
 * key (super/main only) that already owns the regional price catalog this
 * editor sits beside at /admin/pricing. No new permission key is introduced.
 *
 * The audit trail records WHICH fields changed and which rails ended up live,
 * never the wallet ids or the account number themselves.
 */

/** Single-line field: trimmed, bounded, and no line breaks. */
function line(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .regex(/^[^\r\n\t]*$/, 'must be a single line');
}

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https:\/\/[^\s]+$/i.test(v), {
    message: 'must be an https link',
  });

const patchSchema = z
  .object({
    esewaId: line(64).optional(),
    esewaName: line(80).optional(),
    khaltiId: line(64).optional(),
    khaltiName: line(80).optional(),
    bankName: line(80).optional(),
    bankAccountName: line(80).optional(),
    bankAccountNumber: line(40).optional(),
    qrImageUrl: httpsUrl.optional(),
    instructions: z.string().trim().max(400).optional(),
  })
  .refine((patch) => Object.values(patch).some((v) => v !== undefined), {
    message: 'at least one field is required',
  });

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'pricing.manage');
  if (principal instanceof Response) return principal;

  const [row, payee] = await Promise.all([loadPaymentSettingsRow(), loadPayee()]);
  return json(
    {
      settings: paymentSettingsView(row),
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedBy ?? null,
      persisted: Boolean(row),
      payee,
    },
    200,
  );
}

export async function PATCH(req: Request) {
  const principal = await requirePermission(req, 'pricing.manage');
  if (principal instanceof Response) return principal;

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const patch = parsed.data;
  const before = paymentSettingsView(await loadPaymentSettingsRow());

  // Merge onto the persisted row so a partial PATCH never resets a field this
  // admin never touched. An explicit empty string is a deliberate clear.
  const after: PaymentSettingsView = { ...before };
  for (const field of PAYEE_FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    after[field] = value.length > 0 ? value : null;
  }

  const changed = PAYEE_FIELDS.filter((field) => before[field] !== after[field]);

  const now = new Date();
  await getDb()
    .insert(paymentSettings)
    .values({ id: PAYMENT_SETTINGS_ID, ...after, updatedAt: now, updatedBy: principal.id })
    .onConflictDoUpdate({
      target: paymentSettings.id,
      set: { ...after, updatedAt: now, updatedBy: principal.id },
    });

  const payee = await loadPayee();
  const liveRails = payee
    ? ([payee.esewa && 'esewa', payee.khalti && 'khalti', payee.bank && 'bank'].filter(
        (rail): rail is string => typeof rail === 'string',
      ) as string[])
    : [];

  await logAudit(
    principal,
    'payments.payee.update',
    'payment_settings',
    PAYMENT_SETTINGS_ID,
    // Field NAMES only — an audit row must not become a second copy of the
    // merchant's wallet ids and bank account number.
    { changed, liveRails },
    clientIp(req),
  );

  return json(
    {
      settings: after,
      updatedAt: now.toISOString(),
      updatedBy: principal.id,
      persisted: true,
      payee,
    },
    200,
  );
}
