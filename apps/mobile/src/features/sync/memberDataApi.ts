import {
  memberDataChangeSchema,
  memberDataSyncCursorSchema,
  memberDataSyncRequestSchema,
  memberDataSyncResponseSchema,
  type MemberDataChange,
  type MemberDataSyncCursor,
  type MemberDataSyncRequest,
  type MemberDataSyncResponse,
} from '@gym/shared';
import { z } from 'zod';
import { BASE_URL, fetchWithTimeout } from '../../lib/api/client';
import { SyncApiError, syncStatusToCode } from './api';

const REQUEST_TIMEOUT_MS = 12_000;

const MAX_ACKNOWLEDGEMENTS = 100;
const MAX_CHANGES = 1_000;

const mutationIdSchema = z.string().uuid();

/**
 * Loose read of the response envelope, used only when the strict contract
 * rejects the body. Unknown keys are dropped rather than refused, and each
 * list is read as "some things" so the good entries can be picked out of a
 * page that also holds a bad one.
 */
const salvageEnvelopeSchema = z.object({
  ok: z.literal(true),
  acknowledgedMutationIds: z.array(z.unknown()).catch([]),
  changes: z.array(z.unknown()).catch([]),
  cursor: z.unknown(),
  hasMore: z.boolean().catch(false),
});

/**
 * Rescue what is usable from a page the strict contract turned down.
 *
 * The whole response used to be all-or-nothing: one row the server stored in a
 * shape this app refuses would sink the entire page, which means the
 * acknowledgements never arrive, writes the member made offline are pushed
 * again on every trigger and never drain, and all six cursors stop moving. The
 * queue then stays stuck for good, because nothing about retrying changes the
 * answer.
 *
 * So a body that still looks like this endpoint's answer is read row by row:
 * good rows are applied, unreadable ones are left behind, and the
 * acknowledgements come home so the member's own writes finally clear. If the
 * server's cursor is itself unusable the request's cursor is handed back
 * untouched, which re-reads this page next time instead of skipping past it.
 *
 * Returns null when the body is not this endpoint's answer at all (an error
 * page, a proxy's HTML, a truncated body) — that is a real failure and the
 * caller should treat it as one.
 */
function salvageResponse(
  payload: unknown,
  requestCursor: MemberDataSyncCursor,
): MemberDataSyncResponse | null {
  const envelope = salvageEnvelopeSchema.safeParse(payload);
  if (!envelope.success) return null;

  const acknowledgedMutationIds = envelope.data.acknowledgedMutationIds
    .filter((id): id is string => mutationIdSchema.safeParse(id).success)
    .slice(0, MAX_ACKNOWLEDGEMENTS);

  const changes: MemberDataChange[] = [];
  for (const item of envelope.data.changes) {
    if (changes.length >= MAX_CHANGES) break;
    const change = memberDataChangeSchema.safeParse(item);
    if (change.success) changes.push(change.data);
  }

  const cursor = memberDataSyncCursorSchema.safeParse(envelope.data.cursor);
  const droppedRows = envelope.data.changes.length - changes.length;
  // Quiet when the only difference was something extra in the body: a newer
  // server may send fields this build has never heard of, and ignoring them is
  // the point of reading loosely. Counts only, never the member's own values.
  if (droppedRows > 0 || !cursor.success) {
    console.warn('[sync] read a partial member-data page', {
      droppedRows,
      keptRows: changes.length,
      cursorUsable: cursor.success,
    });
  }

  return {
    ok: true,
    acknowledgedMutationIds,
    changes,
    // Without a usable cursor nothing moved forward, so promising more would
    // only spin the sync loop over the same page.
    cursor: cursor.success ? cursor.data : requestCursor,
    hasMore: cursor.success ? envelope.data.hasMore : false,
  };
}

/**
 * Authenticated, Zod-validated two-way member-data page.
 *
 * Every row that comes back is validated before it reaches the database. A
 * page the strict contract turns down is not thrown away wholesale: see
 * salvageResponse for why, and for the one case that is still a hard failure.
 */
export async function postMemberDataSync(
  token: string,
  request: MemberDataSyncRequest,
): Promise<MemberDataSyncResponse> {
  const body = memberDataSyncRequestSchema.parse(request);
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${BASE_URL}/api/sync/member-data`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      },
      REQUEST_TIMEOUT_MS,
    );
  } catch {
    throw new SyncApiError('network', "We couldn't connect. Check your connection and try again");
  }

  if (!response.ok) throw new SyncApiError(syncStatusToCode(response.status));

  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    throw new SyncApiError('network', 'Unexpected server response');
  }
  const parsed = memberDataSyncResponseSchema.safeParse(payload);
  if (parsed.success) return parsed.data;

  const salvaged = salvageResponse(payload, body.cursor);
  if (salvaged) return salvaged;
  throw new SyncApiError('network', 'Unexpected server response');
}
