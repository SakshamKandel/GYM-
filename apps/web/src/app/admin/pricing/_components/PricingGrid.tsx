'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card } from '@/components/console';
import { formatMoney, parseMoneyInput } from '@/lib/format';
import { tierLabel } from '@/app/admin/_lib/tierLabel';

export type PriceRegion = 'NP' | 'INTL';
export type Tier = 'starter' | 'silver' | 'gold' | 'elite';

export interface PriceCell {
  region: PriceRegion;
  tier: Tier;
  amountMinor: number;
  currency: string;
}

const REGIONS: readonly { key: PriceRegion; label: string; currency: string }[] = [
  { key: 'NP', label: 'Nepal', currency: 'NPR' },
  { key: 'INTL', label: 'International', currency: 'USD' },
];

const EDITABLE_TIERS: readonly Tier[] = ['silver', 'gold', 'elite'];

function key(region: PriceRegion, tier: Tier): string {
  return `${region}-${tier}`;
}

/**
 * amountMinor → an editable major-unit string (49900 → "499", 999 → "9.99").
 * Integer split, so no price ever renders as 4.9899999999999995.
 */
function toMajorInput(amountMinor: number): string {
  const cents = amountMinor % 100;
  const whole = (amountMinor - cents) / 100;
  return cents === 0 ? String(whole) : `${whole}.${String(cents).padStart(2, '0')}`;
}

/**
 * Editable major-unit string → amountMinor, parsed as digits rather than as a
 * float (a price is money, and `9.99 * 100` is not exactly 999).
 *
 * An empty/whitespace cell must NOT coerce to 0 (Number('') === 0), which would
 * silently price a paid tier as free (E2) — that, anything negative, and
 * anything with more than two decimals, all read as invalid.
 */
function toMinor(major: string): number | null {
  const minor = parseMoneyInput(major);
  if (minor === null || minor < 0) return null;
  return minor;
}

/**
 * Region × tier pricing grid (SCALE-UP-PLAN §1.1 / §4.1). `starter` is
 * always free and shown read-only; silver/gold/elite are editable per region.
 * Amounts are entered/displayed in MAJOR units (rupees / dollars) but stored
 * and sent to the server as integer minor units — the server derives currency
 * from region (NP → NPR, INTL → USD), so we never send currency here. One
 * "Save changes" button sends every editable cell in a single
 * PUT /api/admin/pricing; the server upserts tier_prices and audits
 * 'pricing.update'.
 */
export function PricingGrid({ prices }: { prices: PriceCell[] }) {
  const router = useRouter();

  const byKey = useMemo(() => {
    const m = new Map<string, PriceCell>();
    for (const p of prices) m.set(key(p.region, p.tier), p);
    return m;
  }, [prices]);

  const seed = useMemo(() => {
    const init: Record<string, string> = {};
    for (const region of REGIONS) {
      for (const tier of EDITABLE_TIERS) {
        const cell = byKey.get(key(region.key, tier));
        init[key(region.key, tier)] = cell ? toMajorInput(cell.amountMinor) : '';
      }
    }
    return init;
  }, [byKey]);

  const [edits, setEdits] = useState<Record<string, string>>(seed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from props whenever the authoritative prices change (E3): after a
  // save we router.refresh(), which re-renders with the freshly-saved catalog —
  // without this the grid kept showing the stale mount-time values and a
  // subsequent save would PUT them back over another admin's edit.
  useEffect(() => {
    setEdits(seed);
  }, [seed]);

  const dirty = useMemo(() => {
    for (const region of REGIONS) {
      for (const tier of EDITABLE_TIERS) {
        const cell = byKey.get(key(region.key, tier));
        const original = cell ? toMajorInput(cell.amountMinor) : '';
        if (edits[key(region.key, tier)] !== original) return true;
      }
    }
    return false;
  }, [edits, byKey]);

  function setCell(region: PriceRegion, tier: Tier, value: string) {
    setEdits((prev) => ({ ...prev, [key(region, tier)]: value }));
  }

  async function save() {
    // Only send cells the admin actually changed (E3) — PUTting all 6 every
    // time silently clobbered a concurrent admin's edit to a cell this one
    // never touched. Unchanged cells are left untouched server-side.
    const payload: { region: PriceRegion; tier: Tier; amountMinor: number }[] = [];
    for (const region of REGIONS) {
      for (const tier of EDITABLE_TIERS) {
        const k = key(region.key, tier);
        const existing = byKey.get(k);
        const original = existing ? toMajorInput(existing.amountMinor) : '';
        if (edits[k] === original) continue;
        const minor = toMinor(edits[k]);
        if (minor === null) {
          setError(`That is not a valid amount for ${tierLabel(tier)} in ${region.label}.`);
          return;
        }
        payload.push({ region: region.key, tier, amountMinor: minor });
      }
    }
    if (payload.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/pricing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prices: payload }),
      });
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'You are not allowed to edit pricing.'
            : 'Could not save these prices. Try again.',
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {REGIONS.map((region) => (
        <Card key={region.key}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              marginBottom: 14,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 600,
                fontSize: 15,
              }}
            >
              {region.label}
            </span>
            <span className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
              {region.currency}/month
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: 14,
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: 'var(--gt-text-dim)', marginBottom: 6 }}>
                Starter
              </div>
              <div
                className="gt-numeric"
                style={{ fontSize: 15, color: 'var(--gt-text-dim)' }}
              >
                Free
              </div>
            </div>

            {EDITABLE_TIERS.map((tier) => (
              <label key={tier} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--gt-text-dim)',
                  }}
                >
                  {tierLabel(tier)}
                </span>
                <div style={{ position: 'relative' }}>
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: 13,
                      color: 'var(--gt-text-dim)',
                      pointerEvents: 'none',
                    }}
                  >
                    {region.currency === 'NPR' ? 'Rs' : '$'}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="gt-input"
                    value={edits[key(region.key, tier)] ?? ''}
                    onChange={(e) => setCell(region.key, tier, e.target.value)}
                    disabled={saving}
                    style={{ paddingLeft: 34 }}
                  />
                </div>
                <span style={{ fontSize: 11, color: 'var(--gt-text-dim)' }}>
                  {(() => {
                    const minor = toMinor(edits[key(region.key, tier)] ?? '0');
                    return minor !== null ? formatMoney(minor, region.currency) : '—';
                  })()}
                </span>
              </label>
            ))}
          </div>
        </Card>
      ))}

      {error ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div> : null}

      <div>
        <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
