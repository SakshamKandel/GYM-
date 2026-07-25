import {
  adminPermissionOverrides,
  admins,
  mealPartners,
  notificationPrefs,
  notifications,
} from '@gym/db';
import {
  KTM_OFFSET_MINUTES,
  effectivePermissionsForRole,
  notificationDelivery,
  type NotificationEvent,
  type NotificationPrefs,
  type Permission,
  type StaffRole,
} from '@gym/shared';
import { eq, sql } from 'drizzle-orm';
import { bearerToken, userForToken } from './auth';
import { getDb } from './db';
import { sendPushToAccount } from './push';
import { staffFromCookie } from './staffSession';

/**
 * lib/notify.ts — the SINGLE notification dispatch point (Pack B / WP-2). Every
 * business route imports `notify(...)` and calls it fire-and-forget:
 *
 *     void notify('order_placed_partner', { partnerId }, { title, body, data });
 *
 * It is best-effort and NEVER throws (§7.1) — the inbox insert and the FCM send
 * both live inside its own try/catch, so a Neon pool blip or an FCM outage can
 * never fail the business mutation that triggered it. MUST NOT be `await`ed on a
 * route's critical path.
 *
 * Pipeline per recipient (§8.2):
 *   1. resolve recipients: {accountId} | {role,permission}→fan-out | {partnerId}→owner
 *   2. load notification_prefs (a missing row / key = enabled — default all-on)
 *   3. category disabled? → drop entirely (no inbox, no push)
 *   4. dedupeKey set + already used? → no-op (partial-unique idempotency)
 *   5. INSERT the notifications row FIRST (durable outbox), already stamped
 *      `sentAt = now` — the row records the ATTEMPT, not the outcome
 *   6. quiet hours? → inbox only, the row is already resolved (no late-push
 *      storm). The window is Nepal wall-clock for everyone — see ktmMinuteOfDay
 *   7. send push → on success/no-recipient the row is already correct; ONLY on a
 *      transient error is `sentAt` reverted to null, handing the row to the
 *      `retry-unsent` cron.
 *
 * Feature flags (§9.1): NOTIF_PREFS_ENFORCED (default on) gates steps 2/3/6;
 * set to 'false' to force inbox+push for every event (used only to debug a
 * suspected prefs bug in prod).
 */

/**
 * Deep-link payload carried on a notification (mobile routes on `data.type`).
 *
 * The open string index is deliberate: several senders carry a route-specific
 * key alongside `type` (`badgeId`, `checkInId`, `orderId`, `status`, …) that
 * SHIPPED mobile builds already read. FCM data payloads are string→string, and
 * the mobile inbox parses `data` as an open record, so extra keys are additive
 * and safe — but every value must stay a string.
 */
export interface NotifyData {
  /** Deep-link key WP-14's switch maps to a route ('order'|'cycle'|'tier'|…). */
  type: string;
  /** The target row id for that route (order id, cycle id, …). */
  id?: string;
  /** Route-specific extras (all string-valued; `undefined` keys are dropped). */
  [key: string]: string | undefined;
}

/** The server-templated content of a notification (§7.2-S2: never client text). */
export interface NotifyPayload {
  title: string;
  body: string;
  data?: NotifyData;
}

/**
 * Who receives the notification:
 *  - `{ accountId }`             — one specific account (member OR staff).
 *  - `{ role:'staff', permission }` — fan out to EVERY staff account whose
 *                                   effective permission set holds `permission`.
 *  - `{ partnerId }`             — the owning account of a meal partner.
 */
export type NotifyTarget =
  | { accountId: string }
  | { role: 'staff'; permission: Permission }
  | { partnerId: string };

/** Optional delivery controls. */
export interface NotifyOptions {
  /**
   * At-least-once idempotency key (cron / retry-prone senders). A re-run or a
   * double-fire that reuses the key is a no-op via the `notifications_dedupe`
   * partial unique. Build with `cronDedupeKey(event, accountId, scope)`.
   */
  dedupeKey?: string;
}

/** Is per-account preference + quiet-hours gating enforced? (default: yes). */
function prefsEnforced(): boolean {
  return process.env.NOTIF_PREFS_ENFORCED !== 'false';
}

/**
 * Current minute-of-day (0-1439) in Nepal's fixed UTC+05:45 wall-clock.
 *
 * THIS IS THE CLOCK QUIET HOURS ARE MEASURED ON, FOR EVERY MEMBER ON EARTH.
 * There is no per-account time zone anywhere in the schema, so a member in
 * London who sets "quiet from 10 PM" is silenced 22:00-07:00 Kathmandu, i.e.
 * roughly 16:15-01:15 their own evening — pushes land in the middle of their
 * night and go quiet through their afternoon.
 *
 * Half of that is now honest: the mobile prefs screen labels the window
 * "Nepal time" instead of printing bare hours that read as local. The real fix
 * needs a stored zone — `notification_prefs.time_zone` (IANA name, captured
 * from the device) — after which this function must resolve the recipient's
 * own minute-of-day and fall back to Nepal only when the column is null. Do
 * NOT quietly reinterpret the existing start/end minutes as local before that
 * column exists; today's values were chosen against this clock.
 */
export function ktmMinuteOfDay(now: Date): number {
  const totalMinutes = Math.floor(now.getTime() / 60_000) + KTM_OFFSET_MINUTES;
  return ((totalMinutes % 1440) + 1440) % 1440;
}

/** The recipient's stored prefs, or null when they have no row yet (all-on). */
async function loadPrefs(accountId: string): Promise<NotificationPrefs | null> {
  const rows = await getDb()
    .select({
      categories: notificationPrefs.categories,
      quietHoursStart: notificationPrefs.quietHoursStart,
      quietHoursEnd: notificationPrefs.quietHoursEnd,
    })
    .from(notificationPrefs)
    .where(eq(notificationPrefs.accountId, accountId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    categories: (row.categories ?? {}) as NotificationPrefs['categories'],
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
  };
}

/**
 * Every staff account whose EFFECTIVE permission set (role preset merged with
 * per-account overrides) holds `perm`. Mirrors `authz.effectivePermissionSet`'s
 * rules exactly: super_admin AND main_admin are safety-floored (they hold every
 * permission and can never be stripped), everyone else is the preset ± overrides.
 * Staff counts are small, so this is two bounded queries, not N.
 */
async function staffAccountIdsWithPermission(perm: Permission): Promise<string[]> {
  const db = getDb();
  const staffRows = await db
    .select({ accountId: admins.accountId, role: admins.role })
    .from(admins);
  if (staffRows.length === 0) return [];

  const overrideRows = await db
    .select({
      accountId: adminPermissionOverrides.accountId,
      perm: adminPermissionOverrides.perm,
      allow: adminPermissionOverrides.allow,
    })
    .from(adminPermissionOverrides);
  const overridesByAccount = new Map<string, Map<Permission, boolean>>();
  for (const row of overrideRows) {
    const map = overridesByAccount.get(row.accountId) ?? new Map<Permission, boolean>();
    map.set(row.perm as Permission, row.allow);
    overridesByAccount.set(row.accountId, map);
  }

  const out: string[] = [];
  for (const staff of staffRows) {
    const role = staff.role as StaffRole;
    // Safety floor: top two tiers always hold every permission (never stripped).
    if (role === 'super_admin' || role === 'main_admin') {
      out.push(staff.accountId);
      continue;
    }
    const overrides = overridesByAccount.get(staff.accountId) ?? new Map<Permission, boolean>();
    if (effectivePermissionsForRole(role, overrides).includes(perm)) {
      out.push(staff.accountId);
    }
  }
  return out;
}

/** Resolve a target to the concrete set of recipient account ids. */
async function resolveRecipients(target: NotifyTarget): Promise<string[]> {
  if ('accountId' in target) return [target.accountId];
  if ('partnerId' in target) {
    const rows = await getDb()
      .select({ accountId: mealPartners.accountId })
      .from(mealPartners)
      .where(eq(mealPartners.id, target.partnerId))
      .limit(1);
    const accountId = rows[0]?.accountId;
    return accountId ? [accountId] : [];
  }
  return staffAccountIdsWithPermission(target.permission);
}

/**
 * Run the full pipeline for ONE recipient. Throws only inward — `notify`'s loop
 * wraps each call so one bad recipient never blocks the rest.
 */
async function deliverToAccount(
  accountId: string,
  event: NotificationEvent,
  payload: NotifyPayload,
  dedupeKey: string | undefined,
): Promise<void> {
  const db = getDb();

  // Steps 2-3 + 6: the prefs/quiet-hours decision (or forced-on when disabled).
  const delivery = prefsEnforced()
    ? notificationDelivery(await loadPrefs(accountId), event, ktmMinuteOfDay(new Date()))
    : { writeInbox: true, sendPush: true };

  if (!delivery.writeInbox) {
    // Category disabled → drop entirely (no inbox row, no push).
    console.log(`[notify] suppressed(prefs) event=${event} account=${accountId}`);
    return;
  }

  // Step 5: durable outbox row FIRST, written ALREADY RESOLVED (sentAt=now) —
  // the row records the ATTEMPT, not the outcome.
  //
  // Stamping before the send is what makes retry-unsent safe. If the row only
  // became resolved AFTER a successful FCM call, then a crash / timeout / failed
  // UPDATE in the window between "FCM accepted the message" and "sentAt written"
  // leaves a delivered push behind a null sentAt — and the cron re-delivers an
  // identical push, so the member sees it twice. Nothing downstream can tell the
  // two cases apart, because FCM has already fanned the message out.
  //
  // Inverting it makes the only observable failure mode the safe one: a push we
  // KNOW was not accepted is reverted to null below and retried; anything we are
  // unsure about stays stamped and is never re-sent. Quiet-hours rows land in the
  // same resolved state for the same reason (no end-of-window storm) — the inbox
  // row is the durable record either way.
  const values = {
    accountId,
    event,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? null,
    dedupeKey: dedupeKey ?? null,
    sentAt: new Date(),
  };

  let insertedId: string | null;
  if (dedupeKey) {
    // Step 4: at-least-once idempotency — a reused key inserts 0 rows.
    const inserted = await db
      .insert(notifications)
      .values(values)
      .onConflictDoNothing({
        target: notifications.dedupeKey,
        where: sql`${notifications.dedupeKey} is not null`,
      })
      .returning({ id: notifications.id });
    insertedId = inserted[0]?.id ?? null;
    if (!insertedId) {
      // Duplicate — a prior run already delivered this. No-op.
      return;
    }
  } else {
    const inserted = await db
      .insert(notifications)
      .values(values)
      .returning({ id: notifications.id });
    insertedId = inserted[0]?.id ?? null;
  }

  if (!delivery.sendPush) {
    // Quiet hours — inbox row is written, push suppressed, already resolved.
    console.log(`[notify] suppressed(quiet) event=${event} account=${accountId}`);
    return;
  }

  // Step 7: dispatch the push. `event` rides in data so the mobile deep-link
  // switch (WP-14) and the notification center can key on it.
  const dispatch = await sendPushToAccount(accountId, {
    title: payload.title,
    body: payload.body,
    data: { ...(payload.data ?? {}), event },
  });

  if (dispatch === 'sent' || dispatch === 'no_recipient') {
    // The row was already stamped at insert — nothing to write.
    console.log(`[notify] sent(${dispatch}) event=${event} account=${accountId}`);
    return;
  }

  // Transient failure — this is the ONLY case we know for certain never reached
  // FCM, so un-resolve the row and hand it to the retry-unsent cron. If this
  // revert itself fails the row stays stamped and is simply never retried: the
  // inbox row still exists, and a missed push beats a duplicate one.
  if (insertedId) {
    await db.update(notifications).set({ sentAt: null }).where(eq(notifications.id, insertedId));
  }
  console.warn(`[notify] unsent event=${event} account=${accountId} — awaiting retry`);
}

/**
 * Dispatch a notification. Best-effort, NEVER throws (§7.1). Fire-and-forget:
 *
 *     void notify(event, target, payload);
 *
 * §7.2-S2 (injection defense): `payload.title`/`body` are SERVER-TEMPLATED at
 * the call-site. When a notification echoes user-authored free text into a
 * PRIVILEGED recipient's message (staff / partner / coach), the call-site MUST
 * `maskPii` it and attribute it ("Member note: …") — never present it as
 * platform-authored. `notify` stores/sends verbatim what it is handed.
 */
export async function notify(
  event: NotificationEvent,
  target: NotifyTarget,
  payload: NotifyPayload,
  options?: NotifyOptions,
): Promise<void> {
  try {
    // Whether a dedupe key is namespaced per recipient is decided by the TARGET
    // SHAPE, never by how many recipients it happens to resolve to right now.
    // Keying off the count was silently wrong for fan-outs: a staff target that
    // resolved to ONE admin used the bare key, so the day a second admin was
    // hired the same key resolved to two accounts, the first insert took the
    // global partial-unique and the second was swallowed as a "duplicate" — the
    // new admin simply never got the notification, and no retry could fix it.
    //
    // `{accountId}` addresses exactly one account by construction, so its key is
    // stable forever (and existing cron keys keep working across this change).
    // Every fan-out shape is namespaced unconditionally, at any cardinality.
    const namespacePerRecipient = !('accountId' in target);

    const recipients = await resolveRecipients(target);
    if (recipients.length === 0) return;

    for (const accountId of recipients) {
      const key = options?.dedupeKey
        ? namespacePerRecipient
          ? `${options.dedupeKey}:${accountId}`
          : options.dedupeKey
        : undefined;
      try {
        await deliverToAccount(accountId, event, payload, key);
      } catch (err) {
        // One recipient's failure must not block the others or the caller.
        console.error(`[notify] delivery failed event=${event} account=${accountId}`, err);
      }
    }
  } catch (err) {
    console.error(`[notify] dispatch failed event=${event}`, err);
  }
}

/**
 * Re-dispatch a single already-persisted notification row (used by the
 * `retry-unsent` cron). Returns whether the row is now resolved (its `sentAt`
 * should be stamped). Never throws.
 */
export async function redispatch(row: {
  accountId: string;
  event: string;
  title: string;
  body: string;
  data: NotifyData | null;
}): Promise<boolean> {
  try {
    // Re-evaluate prefs + quiet hours at RETRY time. The original dispatch may
    // have failed at FCM during open hours; hours later (RETRY_WINDOW_MS = 24h)
    // the recipient can now be inside their quiet window, so a blind re-push
    // would violate the quiet-hours guarantee. Mirror deliverToAccount step 6:
    // when push is suppressed, resolve the row (inbox is the durable record) and
    // report success so retry-unsent stamps sentAt and stops re-attempting — no
    // late-push storm, no infinite retry.
    if (prefsEnforced()) {
      const delivery = notificationDelivery(
        await loadPrefs(row.accountId),
        row.event as NotificationEvent,
        ktmMinuteOfDay(new Date()),
      );
      if (!delivery.sendPush) {
        console.log(`[notify] redispatch suppressed(quiet/prefs) event=${row.event} account=${row.accountId}`);
        return true;
      }
    }
    const dispatch = await sendPushToAccount(row.accountId, {
      title: row.title,
      body: row.body,
      data: { ...(row.data ?? {}), event: row.event },
    });
    return dispatch === 'sent' || dispatch === 'no_recipient';
  } catch (err) {
    console.error(`[notify] redispatch failed account=${row.accountId}`, err);
    return false;
  }
}

/**
 * Resolve the calling account for the notification-center + prefs routes.
 * Accepts EITHER a mobile/API `Authorization: Bearer` token (member OR staff —
 * both are accounts) or the web console's `gt_staff` httpOnly cookie. Returns
 * the account id, or null when unauthenticated. Kept here so all four
 * notification routes share one resolver.
 */
export async function callerAccountId(req: Request): Promise<string | null> {
  const token = bearerToken(req);
  if (token) {
    const user = await userForToken(token);
    if (user) return user.id;
  }
  const staff = await staffFromCookie();
  return staff?.id ?? null;
}
