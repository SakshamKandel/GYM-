import type { ReferralStatus, RewardsErrorCode } from '../../../lib/api/client';

/** Pure invite/referral helpers — no React, no network. Screens stay thin. */

/** Avatar fallback: first letter of a name/email (or a dot). */
export function avatarLetter(name: string): string {
  const c = name.trim().charAt(0);
  return c ? c.toUpperCase() : '·';
}

/** Friendly one-liners for invite failures — never raw server codes. */
export function referralErrorLine(code: RewardsErrorCode): string {
  switch (code) {
    case 'already_enrolled':
      return 'This person already has an account — invites are for friends who are new to the app.';
    case 'already_linked':
      return "You've already invited this email.";
    case 'invalid':
      return "That doesn't look like an email address.";
    case 'unauthorized':
      return 'Your session expired — sign in again.';
    default:
      return "Can't send the invite — try again in a bit.";
  }
}

/** Label for a referral's status row. */
export function referralStatusLabel(status: ReferralStatus): string {
  switch (status) {
    case 'pending':
      return 'Waiting for them to join';
    case 'joined':
      return 'Joined — discount unlocked!';
    case 'rewarded':
      return 'Reward claimed';
  }
}
