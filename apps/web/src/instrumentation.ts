/**
 * Next.js startup hook — a one-shot production configuration check.
 *
 * Purpose: a missing environment variable used to be invisible until a member
 * hit the feature (a paywall that silently sells nothing, an upload that 503s).
 * This logs ONE line per missing capability into the platform logs at boot, so
 * the gap is visible on the first deploy rather than in a support ticket.
 *
 * WHY THE CHECKS ARE INLINE rather than imported from `@/lib/billing` and
 * `@/lib/video`, which already own this logic: Next compiles this file for BOTH
 * the Node and the Edge runtimes, and those modules import `node:crypto`, which
 * the Edge bundle cannot resolve — it fails `next build` outright. Neither a
 * `NEXT_RUNTIME` guard nor a dynamic import avoids it, because webpack follows
 * the import graph at build time either way. So this module reads the
 * environment directly and imports nothing.
 *
 * The duplication is deliberate but must stay honest: these checks mirror
 * `billingMode()`, `isImageConfigured()` and `isVideoConfigured()`. If the
 * variables any of those read ever change, change them here too. This is a log
 * line, never a gate — the real enforcement stays in those modules, which fail
 * closed on their own.
 *
 * Two hard rules:
 *  - It NEVER throws and never exits. The marketing site, sign-in and the whole
 *    free tier must keep serving with billing, images, video and cron unset.
 *  - It logs VARIABLE NAMES ONLY, never a value, prefix, length or any other
 *    derivative of a secret.
 */

/** True when `name` has no usable value in the environment. */
function unset(name: string): boolean {
  return !process.env[name]?.trim();
}

/** True when every name has a usable value. */
function allSet(...names: string[]): boolean {
  return names.every((name) => !unset(name));
}

/**
 * Mirrors `billingMode()`: 'live' additionally requires BOTH webhook secrets.
 * The signature secret counts because /api/subscription/revenuecat rejects any
 * event it cannot verify, so without it a 'live' deployment takes real store
 * payments and grants nothing. Keep this list in step with LIVE_BILLING_VARS
 * in `@/lib/billing`, which this file deliberately cannot import.
 */
const LIVE_BILLING_VARS = ['REVENUECAT_WEBHOOK_AUTH', 'REVENUECAT_WEBHOOK_SIGNATURE_SECRET'];

function paidPlansOff(): boolean {
  if (process.env.BILLING_MODE === 'live') return !allSet(...LIVE_BILLING_VARS);
  // 'preview' is a non-production mode, so in production anything else is off.
  return true;
}

/** Mirrors `isImageConfigured()`: uploads plus the key their only read path needs. */
function photosOff(): boolean {
  return !allSet(
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'CLOUDINARY_URL_SIGNING_KEY',
  );
}

/** Mirrors `isVideoConfigured()`: whichever provider is selected must be complete. */
function videoOff(): boolean {
  const explicit = process.env.VIDEO_PROVIDER?.trim().toLowerCase();
  if (explicit === 'cf_stream') {
    return !allSet(
      'CF_STREAM_ACCOUNT_ID',
      'CF_STREAM_API_TOKEN',
      'CF_STREAM_KEY_ID',
      'CF_STREAM_JWK',
    );
  }
  return !allSet('CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET');
}

export async function register(): Promise<void> {
  // The Edge runtime calls register() too; the report is a Node-side concern.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NODE_ENV !== 'production') return;

  try {
    if (paidPlansOff()) {
      const missing = LIVE_BILLING_VARS.filter(unset);
      console.error(
        process.env.BILLING_MODE === 'live'
          ? `[startup] BILLING_MODE is live but paid plans are still turned off. Set ${missing.join(' and ')}. Until then the purchase button stays hidden in the app and the store webhook rejects every event, so nobody gets the membership they paid for.`
          : '[startup] Paid plans are turned off: members cannot buy a subscription. Set BILLING_MODE=live together with REVENUECAT_WEBHOOK_AUTH and REVENUECAT_WEBHOOK_SIGNATURE_SECRET to turn them on.',
      );
    }

    if (photosOff()) {
      console.error(
        '[startup] Photo uploads are turned off: avatars, payment receipts and progress photos will not save. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET and CLOUDINARY_URL_SIGNING_KEY.',
      );
    }

    if (videoOff()) {
      console.error(
        '[startup] Video uploads are turned off: coaches cannot publish plan videos. Set VIDEO_PROVIDER and its keys (CLOUDINARY_* or CF_STREAM_*).',
      );
    }

    if (unset('CRON_SECRET')) {
      console.error(
        '[startup] Scheduled jobs cannot run: reminders and renewal notices will not be sent. Set CRON_SECRET.',
      );
    }

    if (unset('NOTIFICATIONS_CRON_ENABLED')) {
      console.error(
        '[startup] Scheduled notifications are switched off. Set NOTIFICATIONS_CRON_ENABLED to turn them on.',
      );
    }

    if (unset('RESEND_API_KEY')) {
      console.error(
        '[startup] Password reset emails cannot be sent: members have no way to recover an account. Set RESEND_API_KEY and EMAIL_FROM.',
      );
    }
  } catch {
    // A failed self-check must never take the server down or mask a real boot
    // error, and the reason could echo an env value: stay quiet and generic.
    console.error('[startup] Configuration check could not run.');
  }
}
