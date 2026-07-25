import { paymentSettings } from '@gym/db';
import { eq } from 'drizzle-orm';
import { getDb } from './db';

/**
 * The payee side of the manual-payment rails: WHERE a member sends money before
 * uploading a receipt.
 *
 * One singleton `payment_settings` row backs every surface. This module owns the
 * single projection of that row that member-facing routes are allowed to return
 * (GET /api/subscription/catalog and GET /api/meals/partners), so the two can
 * never drift apart or leak a column the console adds later.
 *
 * The honesty rule this encodes: a rail is only advertised when its own
 * identifier is present. A blank eSewa id means no eSewa option at all, not an
 * eSewa option pointing nowhere. `qrImageUrl` and `instructions` are extras and
 * never make a rail payable on their own, so `loadPayee` returns null when no
 * identifier is set even if the QR is.
 */

/** The one row id — this table holds exactly one row, like meal_delivery_config. */
export const PAYMENT_SETTINGS_ID = 'singleton';

export interface PayeeWallet {
  /** Wallet id money is sent to (an eSewa/Khalti mobile number). */
  id: string;
  /** Registered holder name, so the member can check it before sending. */
  name: string | null;
}

export interface PayeeBank {
  bankName: string | null;
  accountName: string;
  accountNumber: string;
}

/** Read-only payee projection returned to signed-in members. */
export interface PayeeDetails {
  esewa: PayeeWallet | null;
  khalti: PayeeWallet | null;
  bank: PayeeBank | null;
  qrImageUrl: string | null;
  instructions: string | null;
}

/** The editable columns, in the order the console renders them. */
export const PAYEE_FIELDS = [
  'esewaId',
  'esewaName',
  'khaltiId',
  'khaltiName',
  'bankName',
  'bankAccountName',
  'bankAccountNumber',
  'qrImageUrl',
  'instructions',
] as const;

export type PayeeField = (typeof PAYEE_FIELDS)[number];

/** Raw editable values, nulls where unset — what the console form binds to. */
export type PaymentSettingsView = Record<PayeeField, string | null>;

const EMPTY_VIEW: PaymentSettingsView = {
  esewaId: null,
  esewaName: null,
  khaltiId: null,
  khaltiName: null,
  bankName: null,
  bankAccountName: null,
  bankAccountNumber: null,
  qrImageUrl: null,
  instructions: null,
};

/** The singleton row, or undefined when it has never been saved. */
export async function loadPaymentSettingsRow(): Promise<
  typeof paymentSettings.$inferSelect | undefined
> {
  const rows = await getDb()
    .select()
    .from(paymentSettings)
    .where(eq(paymentSettings.id, PAYMENT_SETTINGS_ID))
    .limit(1);
  return rows[0];
}

/** Row → the flat editable projection (all nulls on a fresh install). */
export function paymentSettingsView(
  row: typeof paymentSettings.$inferSelect | undefined,
): PaymentSettingsView {
  const view: PaymentSettingsView = { ...EMPTY_VIEW };
  if (!row) return view;
  for (const field of PAYEE_FIELDS) view[field] = row[field] ?? null;
  return view;
}

/** Blank-safe trim: '' / '   ' / null all collapse to null. */
function clean(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function wallet(id: string | null, name: string | null): PayeeWallet | null {
  const walletId = clean(id);
  return walletId ? { id: walletId, name: clean(name) } : null;
}

function bank(
  bankName: string | null,
  accountName: string | null,
  accountNumber: string | null,
): PayeeBank | null {
  const name = clean(accountName);
  const number = clean(accountNumber);
  if (!name || !number) return null;
  return { bankName: clean(bankName), accountName: name, accountNumber: number };
}

/**
 * The member-visible payee, or null when nothing payable is configured.
 *
 * Null is the signal every member surface uses to hide the manual-payment
 * option entirely (and say so in one line) instead of asking for a transfer to
 * nobody. Failing to read the row is treated the same way — never invent a
 * destination for money.
 */
export async function loadPayee(): Promise<PayeeDetails | null> {
  let row: typeof paymentSettings.$inferSelect | undefined;
  try {
    row = await loadPaymentSettingsRow();
  } catch (err) {
    console.error('payment settings lookup failed:', err);
    return null;
  }
  if (!row) return null;

  const details: PayeeDetails = {
    esewa: wallet(row.esewaId, row.esewaName),
    khalti: wallet(row.khaltiId, row.khaltiName),
    bank: bank(row.bankName, row.bankAccountName, row.bankAccountNumber),
    qrImageUrl: clean(row.qrImageUrl),
    instructions: clean(row.instructions),
  };

  const payable = details.esewa !== null || details.khalti !== null || details.bank !== null;
  return payable ? details : null;
}
