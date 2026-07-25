import type { InviteInfo, Referral, RewardsErrorCode } from '../../../lib/api/client';

/** Pure invite/referral helpers — no React, no network. Screens stay thin. */

/** Avatar fallback: first letter of a name/email (or a dot). */
export function avatarLetter(name: string): string {
  const c = name.trim().charAt(0);
  return c ? c.toUpperCase() : '·';
}

/** Groups the invite code in fours so it wraps cleanly and reads back easily. */
export function formatInviteCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? [code]).join(' ');
}

/**
 * The message the member sends themselves through whatever app they like.
 * Everything factual in it comes from the server (the code, the page to send
 * a friend to, the size and length of the discount), so the app can't promise
 * terms the backend doesn't actually grant.
 */
export function inviteShareMessage(invite: InviteInfo, code: string): string {
  return [
    `Join me on The GM Method. Use my invite code and we both get ${invite.discountPct}% off a membership.`,
    '',
    `Get the app: ${invite.shareUrl}`,
    `Then open Settings, tap Invite friends, and enter my code: ${formatInviteCode(code)}`,
    '',
    `The code works for your first ${invite.redeemWindowDays} days on the app. The discount lasts ${invite.rewardDays} days.`,
  ].join('\n');
}

/** Friendly one-liners for saving a friend's email. Never raw server codes. */
export function referralErrorLine(code: RewardsErrorCode): string {
  switch (code) {
    case 'already_linked':
      return "You've already saved this email.";
    case 'invalid':
      return "That doesn't look like an email address.";
    case 'unauthorized':
      return "You've been signed out. Sign in again.";
    default:
      return "Can't save that right now. Try again in a bit.";
  }
}

/** Friendly one-liners for using a friend's code. */
export function redeemErrorLine(code: RewardsErrorCode, windowDays: number): string {
  switch (code) {
    case 'invalid_code':
      return "That code doesn't match. Check it and try again.";
    case 'own_code':
      return "That's your own code. Share it with a friend instead.";
    case 'code_already_used':
      return "You've already used an invite code.";
    case 'not_new_member':
      return `Invite codes only work in your first ${windowDays} days.`;
    case 'grant_failed':
      return "That didn't go through. Try it again in a moment.";
    case 'invalid':
      return 'Enter the code your friend shared with you.';
    case 'unauthorized':
      return "You've been signed out. Sign in again.";
    default:
      return "Can't check that code right now. Try again in a bit.";
  }
}

/**
 * Did this invite actually earn the two of you a discount?
 *  - 'earned'  the discount landed.
 *  - 'none'    they joined but nothing was earned (they already had an
 *              account, so the invite was only recorded).
 *  - 'waiting' still waiting on them.
 *  - 'unknown' an older server didn't say, so we don't claim either way.
 */
export type ReferralOutcome = 'earned' | 'none' | 'waiting' | 'unknown';

export function referralOutcome(referral: Referral): ReferralOutcome {
  if (referral.status === 'pending') return 'waiting';
  if (referral.discountEarned === undefined) return 'unknown';
  return referral.discountEarned ? 'earned' : 'none';
}

/** Label for a referral's status row. */
export function referralStatusLabel(referral: Referral): string {
  switch (referralOutcome(referral)) {
    case 'waiting':
      return 'Waiting for them to join';
    case 'earned':
      return referral.status === 'rewarded'
        ? 'Joined. Discount used.'
        : 'Joined. Your discount is on.';
    case 'none':
      return "They're in. No discount for this one.";
    case 'unknown':
      return 'They joined.';
  }
}
