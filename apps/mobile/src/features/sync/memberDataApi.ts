import {
  memberDataSyncRequestSchema,
  memberDataSyncResponseSchema,
  type MemberDataSyncRequest,
  type MemberDataSyncResponse,
} from '@gym/shared';
import { BASE_URL } from '../../lib/api/client';
import { SyncApiError } from './api';

const REQUEST_TIMEOUT_MS = 12_000;

/** Authenticated, fully Zod-validated two-way member-data page. */
export async function postMemberDataSync(
  token: string,
  request: MemberDataSyncRequest,
): Promise<MemberDataSyncResponse> {
  const body = memberDataSyncRequestSchema.parse(request);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/api/sync/member-data`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new SyncApiError('network', "Can't reach the server");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 401) throw new SyncApiError('unauthorized');
    if (response.status === 400) throw new SyncApiError('invalid');
    throw new SyncApiError('network');
  }

  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    throw new SyncApiError('network', 'Unexpected server response');
  }
  const parsed = memberDataSyncResponseSchema.safeParse(payload);
  if (!parsed.success) throw new SyncApiError('network', 'Unexpected server response');
  return parsed.data;
}
