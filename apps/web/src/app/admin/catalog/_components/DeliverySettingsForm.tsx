'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardHeader, TextField } from '@/components/console';
import { formatDateTime } from '@/lib/format';

/**
 * Meal-delivery fee + cutoff editor (the `meal_delivery_config` singleton).
 *
 * Every member quote, one-time order and weekly subscription cycle prices
 * itself from this one row, and until now it had no editor anywhere — changing
 * a delivery fee meant writing the row by hand in the database. The form sends
 * ONLY the fields an admin actually changed to PATCH /api/admin/meal-config,
 * so two admins editing different fields don't overwrite each other, and the
 * server audits before/after with the actor id.
 *
 * Money is edited in whole rupees and stored as integer minor units (paisa,
 * ×100) — the same major-in / minor-out convention as the pricing grid.
 * Cutoffs are Kathmandu wall-clock hours (0–23); they apply to NEW orders only,
 * since every order freezes its own cutoff instant at creation.
 */

export interface DeliveryConfigValues {
  smallOrderFeeMinor: number;
  smallOrderThresholdMinor: number;
  deliveryFeeMinor: number;
  freeDeliveryThresholdMinor: number;
  lunchCutoffPrevDayHour: number;
  dinnerCutoffSameDayHour: number;
}

type MoneyField =
  | 'smallOrderFeeMinor'
  | 'smallOrderThresholdMinor'
  | 'deliveryFeeMinor'
  | 'freeDeliveryThresholdMinor';
type HourField = 'lunchCutoffPrevDayHour' | 'dinnerCutoffSameDayHour';
type Field = MoneyField | HourField;

const MONEY_FIELDS: readonly { key: MoneyField; label: string; hint: string }[] = [
  {
    key: 'deliveryFeeMinor',
    label: 'Delivery fee (Rs)',
    hint: 'Charged on every order below the free-delivery threshold.',
  },
  {
    key: 'freeDeliveryThresholdMinor',
    label: 'Free delivery from (Rs)',
    hint: 'Order subtotal at which delivery stops costing anything. Set 0 to make every delivery free.',
  },
  {
    key: 'smallOrderFeeMinor',
    label: 'Small-order fee (Rs)',
    hint: 'Added when the subtotal is under the small-order amount below.',
  },
  {
    key: 'smallOrderThresholdMinor',
    label: 'Small-order applies under (Rs)',
    hint: 'Subtotal below this amount pays the small-order fee.',
  },
];

const HOUR_FIELDS: readonly { key: HourField; label: string; hint: string }[] = [
  {
    key: 'lunchCutoffPrevDayHour',
    label: 'Lunch cutoff hour (day before)',
    hint: 'Kathmandu time on the day BEFORE delivery. 21 = 9 pm.',
  },
  {
    key: 'dinnerCutoffSameDayHour',
    label: 'Dinner cutoff hour (same day)',
    hint: 'Kathmandu time on the delivery day itself. 10 = 10 am.',
  },
];

const ALL_FIELDS: readonly Field[] = [
  ...MONEY_FIELDS.map((f) => f.key),
  ...HOUR_FIELDS.map((f) => f.key),
];

function isMoneyField(field: Field): field is MoneyField {
  return (MONEY_FIELDS as readonly { key: Field }[]).some((f) => f.key === field);
}

/** minor units → an editable whole-rupee string (5000 → "50"). */
function toRupees(minor: number): string {
  return String(Math.round(minor / 100));
}

/** A field's stored value rendered as its editable string. */
function toInput(values: DeliveryConfigValues, field: Field): string {
  return isMoneyField(field) ? toRupees(values[field]) : String(values[field]);
}

/** Editable string → the stored integer, or null when it isn't usable. */
function toStored(field: Field, raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  if (isMoneyField(field)) return Math.round(n * 100);
  if (!Number.isInteger(n) || n > 23) return null;
  return n;
}

/** KTM hour → a plain 12-hour label, so "21" reads as "9 pm" at a glance. */
function hourLabel(raw: string): string {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 23) return '—';
  const suffix = n < 12 ? 'am' : 'pm';
  const h = n % 12 === 0 ? 12 : n % 12;
  return `${h} ${suffix}`;
}

export function DeliverySettingsForm({
  config,
  updatedAt,
  persisted,
}: {
  config: DeliveryConfigValues;
  /** ISO timestamp of the last save, or null when never saved. */
  updatedAt: string | null;
  /** false = the row doesn't exist yet and `config` is the built-in default. */
  persisted: boolean;
}) {
  const router = useRouter();

  const seed = useMemo(() => {
    const init: Record<string, string> = {};
    for (const field of ALL_FIELDS) init[field] = toInput(config, field);
    return init;
  }, [config]);

  const [edits, setEdits] = useState<Record<string, string>>(seed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Re-seed whenever the authoritative row changes (after a save we
  // router.refresh(), which re-renders with the saved values). Without this the
  // inputs keep their mount-time text and a later save would PATCH stale
  // numbers back over another admin's edit.
  useEffect(() => {
    setEdits(seed);
  }, [seed]);

  const dirty = ALL_FIELDS.some((field) => edits[field] !== seed[field]);

  function setField(field: Field, value: string) {
    setSaved(false);
    setEdits((prev) => ({ ...prev, [field]: value }));
  }

  async function save() {
    const patch: Partial<Record<Field, number>> = {};
    for (const field of ALL_FIELDS) {
      if (edits[field] === seed[field]) continue;
      const stored = toStored(field, edits[field] ?? '');
      if (stored === null) {
        setError(
          isMoneyField(field)
            ? 'Amounts must be whole rupees, zero or more.'
            : 'Cutoff hours must be a whole number from 0 to 23.',
        );
        return;
      }
      patch[field] = stored;
    }
    if (Object.keys(patch).length === 0) return;

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/admin/meal-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'You are not allowed to change delivery settings.'
            : res.status === 400
              ? 'Some of those values are out of range. Check the amounts and hours, then try again.'
              : 'Could not save these settings. Try again.',
        );
        setSaving(false);
        return;
      }
      setSaving(false);
      setSaved(true);
      // Re-render the page shell so `seed` picks up the freshly saved row and
      // the form stops looking dirty against a stale baseline.
      router.refresh();
    } catch {
      setError('Could not reach us just now. Try again.');
      setSaving(false);
    }
  }

  return (
    <Card padded={false} style={{ marginTop: 28 }}>
      <CardHeader
        title="Meal delivery fees & cutoffs"
        action={
          <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
            {persisted && updatedAt
              ? `Last saved ${formatDateTime(updatedAt)}`
              : 'Using built-in defaults, never saved'}
          </span>
        }
      />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--gt-text-dim)', maxWidth: 640 }}>
          These apply to every partner kitchen. New orders and weekly plan invoices price from
          them immediately; orders already placed keep the fees and cutoff they were created
          with.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16,
          }}
        >
          {MONEY_FIELDS.map((f) => (
            <TextField
              key={f.key}
              label={f.label}
              hint={f.hint}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={edits[f.key] ?? ''}
              disabled={saving}
              onChange={(e) => setField(f.key, e.target.value)}
            />
          ))}
          {HOUR_FIELDS.map((f) => (
            <TextField
              key={f.key}
              label={f.label}
              hint={`${f.hint} Currently ${hourLabel(edits[f.key] ?? '')}.`}
              type="number"
              min={0}
              max={23}
              step={1}
              inputMode="numeric"
              value={edits[f.key] ?? ''}
              disabled={saving}
              onChange={(e) => setField(f.key, e.target.value)}
            />
          ))}
        </div>

        {error ? (
          <div role="alert" style={{ color: 'var(--gt-danger)', fontSize: 13 }}>
            {error}
          </div>
        ) : null}
        {saved && !dirty ? (
          <div style={{ color: 'var(--gt-text-dim)', fontSize: 13 }}>Delivery settings saved.</div>
        ) : null}

        <div>
          <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save delivery settings'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
