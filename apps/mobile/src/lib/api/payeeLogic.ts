/**
 * Pure rules for "can this rail actually take the money?" — no React, no
 * network, no imports at all, so they can be fenced by a plain node test
 * (payeeLogic.test.mjs) and reused by every payment surface.
 *
 * The one rule everything else follows: a rail is payable only when its own
 * destination is present. A wallet with no id, or a bank with only half an
 * account, is not a payment option — it is an instruction nobody can follow.
 * The QR image and the operator's extra line are supplementary and never make
 * a rail payable on their own.
 */

export interface PayeeWallet {
  /** Wallet id money is sent to (an eSewa/Khalti mobile number). */
  id: string;
  /** Registered holder name, when the operator filled it in. */
  name: string | null;
}

export interface PayeeBank {
  bankName: string | null;
  accountName: string;
  accountNumber: string;
}

export interface Payee {
  esewa: PayeeWallet | null;
  khalti: PayeeWallet | null;
  bank: PayeeBank | null;
  /** Optional scan-to-pay image. */
  qrImageUrl: string | null;
  /** Optional extra line from the operator. */
  instructions: string | null;
}

/** Which rail a surface is about to ask the member to use. */
export type PayeeRail = 'esewa' | 'khalti' | 'bank';

/** Every rail, in the order surfaces show them. */
export const PAYEE_RAILS: readonly PayeeRail[] = ['esewa', 'khalti', 'bank'];

/** True when this payee can actually take money on `rail`. */
export function supportsRail(payee: Payee | null, rail: PayeeRail): boolean {
  if (!payee) return false;
  if (rail === 'esewa') return payee.esewa !== null;
  if (rail === 'khalti') return payee.khalti !== null;
  return payee.bank !== null;
}

/** Every rail this payee can take money on. Empty means: offer nothing. */
export function availableRails(payee: Payee | null): PayeeRail[] {
  return PAYEE_RAILS.filter((rail) => supportsRail(payee, rail));
}

/**
 * The rails a surface may offer: the ones it wants, minus the ones with no
 * destination behind them.
 */
export function payableRails(wanted: readonly PayeeRail[], payee: Payee | null): PayeeRail[] {
  return wanted.filter((rail) => supportsRail(payee, rail));
}
