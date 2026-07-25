/**
 * Resend transport — the one place an email actually leaves this server.
 *
 * Resend was picked because it is the least setup of the mainstream options:
 * verify a sending domain, create a key, paste two values. Nothing else in the
 * codebase knows the provider's name; callers go through `lib/email/index.ts`.
 *
 * Talks to the REST API over plain `fetch` rather than the SDK, deliberately:
 *  - it works the moment the two variables are set, with no install step and no
 *    new package to keep in step with Next's runtime;
 *  - the request is four fields, so an SDK buys nothing here (the same choice
 *    lib/video makes for Cloudinary signing).
 *
 * Two hard rules, both about what must NOT happen:
 *  - it never throws. A provider having a bad afternoon must not turn into a
 *    500 on a member's request; every failure comes back as 'failed'.
 *  - it never logs the recipient, the subject, the body or the key. A reset
 *    body carries a token that takes the account over, and an address is
 *    personal data. Outcome and HTTP status only.
 */

import type { EmailDispatch, EmailMessage } from './types.ts';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Give-up time. Email sits inside a request the member is waiting on, so the
 * server must be the one that gives up first: comfortably under the mobile
 * app's own 10s request timeout, which would otherwise leave the phone waiting
 * on silence.
 */
const TIMEOUT_MS = 8_000;

export interface ResendConfig {
  apiKey: string;
  /**
   * The From address, e.g. `The GM Method <no-reply@yourdomain.com>` or a bare
   * address. Resend rejects anything on a domain that has not been verified in
   * its console, so this is a real deployment decision, not a default we can
   * invent.
   */
  from: string;
}

/**
 * The provider's configuration, or null when this deployment has none.
 *
 * BOTH values are required: a key with no verified From address cannot send,
 * and an address with no key cannot authenticate. Treating "half configured" as
 * configured is exactly how a product ends up promising mail it cannot post.
 */
export function resendConfig(): ResendConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

/** Send one message. Never throws; see the module note above. */
export async function sendViaResend(
  message: EmailMessage,
  config: ResendConfig,
): Promise<EmailDispatch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    // Drain and DISCARD the response body. On a rejection it echoes the
    // recipient address back, so it must never be read into a log line; on
    // success it is only a message id we have nowhere to put. Draining lets the
    // connection be reused.
    await res.text().catch(() => '');

    if (!res.ok) {
      // Status only. No address, no subject, no body, no key.
      console.error(`[email] the email provider refused the message (HTTP ${res.status})`);
      return 'failed';
    }
    return 'sent';
  } catch {
    // Network error or the give-up time above. The caught value can carry the
    // request URL and headers, so it is deliberately not logged.
    console.error('[email] the email provider could not be reached in time');
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}
