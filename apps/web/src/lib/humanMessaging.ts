export type CoachThreadKind = 'coach_chat' | 'support';

export type HumanMessageDelivery =
  | { ok: true; target: 'assigned_coach'; accountId: string }
  | { ok: true; target: 'support_inbox' }
  | { ok: false; error: 'coach_unavailable' };

/**
 * Resolve a member message to a real human-owned inbox.
 *
 * Support is always owned by the staff support inbox. Coach chat is only
 * available when the member has an active, persisted coach assignment; an
 * absent assignment must never be replaced by a fabricated coach or AI
 * impersonation.
 */
export function humanMessageDelivery(
  kind: CoachThreadKind,
  activeCoachId: string | null,
): HumanMessageDelivery {
  if (kind === 'support') return { ok: true, target: 'support_inbox' };
  if (activeCoachId === null) return { ok: false, error: 'coach_unavailable' };
  return { ok: true, target: 'assigned_coach', accountId: activeCoachId };
}
