import { z } from 'zod';
import { BASE_URL, fetchWithTimeout } from '../../lib/api/client';

/**
 * Saved delivery-address book client (Pack P) — `apps/web/src/app/api/meals/
 * addresses/route.ts` already exists (pre-dates this package) with a full
 * GET/POST/PATCH/DELETE CRUD contract; this is simply its first mobile
 * client (Settings never surfaced an address book before). Kept in its own
 * feature module, same discipline as features/support/api.ts.
 */

const REQUEST_TIMEOUT_MS = 15_000;

export type AddressApiErrorCode = 'unauthorized' | 'not_found' | 'invalid' | 'network';

export class AddressApiError extends Error {
  readonly code: AddressApiErrorCode;
  constructor(code: AddressApiErrorCode) {
    super(code);
    this.name = 'AddressApiError';
    this.code = code;
  }
}

export function toAddressError(err: unknown): AddressApiError {
  return err instanceof AddressApiError ? err : new AddressApiError('network');
}

function statusToCode(status: number): AddressApiErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 400) return 'invalid';
  return 'network';
}

async function call(opts: {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  token: string;
  body?: Record<string, unknown>;
}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${BASE_URL}/api/meals/addresses`,
      {
        method: opts.method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${opts.token}`,
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : null),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      },
      REQUEST_TIMEOUT_MS,
    );
  } catch {
    throw new AddressApiError('network');
  }
  if (!res.ok) throw new AddressApiError(statusToCode(res.status));
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AddressApiError('network');
  return parsed.data;
}

const addressSchema = z.object({
  id: z.string(),
  label: z.string().catch(''),
  line: z.string(),
  area: z.string().catch(''),
  phone: z.string(),
  lat: z.number().nullable().catch(null),
  lng: z.number().nullable().catch(null),
  isDefault: z.boolean().catch(false),
});
export type SavedAddress = z.infer<typeof addressSchema>;

const addressListSchema = z.object({
  addresses: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): SavedAddress[] => {
      const parsed = addressSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});
const addressEnvelope = z.object({ address: addressSchema });
const okSchema = z.object({ ok: z.literal(true) });

/** GET → every non-deleted saved address, default first. */
export async function getSavedAddresses(token: string): Promise<SavedAddress[]> {
  const data = await call({ method: 'GET', token });
  return parse(addressListSchema, data).addresses;
}

export interface AddressInput {
  label?: string;
  line: string;
  area?: string;
  phone: string;
  isDefault?: boolean;
}

/** POST → create a new saved address; returns the fresh row. */
export async function createSavedAddress(input: AddressInput, token: string): Promise<SavedAddress> {
  const data = await call({ method: 'POST', token, body: { ...input } });
  return parse(addressEnvelope, data).address;
}

/** PATCH → partial update of an existing address by id. */
export async function updateSavedAddress(
  id: string,
  patch: Partial<AddressInput>,
  token: string,
): Promise<SavedAddress> {
  const data = await call({ method: 'PATCH', token, body: { id, ...patch } });
  return parse(addressEnvelope, data).address;
}

/** DELETE → soft-delete an address by id. */
export async function deleteSavedAddress(id: string, token: string): Promise<void> {
  const data = await call({ method: 'DELETE', token, body: { id } });
  parse(okSchema, data);
}
