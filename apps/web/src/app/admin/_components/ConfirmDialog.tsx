'use client';

import type { ReactNode } from 'react';
import { Button, Modal } from '@/components/console';

/**
 * The one confirmation used by every destructive or money-moving action in the
 * admin console.
 *
 * Two rules it exists to enforce:
 *  1. Nothing irreversible fires on a single click. Refunds, cancellations,
 *     rejections and payouts all pass through here.
 *  2. The confirmation NAMES what will happen and to whom — "Refund NPR 4,500
 *     to Sita Rai" beats "Are you sure?", which tells an operator nothing they
 *     didn't already know and trains them to click through.
 *
 * `summary` is that sentence; `details` holds the row facts (member, order
 * number, amount) so the operator can check them without going back. The
 * confirm button carries the verb, never "OK".
 *
 * A refusal is reported HERE, through `error`, rather than by closing. Sending
 * the operator back to the queue with no explanation is how the same payout
 * gets approved three times: the dialog vanished, so it looked like it worked.
 * With the dialog still open and the reason on it, the facts they were checking
 * are still in front of them and retrying is one click.
 */
export function ConfirmDialog({
  open,
  title,
  summary,
  details,
  confirmLabel,
  busyLabel = 'Working…',
  cancelLabel = 'Keep as is',
  busy = false,
  destructive = true,
  error,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  /** Question form, e.g. "Refund this payment?" */
  title: string;
  /** One plain sentence naming the effect and the person it lands on. */
  summary: ReactNode;
  /** Label/value facts about the row being acted on. */
  details?: { label: string; value: ReactNode }[];
  confirmLabel: string;
  busyLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  /** Why the server refused, in plain words. Keeps the dialog open. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra content (e.g. a warning about what cannot be undone). */
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onCancel();
      }}
      title={title}
      width={440}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? busyLabel : error ? `${confirmLabel} again` : confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--gt-text)' }}>
          {summary}
        </p>

        {details && details.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gap: 8,
              padding: 12,
              borderRadius: 10,
              border: '1px solid var(--gt-border)',
              background: 'var(--gt-surface-sunken)',
              fontSize: 13,
            }}
          >
            {details.map((d) => (
              <div
                key={d.label}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
              >
                <span style={{ color: 'var(--gt-text-dim)' }}>{d.label}</span>
                <span style={{ textAlign: 'right', minWidth: 0 }}>{d.value}</span>
              </div>
            ))}
          </div>
        ) : null}

        {children}

        {error ? (
          <div
            role="alert"
            style={{
              padding: 12,
              borderRadius: 'var(--gt-radius-sm)',
              border: '1px solid color-mix(in srgb, var(--gt-danger) 35%, transparent)',
              background: 'var(--gt-danger-weak)',
              color: 'var(--gt-danger)',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
