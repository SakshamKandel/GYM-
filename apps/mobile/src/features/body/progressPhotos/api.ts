import { z } from 'zod';
import { BASE_URL, fetchWithTimeout } from '../../../lib/api/client';

/**
 * Private progress-photo API boundary. Signed delivery URLs only live in the
 * component's in-memory state; this module never writes them to local storage.
 */

const tierSchema = z.enum(['starter', 'silver', 'gold', 'elite']);

const progressPhotoSchema = z.object({
  id: z.string().min(1),
  takenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string(),
  createdAt: z.string().min(1),
  url: z.string().url(),
});

const createdPhotoSchema = z.object({
  photo: progressPhotoSchema.extend({ url: z.string().url().nullable() }),
});

const progressPhotoListSchema = z.object({ photos: z.array(progressPhotoSchema) });
const deleteSchema = z.object({ ok: z.literal(true) });
const errorSchema = z.object({
  error: z.string(),
  requiredTier: tierSchema.optional(),
});

const createInputSchema = z.object({
  takenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  uid: z
    .string()
    .regex(/^progress_photo\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  note: z.string().trim().max(300).optional(),
});

export type ProgressPhoto = z.infer<typeof progressPhotoSchema>;
export type CreatedProgressPhoto = z.infer<typeof createdPhotoSchema>['photo'];

export type ProgressPhotoErrorCode =
  | 'unauthorized'
  | 'locked'
  | 'invalid'
  | 'not_found'
  | 'image_not_configured'
  | 'image_delete_failed'
  | 'network';

export class ProgressPhotoApiError extends Error {
  readonly code: ProgressPhotoErrorCode;

  constructor(code: ProgressPhotoErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ProgressPhotoApiError';
    this.code = code;
  }
}

function knownErrorCode(raw: string): ProgressPhotoErrorCode | null {
  switch (raw) {
    case 'unauthorized':
    case 'locked':
    case 'invalid':
    case 'not_found':
    case 'image_not_configured':
    case 'image_delete_failed':
      return raw;
    default:
      return null;
  }
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ProgressPhotoApiError('network', 'Unexpected server response');
  }
}

async function request(
  token: string,
  path: string,
  init: { method: 'GET' | 'POST' | 'DELETE'; body?: Record<string, unknown> },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${BASE_URL}${path}`, {
      method: init.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : null),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ProgressPhotoApiError('network', "Can't reach the server");
  }

  const payload = await readResponseJson(response);
  if (response.ok) return payload;

  const parsed = errorSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ProgressPhotoApiError('network', 'Unexpected server response');
  }
  const code = knownErrorCode(parsed.data.error);
  if (code) throw new ProgressPhotoApiError(code);
  if (response.status === 401) throw new ProgressPhotoApiError('unauthorized');
  throw new ProgressPhotoApiError('network');
}

function parsePayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ProgressPhotoApiError('network', 'Unexpected server response');
  }
  return parsed.data;
}

/** GET own photos. The server returns them newest first; sort defensively too. */
export async function listProgressPhotos(token: string): Promise<ProgressPhoto[]> {
  const payload = await request(token, '/api/me/photos', { method: 'GET' });
  const photos = parsePayload(progressPhotoListSchema, payload).photos;
  return [...photos].sort((a, b) => {
    const byTakenOn = b.takenOn.localeCompare(a.takenOn);
    return byTakenOn !== 0 ? byTakenOn : b.createdAt.localeCompare(a.createdAt);
  });
}

/** Persist an already-uploaded private Cloudinary uid against this account. */
export async function createProgressPhoto(
  token: string,
  input: { takenOn: string; uid: string; note?: string },
): Promise<CreatedProgressPhoto> {
  const parsedInput = createInputSchema.safeParse(input);
  if (!parsedInput.success) throw new ProgressPhotoApiError('invalid');
  const payload = await request(token, '/api/me/photos', {
    method: 'POST',
    body: parsedInput.data,
  });
  return parsePayload(createdPhotoSchema, payload).photo;
}

/** Delete one owner-scoped row and its private provider asset. */
export async function deleteProgressPhoto(token: string, id: string): Promise<void> {
  const payload = await request(token, `/api/me/photos/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  parsePayload(deleteSchema, payload);
}
