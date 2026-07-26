'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardHeader, TextField } from '@/components/console';
import { formatDateTime, formatMoney, parseMoneyInput } from '@/lib/format';

/**
 * Platform-wide meal delivery fees + order cutoffs — the editor for the
 * `meal_delivery_config` singleton every quote, one-time order and weekly
 * subscription cycle prices itself from.
 *
 * It lives on the partners page because that page is gated on `partners.manage`,
 * exactly the permission PATCH /api/admin/meal-config enforces: whoever can see
 * this card can save it. Before this existed the API had no caller at all, so
 * changing a delivery fee meant hand-writing a database row.
 *
 * Concurrency: only the fields an operator actually TOUCHED are sent, and the
 * route applies a partial update, so two admins editing different fields don't
 * overwrite each other. After a save the page is refreshed and the inputs
 * re-seed from server truth, so a second save can't push stale numbers back
 * over someone else's change.
 *
 * Money is edited in rupees and stored as integer minor units (paisa, ×100);
 * cutoffs are Kathmandu wall-clock hours (0–23) and apply to NEW orders only —
 * every order freezes its own cutoff instant when it's created.
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
  | 'deliveryFeeMinor'
  | 'freeDeliveryThresholdMinor'
  | 'smallOrderFeeMinor'
  | 'smallOrderThresholdMinor';
type HourField = 'lunchCutoffPrevDayHour' | 'dinnerCutoffSameDayHour';
type Field = MoneyField | HourField;

/** Server-side ceilings (api/admin/meal-config), mirrored for a friendly message. */
const MAX_FEE_MINOR = 1_000_000; // Rs 10,000
const MAX_THRESHOLD_MINOR = 10_000_000; // Rs 100,000

interface MoneySpec {
  key: MoneyField;
  label: string;
  hint: string;
  maxMinor: number;
}

const MONEY_FIELDS: readonly MoneySpec[] = [
  {
    key: 'deliveryFeeMinor',
    label: 'Delivery fee (Rs)',
    hint: 'Charged on every order below the free-delivery amount.',
    maxMinor: MAX_FEE_MINOR,
  },
  {
    key: 'freeDeliveryThresholdMinor',
    label: 'Free delivery from (Rs)',
    hint: 'Order total at which delivery stops costing anything. Set 0 to make delivery always free.',
    maxMinor: MAX_THRESHOLD_MINOR,
  },
  {
    key: 'smallOrderFeeMinor',
    label: 'Small-order fee (Rs)',
    hint: 'Added when an order is under the small-order amount.',
    maxMinor: MAX_FEE_MINOR,
  },
  {
    key: 'smallOrderThresholdMinor',
    label: 'Small-order applies under (Rs)',
    hint: 'Orders below this total pay the small-order fee.',
    maxMinor: MAX_THRESHOLD_MINOR,
  },
];

const HOUR_FIELDS: readonly { key: HourField; label: string; hint: string }[] = [
  {
    key: 'lunchCutoffPrevDayHour',
    label: 'Lunch orders close at',
    hint: 'Kathmandu time on the day BEFORE delivery. 21 = 9 pm.',
  },
  {
    key: 'dinnerCutoffSameDayHour',
    label: 'Dinner orders close at',
    hint: 'Kathmandu time on the delivery day itself. 10 = 10 am.',
  },
];

const MONEY_KEYS: readonly Field[] = MONEY_FIELDS.map((f) => f.key);
const ALL_FIELDS: readonly Field[] = [...MONEY_KEYS, ...HOUR_FIELDS.map((f) => f.key)];

function isMoneyField(field: Field): field is MoneyField {
  return (MONEY_KEYS as readonly string[]).includes(field);
}

/** The ceiling for a money field, in minor units. */
function maxMinorFor(field: MoneyField): number {
  return MONEY_FIELDS.find((f) => f.key === field)?.maxMinor ?? MAX_FEE_MINOR;
}

/**
 * Stored minor units → the editable rupee string (5000 → "50", 4950 → "49.50").
 * Integer split: money never round-trips through a float here.
 */
function toRupees(minor: number): string {
  const whole = Math.round(minor);
  const paisa = whole % 100;
  const rupees = (whole - paisa) / 100;
  return paisa === 0 ? String(rupees) : `${rupees}.${String(paisa).padStart(2, '0')}`;
}

/** A field's stored value as the string shown in its input. */
function toInput(values: DeliveryConfigValues, field: Field): string {
  return isMoneyField(field) ? toRupees(values[field]) : String(values[field]);
}

/** Typed text → the integer to store, or an operator-readable reason it can't be. */
function toStored(field: Field, raw: string): { value: number } | { error: string } {
  const text = raw.trim();
  if (text === '') {
    return { error: 'Fill in every box before saving. Blanks are not a value.' };
  }
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) {
    return isMoneyField(field)
      ? { error: 'Amounts must be zero or more.' }
      : { error: 'Cutoff hours must be a whole number from 0 to 23.' };
  }
  if (!isMoneyField(field)) {
    if (!Number.isInteger(n) || n > 23) {
      return { error: 'Cutoff hours must be a whole number from 0 to 23.' };
    }
    return { value: n };
  }
  // Parsed as digits, not as a float: `49.95 * 100` is not exactly 4995.
  const minor = parseMoneyInput(text);
  if (minor === null || minor < 0) {
    return { error: 'Amounts must be zero or more, with at most two decimals.' };
  }
  if (minor > maxMinorFor(field)) {
    return {
      error: `That amount is too large. The most you can set is ${formatMoney(maxMinorFor(field), 'NPR')}.`,
    };
  }
  return { value: minor };
}

/** A KTM hour rendered plainly, so "21" reads as "9 pm" while typing. */
function hourLabel(raw: string): string {
  const n = Number(raw.trim());
  if (raw.trim() === '' || !Number.isInteger(n) || n < 0 || n > 23) return '—';
  const suffix = n < 12 ? 'am' : 'pm';
  const hour = n % 12 === 0 ? 12 : n % 12;
  return `${hour} ${suffix}`;
}

export function DeliverySettingsCard({
  config,
  updatedAt,
  persisted,
}: {
  config: DeliveryConfigValues;
  /** ISO timestamp of the last save, or null when it has never been saved. */
  updatedAt: string | null;
  /** false = no row saved yet, so `config` is the built-in default in use. */
  persisted: boolean;
}) {
  const router = useRouter();

  const seed = useMemo(() => {
    const initial: Record<string, string> = {};
    for (const field of ALL_FIELDS) initial[field] = toInput(config, field);
    return initial;
  }, [config]);

  const [edits, setEdits] = useState<Record<string, string>>(seed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Re-seed from server truth whenever the saved row changes (router.refresh()
  // re-renders this card with the fresh values). Without it the inputs keep
  // their mount-time text and a later save would PATCH stale numbers back over
  // another admin's edit.
  useEffect(() => {
    setEdits(seed);
    setError(null);
  }, [seed]);

  const changed = ALL_FIELDS.filter((field) => edits[field] !== seed[field]);
  const dirty = changed.length > 0;

  function setField(field: Field, value: string) {
    setSaved(false);
    setEdits((prev) => ({ ...prev, [field]: value }));
  }

  async function save() {
    // ONLY the touched fields go on the wire — the route does a partial update,
    // so an untouched field keeps whatever another admin last saved.
    const patch: Partial<Record<Field, number>> = {};
    for (const field of changed) {
      const parsed = toStored(field, edits[field] ?? '');
      if ('error' in parsed) {
        setError(parsed.error);
        return;
      }
      patch[field] = parsed.value;
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
      router.refresh();
    } catch {
      setError('Could not reach us just now. Try again.');
      setSaving(false);
    }
  }

  return (
    <Card padded={false} style={{ marginTop: 28 }}>
      <CardHeader
        title="Delivery fees & order cutoffs"
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
          them straight away; orders already placed keep the fees and cutoff they were created
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
              inputMode="decimal"
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
        {/* A dark fill, not the accent: this card rides along on a page whose one
            accent already belongs to its main action. Still the high-emphasis
            control of its own section. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Button variant="dark" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save delivery settings'}
          </Button>
          <span
            role="status"
            aria-live="polite"
            style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}
          >
            {saving ? '' : dirty ? 'Not saved yet.' : saved ? 'Saved.' : ''}
          </span>
        </div>
      </div>
    </Card>
  );
}
