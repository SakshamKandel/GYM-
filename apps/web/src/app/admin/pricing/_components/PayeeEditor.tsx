'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, TextField } from '@/components/console';

/**
 * Where members send money for manual payments (`payment_settings` singleton).
 *
 * Manual payment is the only working way to buy a membership or a meal, and the
 * app used to tell members "transfer first, then upload the receipt" without
 * ever naming a wallet, an account or a QR. This form is the missing half.
 *
 * The rule the form makes visible: a rail is shown to members only when its own
 * identifier is filled in (eSewa id, Khalti id, or bank account name AND
 * number). Anything with no identifier is hidden from the app entirely rather
 * than offered with a blank destination, so the summary underneath always says
 * exactly what members will see after saving. With nothing filled in, members
 * are told the payment method is not available yet.
 *
 * Saves send only the fields this admin actually changed (PATCH), so two people
 * editing different rails don't overwrite each other.
 */

export interface PayeeSettings {
  esewaId: string | null;
  esewaName: string | null;
  khaltiId: string | null;
  khaltiName: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  qrImageUrl: string | null;
  instructions: string | null;
}

type Field = keyof PayeeSettings;

const FIELDS: readonly Field[] = [
  'esewaId',
  'esewaName',
  'khaltiId',
  'khaltiName',
  'bankName',
  'bankAccountName',
  'bankAccountNumber',
  'qrImageUrl',
  'instructions',
];

type FormState = Record<Field, string>;

function toForm(settings: PayeeSettings): FormState {
  return {
    esewaId: settings.esewaId ?? '',
    esewaName: settings.esewaName ?? '',
    khaltiId: settings.khaltiId ?? '',
    khaltiName: settings.khaltiName ?? '',
    bankName: settings.bankName ?? '',
    bankAccountName: settings.bankAccountName ?? '',
    bankAccountNumber: settings.bankAccountNumber ?? '',
    qrImageUrl: settings.qrImageUrl ?? '',
    instructions: settings.instructions ?? '',
  };
}

/** Rails that will be live for members, in plain words. */
function liveRails(form: FormState): string[] {
  const rails: string[] = [];
  if (form.esewaId.trim()) rails.push('eSewa');
  if (form.khaltiId.trim()) rails.push('Khalti');
  if (form.bankAccountName.trim() && form.bankAccountNumber.trim()) rails.push('Bank transfer');
  return rails;
}

const sectionTitle = {
  fontFamily: 'var(--font-heading)',
  fontWeight: 600,
  fontSize: 15,
  marginBottom: 12,
} as const;

const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 14,
} as const;

export function PayeeEditor({
  settings,
  updatedAt,
}: {
  settings: PayeeSettings;
  updatedAt: string | null;
}) {
  const router = useRouter();
  const seed = useMemo(() => toForm(settings), [settings]);
  const [form, setForm] = useState<FormState>(seed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever the saved settings change (after a save we router.refresh,
  // which re-renders with the freshly-saved row) so the form never keeps
  // showing stale values and PATCHes them back over someone else's edit.
  useEffect(() => {
    setForm(seed);
    setError(null);
  }, [seed]);

  const dirty = FIELDS.some((field) => form[field].trim() !== seed[field]);
  const rails = liveRails(form);

  async function save() {
    const payload: Partial<Record<Field, string>> = {};
    for (const field of FIELDS) {
      const next = form[field].trim();
      if (next !== seed[field]) payload[field] = next;
    }
    if (Object.keys(payload).length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/payment-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'You are not allowed to edit payment details.'
            : res.status === 400
              ? 'Check the details. Links must start with https and each field is a single line.'
              : 'Could not save these details. Try again.',
        );
        setSaving(false);
        return;
      }
      setSaving(false);
      router.refresh();
    } catch {
      setError('Could not reach us just now. Try again.');
      setSaving(false);
    }
  }

  function set(field: Field, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={sectionTitle}>eSewa</div>
        <div style={grid}>
          <TextField
            label="eSewa ID"
            value={form.esewaId}
            onChange={(e) => set('esewaId', e.target.value)}
            placeholder="98XXXXXXXX"
            disabled={saving}
            hint="Leave blank to hide eSewa from members."
          />
          <TextField
            label="Account name"
            value={form.esewaName}
            onChange={(e) => set('esewaName', e.target.value)}
            placeholder="Name on the wallet"
            disabled={saving}
            hint="Shown so members can check before they send."
          />
        </div>
      </Card>

      <Card>
        <div style={sectionTitle}>Khalti</div>
        <div style={grid}>
          <TextField
            label="Khalti ID"
            value={form.khaltiId}
            onChange={(e) => set('khaltiId', e.target.value)}
            placeholder="98XXXXXXXX"
            disabled={saving}
            hint="Leave blank to hide Khalti from members."
          />
          <TextField
            label="Account name"
            value={form.khaltiName}
            onChange={(e) => set('khaltiName', e.target.value)}
            placeholder="Name on the wallet"
            disabled={saving}
          />
        </div>
      </Card>

      <Card>
        <div style={sectionTitle}>Bank transfer</div>
        <div style={grid}>
          <TextField
            label="Bank"
            value={form.bankName}
            onChange={(e) => set('bankName', e.target.value)}
            placeholder="Bank name"
            disabled={saving}
          />
          <TextField
            label="Account name"
            value={form.bankAccountName}
            onChange={(e) => set('bankAccountName', e.target.value)}
            placeholder="Name on the account"
            disabled={saving}
            hint="Name and number are both needed."
          />
          <TextField
            label="Account number"
            value={form.bankAccountNumber}
            onChange={(e) => set('bankAccountNumber', e.target.value)}
            placeholder="00000000000000"
            disabled={saving}
          />
        </div>
      </Card>

      <Card>
        <div style={sectionTitle}>Extras</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <TextField
            label="QR image link"
            value={form.qrImageUrl}
            onChange={(e) => set('qrImageUrl', e.target.value)}
            placeholder="https://…"
            disabled={saving}
            hint="Optional scan-to-pay image shown with the details. Must start with https."
          />
          <TextField
            label="Extra line for members"
            value={form.instructions}
            onChange={(e) => set('instructions', e.target.value)}
            placeholder="e.g. Add your full name in the remarks"
            maxLength={400}
            disabled={saving}
            hint="Optional. Keep it to one short sentence."
          />
          {form.qrImageUrl.trim().startsWith('https://') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={form.qrImageUrl.trim()}
              alt="Payment QR preview"
              style={{
                width: 160,
                height: 160,
                objectFit: 'contain',
                borderRadius: 'var(--gt-radius-sm)',
                background: 'var(--gt-surface)',
                border: '1px solid var(--gt-border)',
              }}
            />
          ) : null}
        </div>
      </Card>

      <Card>
        <div style={sectionTitle}>What members see</div>
        <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
          {rails.length > 0
            ? `Members can pay with ${rails.join(', ')} and will see these details before they are asked for a receipt.`
            : 'Nothing is set, so members are told that paying in the app is not available yet and are not asked to transfer anything.'}
        </div>
        {updatedAt ? (
          <div style={{ fontSize: 12, color: 'var(--gt-text-dim)', marginTop: 8 }}>
            Last saved {new Date(updatedAt).toLocaleString()}
          </div>
        ) : null}
      </Card>

      {error ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div> : null}

      <div>
        <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save payment details'}
        </Button>
      </div>
    </div>
  );
}
