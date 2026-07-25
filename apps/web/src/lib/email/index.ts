/**
 * ══ EMAIL SEAM — the ONE place transactional email is wired ═════════════════
 *
 * Two functions, and the difference between them is the whole point:
 *
 *  - `isEmailConfigured()` is a pure CONFIGURATION read. Cheap, no network, no
 *    database, and it never looks at who the message is for. Ask it before
 *    telling anybody that email is on its way.
 *  - `sendEmail()` actually posts the message.
 *
 * They read the SAME configuration, so "we say we can send" and "we can
 * actually send" can never drift apart. That is the rule to keep: if you add a
 * second provider, both functions must learn about it together.
 *
 * Provider: Resend (see resend.ts). Set RESEND_API_KEY and EMAIL_FROM and the
 * next request sends for real; leave either unset and every send answers
 * 'not_configured' without attempting anything, which is exactly how this
 * deployment behaved before a provider existed.
 *
 * NOT a replacement for @/lib/notify. That channel is push plus the in-app
 * inbox and it needs a signed-in account. Email is for the messages that must
 * reach someone who CANNOT sign in.
 */

import { resendConfig, sendViaResend } from './resend.ts';
import type { EmailDispatch, EmailMessage } from './types.ts';

export type { EmailDispatch, EmailMessage } from './types.ts';
export type { EmailBody } from './templates.ts';
export { passwordResetEmail } from './templates.ts';

/** Can this deployment send email at all? Configuration only, same for everyone. */
export function isEmailConfigured(): boolean {
  return resendConfig() !== null;
}

/**
 * Send one message. Never throws and never logs the recipient or the body, so
 * it is safe to await inside a request: the worst case is a returned 'failed'.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailDispatch> {
  const config = resendConfig();
  if (!config) return 'not_configured';
  return sendViaResend(message, config);
}
