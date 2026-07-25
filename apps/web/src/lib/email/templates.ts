/**
 * Email copy. One exported function per message we send, so the words live in
 * one reviewable place instead of inside a transport call.
 *
 * House copy rules apply exactly as they do on screen: plain, warm, short, no
 * dashes as punctuation, and no developer vocabulary. Nothing here may promise
 * something the product does not do.
 *
 * On the inline hex colours below: the app's "tokens only, no inline hex" rule
 * is about screens, which have @gym/ui-tokens at runtime. Email clients have no
 * stylesheet and no variables, so inline styles are the only thing that renders
 * everywhere. The values are the brand palette, copied by hand and kept few.
 */

/** A rendered message, minus the recipient. */
export interface EmailBody {
  subject: string;
  text: string;
  html: string;
}

/** Escape a value going into HTML. The reset URL is the only interpolation. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * How long the member has, in words. Read from the real expiry rather than
 * written into the copy, so the email cannot drift from what the token does if
 * PASSWORD_RESET_TTL_MS ever changes.
 */
function expiryPhrase(expiresAt: Date, now: Date): string {
  const minutes = Math.round((expiresAt.getTime() - now.getTime()) / 60_000);
  if (minutes <= 1) return 'one minute';
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'one hour' : `${hours} hours`;
}

/**
 * The password-reset email.
 *
 * No name, no tier, no account details: this is sent to an address that ASKED
 * for a reset, and whoever opens it may not be the account holder, so it says
 * as little about them as it can. The URL is the only sensitive thing in here,
 * which is why the whole message is treated as a credential everywhere else.
 */
export function passwordResetEmail(
  resetUrl: string,
  expiresAt: Date,
  now: Date = new Date(),
): EmailBody {
  const validFor = expiryPhrase(expiresAt, now);

  const line =
    'You asked to set a new password for The GM Method. ' +
    `Open the link below to pick a new one, and use it within ${validFor}. ` +
    'If this was not you, ignore this email and your password stays as it is.';

  const text = ['Hi,', '', line, '', resetUrl, '', 'The GM Method'].join('\n');

  const safeUrl = escapeHtml(resetUrl);
  const html = [
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1D1F22;max-width:520px">',
    '<p>Hi,</p>',
    `<p>${escapeHtml(line)}</p>`,
    `<p><a href="${safeUrl}" style="display:inline-block;background:#C22D24;color:#FFFFFF;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:600">Choose a new password</a></p>`,
    '<p style="color:#63676E;font-size:14px">The GM Method</p>',
    '</div>',
  ].join('');

  return { subject: 'Reset your GM Method password', text, html };
}
