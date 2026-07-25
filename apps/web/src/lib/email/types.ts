/**
 * Transactional email — the provider-agnostic contract.
 *
 * Everything above this file (templates, the password-reset seam) speaks in
 * these shapes only, so swapping Resend for another provider is one new file in
 * this folder plus one line in index.ts. Nothing outside `lib/email` ever names
 * a provider.
 *
 * PRIVACY RULE for every implementation of this contract: an `EmailMessage`
 * holds a real person's address and, for a reset, a bearer credential in the
 * body. Neither may EVER reach a log line, an error message, or an audit
 * record. Log the outcome, never the message.
 */

/** One outbound message. Single recipient by design — we never batch. */
export interface EmailMessage {
  /** The recipient address. Never logged. */
  to: string;
  subject: string;
  /** Plain-text body. Always sent: some clients never render the HTML. */
  text: string;
  /** Simple HTML body. No images, no tracking, no external files. */
  html: string;
}

/**
 * What happened to one send. Callers must treat every value as non-fatal:
 * email is a best-effort channel and must never take a request down with it.
 *
 *  - 'sent'           → the provider accepted the message for delivery. (It is
 *                       not proof it reached the inbox; nothing is.)
 *  - 'not_configured' → this deployment has no email keys, so nothing was
 *                       attempted and nothing ever will be until they are set.
 *  - 'failed'         → keys are set but the attempt did not land (network,
 *                       give-up time, or the provider refused it).
 */
export type EmailDispatch = 'sent' | 'not_configured' | 'failed';
