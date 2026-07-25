import { useCallback } from 'react';
import { z } from 'zod';
import { useSessionScopedResource } from '../useSessionScopedResource';
import { BASE_URL } from './client';
import { supportsRail, type Payee, type PayeeWallet } from './payeeLogic';

export {
  availableRails,
  payableRails,
  PAYEE_RAILS,
  supportsRail,
  type Payee,
  type PayeeBank,
  type PayeeRail,
  type PayeeWallet,
} from './payeeLogic';

/**
 * Where a member sends money before uploading a receipt.
 *
 * Manual payment is the only working way to buy a membership or a meal, and
 * every one of those screens used to say "transfer first, then upload the
 * receipt" while naming no wallet, account or QR — an instruction nobody could
 * follow. The server now publishes the configured payee read-only on the two
 * routes those screens already call:
 *
 *   - membership → GET /api/subscription/catalog  (`payee`)
 *   - meals      → GET /api/meals/partners        (`payee`)
 *
 * `null` is a first-class answer and means NO rail is configured. Every caller
 * must then hide the manual-payment option and say so in one line rather than
 * asking for a transfer to nobody. An older server that doesn't send the key at
 * all reads the same way, so a stale API can never invent a destination.
 *
 * Kept out of the two feature modules on purpose: both meals and subscription
 * need it, and feature modules never import each other.
 */

const walletSchema = z.object({
  /** Wallet id money is sent to (an eSewa/Khalti mobile number). */
  id: z.string().min(1),
  /** Registered holder name, when the operator filled it in. */
  name: z.string().nullish(),
});

const bankSchema = z.object({
  bankName: z.string().nullish(),
  accountName: z.string().min(1),
  accountNumber: z.string().min(1),
});

const payeeSchema = z.object({
  esewa: walletSchema.nullish(),
  khalti: walletSchema.nullish(),
  bank: bankSchema.nullish(),
  /** Optional scan-to-pay image. */
  qrImageUrl: z.string().nullish(),
  /** Optional extra line from the operator. */
  instructions: z.string().nullish(),
});

/** Envelope shape shared by both routes — everything else is ignored here. */
const envelopeSchema = z.object({ payee: payeeSchema.nullish() });

function wallet(raw: z.infer<typeof walletSchema> | null | undefined): PayeeWallet | null {
  return raw ? { id: raw.id, name: raw.name ?? null } : null;
}

function normalize(raw: z.infer<typeof payeeSchema>): Payee | null {
  const payee: Payee = {
    esewa: wallet(raw.esewa),
    khalti: wallet(raw.khalti),
    bank: raw.bank
      ? {
          bankName: raw.bank.bankName ?? null,
          accountName: raw.bank.accountName,
          accountNumber: raw.bank.accountNumber,
        }
      : null,
    qrImageUrl: raw.qrImageUrl ?? null,
    instructions: raw.instructions ?? null,
  };
  // A QR or an extra line on its own names no destination, so it can never make
  // a rail payable — same rule the server applies before sending this.
  const payable =
    supportsRail(payee, 'esewa') || supportsRail(payee, 'khalti') || supportsRail(payee, 'bank');
  return payable ? payee : null;
}

/**
 * One-element list, or an empty one when nothing is configured — the shape
 * useSessionScopedResource wants, and the distinction the screens need:
 * `null` data means "still loading", `[]` means "loaded, no rail configured".
 */
async function fetchPayee(token: string, path: string): Promise<Payee[]> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`payee_${res.status}`);
  const body: unknown = await res.json();
  const parsed = envelopeSchema.safeParse(body);
  // A response we can't read is treated as "nothing configured", never as a
  // half-parsed destination.
  if (!parsed.success || !parsed.data.payee) return [];
  const payee = normalize(parsed.data.payee);
  return payee ? [payee] : [];
}

export function fetchMembershipPayee(token: string): Promise<Payee[]> {
  return fetchPayee(token, '/api/subscription/catalog');
}

export function fetchMealsPayee(token: string): Promise<Payee[]> {
  return fetchPayee(token, '/api/meals/partners');
}

export interface PayeeState {
  /** null while loading AND when nothing is configured — check `loading` too. */
  payee: Payee | null;
  loading: boolean;
  error: boolean;
}

/** Payment details change about never, so a cached copy is good for 5 minutes. */
const PAYEE_STALE_MS = 5 * 60 * 1000;

/**
 * Load the payee for one surface. `source` picks which existing route answers;
 * both return the same singleton, so a member never sees two different
 * destinations for the same money.
 */
export function usePayee(token: string | null, source: 'membership' | 'meals'): PayeeState {
  const fetcher = useCallback(
    (t: string) => (source === 'meals' ? fetchMealsPayee(t) : fetchMembershipPayee(t)),
    [source],
  );
  const { data, loading, error } = useSessionScopedResource(token, fetcher, {
    key: `payments:payee:${source}`,
    staleMs: PAYEE_STALE_MS,
  });
  return { payee: data?.[0] ?? null, loading, error };
}
