import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

export const PROGRESS_PHOTO_RESERVATION_TTL_MS = 60 * 60 * 1000;

/**
 * Network-boundary schema for attaching a direct upload. The client never
 * chooses the provider UID; it only returns the opaque reservation id issued
 * by this server.
 */
export function progressPhotoCreateSchema(today: string) {
  return z
    .object({
      takenOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine((value) => {
          const parsed = new Date(`${value}T00:00:00.000Z`);
          return (
            !Number.isNaN(parsed.getTime()) &&
            parsed.toISOString().slice(0, 10) === value &&
            value <= today
          );
        }),
      reservationId: z.string().uuid(),
      note: z.string().trim().max(300).optional(),
    })
    .strict();
}

export interface AtomicProgressPhotoClaim {
  photoId: string;
  reservationId: string;
  accountId: string;
  takenOn: string;
  note: string;
}

/**
 * Consume a progress-photo upload reservation and create its owner-scoped row
 * in one PostgreSQL statement. An expired, foreign, already-claimed, or racing
 * reservation produces zero rows, so no client-supplied UID can cross this
 * trust boundary.
 */
export function atomicProgressPhotoClaimSql(args: AtomicProgressPhotoClaim): SQL {
  return sql`
    with claimed_upload as (
      update image_upload_reservations
      set claimed_at = now()
      where id = ${args.reservationId}
        and account_id = ${args.accountId}
        and kind = 'progress_photo'
        and claimed_at is null
        and expires_at > now()
      returning asset_uid
    ),
    inserted_photo as (
      insert into progress_photos (
        id, account_id, taken_on, image_url, note
      )
      select
        ${args.photoId}, ${args.accountId}, ${args.takenOn},
        claimed_upload.asset_uid, ${args.note}
      from claimed_upload
      on conflict (image_url) do nothing
      returning id, taken_on, note, created_at, image_url
    )
    select id, taken_on, note, created_at, image_url
    from inserted_photo
  `;
}
