/**
 * Order-dispute pure logic — the reason taxonomy, the open-eligibility gate, and
 * the resolution state machine (Pack E; §7.2-S3). No I/O (CLAUDE.md rule 10). A
 * dispute is openable ONLY from a terminal delivered/paid state, at most one may
 * be live per order (enforced by the DB partial unique), and resolution is
 * ADMIN-authoritative — it NEVER auto-refunds.
 */

import type { OrderPaymentStatus, OrderStatus } from './orders';

/** Why a member is disputing an order. */
export type DisputeReason = 'not_delivered' | 'wrong_items' | 'quality' | 'late' | 'other';

export const DISPUTE_REASONS: readonly DisputeReason[] = [
  'not_delivered',
  'wrong_items',
  'quality',
  'late',
  'other',
];

export function isDisputeReason(value: string): value is DisputeReason {
  return (DISPUTE_REASONS as readonly string[]).includes(value);
}

/** Lifecycle of a dispute. `resolved`/`rejected` are terminal. */
export type DisputeStatus = 'open' | 'reviewing' | 'resolved' | 'rejected';

export const DISPUTE_STATUSES: readonly DisputeStatus[] = [
  'open',
  'reviewing',
  'resolved',
  'rejected',
];

/** The statuses in which a dispute is still "live" (blocks a second file). */
export const LIVE_DISPUTE_STATUSES: readonly DisputeStatus[] = ['open', 'reviewing'];

export function isLiveDisputeStatus(status: DisputeStatus): boolean {
  return LIVE_DISPUTE_STATUSES.includes(status);
}

export const DISPUTE_TRANSITIONS: Record<DisputeStatus, readonly DisputeStatus[]> = {
  open: ['reviewing', 'resolved', 'rejected'],
  reviewing: ['resolved', 'rejected'],
  resolved: [],
  rejected: [],
};

export function isTerminalDisputeStatus(status: DisputeStatus): boolean {
  return DISPUTE_TRANSITIONS[status].length === 0;
}

/** Is `from → to` a legal dispute transition? */
export function canAdvanceDispute(from: DisputeStatus, to: DisputeStatus): boolean {
  return DISPUTE_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * May a member open a dispute against this order? Only from a terminal
 * delivered/paid state (§7.2-S3): a delivered order (partner marked it delivered
 * but the member says otherwise) OR any order whose money was captured
 * (`paid`) — "I paid and didn't get what I ordered". A never-paid, never-
 * delivered order has nothing to dispute here. The one-live-per-order rule is a
 * DB constraint, not this predicate.
 */
export function canOpenDispute(
  orderStatus: OrderStatus,
  paymentStatus: OrderPaymentStatus,
): boolean {
  return orderStatus === 'delivered' || paymentStatus === 'paid';
}
