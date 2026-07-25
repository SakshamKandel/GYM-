/**
 * Next.js startup hook — a one-shot production configuration check.
 *
 * Purpose: a missing environment variable used to be invisible until a member
 * hit the feature (a paywall that silently sells nothing, an upload that 503s).
 * This logs ONE line per missing capability into the platform logs at boot, so
 * the gap is visible on the first deploy rather than in a support ticket.
 *
 * Two hard rules:
 *  - It NEVER throws and never exits. The marketing site, sign-in and the whole
 *    free tier must keep serving with billing/images/video/cron unconfigured.
 *  - It logs VARIABLE NAMES ONLY — never a value, prefix, length or any other
 *    derivative of a secret.
 */

/** True when `name` has no usable value in the environment. */
function unset(name: string): boolean {
  return !process.env[name]?.trim();
}

export async function register(): Promise<void> {
  // Runs once per server runtime. The edge runtime (middleware) also calls
  // register(), but the provider modules below are Node-only, so skip it there.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NODE_ENV !== 'production') return;

  try {
    const [{ billingMode }, { isImageConfigured, isVideoConfigured }] = await Promise.all([
      import('@/lib/billing'),
      import('@/lib/video'),
    ]);

    if (billingMode() === 'disabled') {
      console.error(
        '[startup] Paid plans are turned off: members cannot buy a subscription. Set BILLING_MODE and REVENUECAT_WEBHOOK_AUTH to turn them on.',
      );
    }

    if (!isImageConfigured()) {
      console.error(
        '[startup] Photo uploads are turned off: avatars, payment receipts and progress photos will not save. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET and CLOUDINARY_URL_SIGNING_KEY.',
      );
    }

    if (!isVideoConfigured()) {
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
  } catch {
    // A failed self-check must never take the server down or mask a real boot
    // error, and the reason could echo an env value — stay quiet and generic.
    console.error('[startup] Configuration check could not run.');
  }
}
