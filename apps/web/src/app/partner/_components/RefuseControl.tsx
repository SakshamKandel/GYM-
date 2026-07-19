'use client';

import { useState } from 'react';
import { Button } from '@/components/console';

/**
 * Preset reasons for a partner refuse/reject (B6/B7). Kept short — these ride
 * verbatim into the member's push/notification-center copy, so no jargon.
 * "Other" reveals a free-text field capped at {@link REASON_MAX_LEN}.
 */
const REFUSE_REASONS = [
  'Item out of stock',
  'Kitchen too busy right now',
  'Address is outside our delivery range',
  'Could not reach the customer',
  'Closing early today',
  'Other',
] as const;

const REASON_MAX_LEN = 200;

/**
 * Inline refuse/cancel-with-reason control (B6/B7). Replaces a bare two-step
 * ConfirmButton with a reason PICKER so the member is actually told why —
 * expands to a preset dropdown (+ optional free-text for "Other") and only
 * enables the confirm action once a reason is selected. Used by both the Today
 * board (TodayBoard.tsx) and the fulfillment queue (OrdersQueue.tsx).
 */
export function RefuseControl({
  label,
  busy = false,
  size = 'sm',
  onConfirm,
}: {
  /** Button copy before the picker opens (e.g. "Mark refused", "Cancel"). */
  label: string;
  busy?: boolean;
  size?: 'sm' | 'md';
  /** Called with the final reason text (never empty) once confirmed. */
  onConfirm: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(REFUSE_REASONS[0]);
  const [customNote, setCustomNote] = useState('');

  if (!open) {
    return (
      <Button
        variant="ghost"
        size={size}
        disabled={busy}
        onClick={() => setOpen(true)}
        style={{ color: 'var(--gt-danger)' }}
      >
        {label}
      </Button>
    );
  }

  const finalReason = reason === 'Other' ? customNote.trim() : reason;
  const canConfirm = finalReason.length > 0 && finalReason.length <= REASON_MAX_LEN;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 10,
        borderRadius: 10,
        border: '1px solid var(--gt-border-strong)',
        background: 'var(--gt-surface-sunken)',
        minWidth: 220,
      }}
    >
      <span
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--gt-text-dim)',
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
        }}
      >
        Reason (tells the customer)
      </span>
      <select
        className="gt-input"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ fontSize: 13, padding: '6px 8px' }}
      >
        {REFUSE_REASONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {reason === 'Other' ? (
        <input
          className="gt-input"
          type="text"
          value={customNote}
          onChange={(e) => setCustomNote(e.target.value.slice(0, REASON_MAX_LEN))}
          placeholder="Say what happened…"
          maxLength={REASON_MAX_LEN}
          style={{ fontSize: 13, padding: '6px 8px' }}
        />
      ) : null}
      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        <Button
          variant="danger"
          size="sm"
          disabled={busy || !canConfirm}
          onClick={() => {
            onConfirm(finalReason);
            setOpen(false);
            setReason(REFUSE_REASONS[0]);
            setCustomNote('');
          }}
        >
          {busy ? 'Working…' : 'Confirm'}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
          Back
        </Button>
      </div>
    </div>
  );
}
