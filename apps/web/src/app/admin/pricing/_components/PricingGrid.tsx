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
  /** On sale. Every catalog read filters on this, so off means nobody can buy it. */
  active: boolean;
}

const REGIONS: readonly { key: PriceRegion; label: string; currency: string }[] = [
  { key: 'NP', label: 'Nepal', currency: 'NPR' },
  { key: 'INTL', label: 'International', currency: 'USD' },
];

const EDITABLE_TIERS: readonly Tier[] = ['silver', 'gold', 'elite'];

/** Every tier a region's price list needs before members can see any of it. */
const ALL_TIERS: readonly Tier[] = ['starter', ...EDITABLE_TIERS];

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
 * "Save changes" button sends every changed cell in a single
 * PUT /api/admin/pricing; the server upserts tier_prices and audits
 * 'pricing.update'.
 *
 * Each tier also carries an on-sale switch. That flag is what every catalog read
 * filters on, and the grid used to ignore it completely: a tier switched off
 * showed a perfectly normal price, took a save that reported success, and stayed
 * unbuyable with nothing on screen to explain it. It is now read, shown, kept as
 * it was on an ordinary price edit, and switchable.
 *
 * Members only ever see a region's price list when EVERY tier in it is on sale
 * (that is the rule the paywall, the manual-payment amount, and the public price
 * list all apply), so taking one tier off takes the whole region's list down.
 * The card says so, both before and after the fact.
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

  const activeSeed = useMemo(() => {
    const init: Record<string, boolean> = {};
    for (const region of REGIONS) {
      for (const tier of ALL_TIERS) {
        const cell = byKey.get(key(region.key, tier));
        // No row yet means nothing to withdraw; a new one starts on sale.
        init[key(region.key, tier)] = cell ? cell.active : true;
      }
    }
    return init;
  }, [byKey]);

  const [edits, setEdits] = useState<Record<string, string>>(seed);
  const [actives, setActives] = useState<Record<string, boolean>>(activeSeed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from props whenever the authoritative prices change (E3): after a
  // save we router.refresh(), which re-renders with the freshly-saved catalog —
  // without this the grid kept showing the stale mount-time values and a
  // subsequent save would PUT them back over another admin's edit.
  useEffect(() => {
    setEdits(seed);
  }, [seed]);

  useEffect(() => {
    setActives(activeSeed);
  }, [activeSeed]);

  const dirty = useMemo(() => {
    for (const region of REGIONS) {
      for (const tier of ALL_TIERS) {
        const k = key(region.key, tier);
        const cell = byKey.get(k);
        if (actives[k] !== (cell ? cell.active : true)) return true;
        if (tier === 'starter') continue;
        const original = cell ? toMajorInput(cell.amountMinor) : '';
        if (edits[k] !== original) return true;
      }
    }
    return false;
  }, [edits, actives, byKey]);

  function setCell(region: PriceRegion, tier: Tier, value: string) {
    setEdits((prev) => ({ ...prev, [key(region, tier)]: value }));
  }

  function setActive(region: PriceRegion, tier: Tier, value: boolean) {
    setActives((prev) => ({ ...prev, [key(region, tier)]: value }));
  }

  async function save() {
    // Only send cells the admin actually changed (E3) — PUTting all 6 every
    // time silently clobbered a concurrent admin's edit to a cell this one
    // never touched. Unchanged cells are left untouched server-side.
    // `active` is sent ONLY when this admin actually switched it, for the same
    // reason unchanged prices are left out: the server treats a missing flag as
    // "leave it alone", so a price edit here can never undo someone else's
    // withdrawal in another tab.
    const payload: {
      region: PriceRegion;
      tier: Tier;
      amountMinor: number;
      active?: boolean;
    }[] = [];
    for (const region of REGIONS) {
      for (const tier of ALL_TIERS) {
        const k = key(region.key, tier);
        const existing = byKey.get(k);
        const savedActive = existing ? existing.active : true;
        const nextActive = actives[k] ?? savedActive;
        const activeChanged = nextActive !== savedActive;

        // starter has no editable price: its amount always rides along as the
        // persisted one, and only the on-sale switch can change here. With no
        // persisted row there is nothing to switch, so nothing to send.
        if (tier === 'starter') {
          if (!activeChanged || !existing) continue;
          payload.push({
            region: region.key,
            tier,
            amountMinor: existing.amountMinor,
            active: nextActive,
          });
          continue;
        }

        const original = existing ? toMajorInput(existing.amountMinor) : '';
        const amountChanged = edits[k] !== original;
        if (!amountChanged && !activeChanged) continue;
        const minor = toMinor(edits[k]);
        if (minor === null) {
          setError(`That is not a valid amount for ${tierLabel(tier)} in ${region.label}.`);
          return;
        }
        payload.push({
          region: region.key,
          tier,
          amountMinor: minor,
          ...(activeChanged ? { active: nextActive } : {}),
        });
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
      {REGIONS.map((region) => {
        // What members see RIGHT NOW, from the saved rows — not from pending
        // edits, so the warning always answers "is the price list live?".
        const liveNow = ALL_TIERS.every((t) => byKey.get(key(region.key, t))?.active === true);
        return (
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

            {liveNow ? null : (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  marginBottom: 14,
                  fontSize: 13,
                  color: 'var(--gt-warning)',
                  background: 'color-mix(in srgb, var(--gt-warning) 8%, var(--gt-surface))',
                  border: '1px solid color-mix(in srgb, var(--gt-warning) 32%, transparent)',
                }}
              >
                Members in {region.label} cannot see any prices right now. Every tier
                needs a price and needs to be on sale.
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: 14,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>Starter</span>
                <div
                  className="gt-numeric"
                  style={{ fontSize: 15, color: 'var(--gt-text-dim)' }}
                >
                  Free
                </div>
                <OnSaleToggle
                  tier="starter"
                  region={region}
                  on={actives[key(region.key, 'starter')] ?? true}
                  exists={byKey.has(key(region.key, 'starter'))}
                  disabled={saving}
                  onChange={(v) => setActive(region.key, 'starter', v)}
                />
              </div>

              {EDITABLE_TIERS.map((tier) => (
                <div key={tier} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                  <OnSaleToggle
                    tier={tier}
                    region={region}
                    on={actives[key(region.key, tier)] ?? true}
                    exists={byKey.has(key(region.key, tier))}
                    disabled={saving}
                    onChange={(v) => setActive(region.key, tier, v)}
                  />
                </div>
              ))}
            </div>

            <div style={{ fontSize: 11, color: 'var(--gt-text-faint)', marginTop: 12 }}>
              Taking any tier off sale hides the whole {region.label} price list from
              members until it is back on.
            </div>
          </Card>
        );
      })}

      {error ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div> : null}

      <div>
        <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}

/**
 * One tier's on-sale switch. Off means members cannot buy that tier, which is
 * exactly what the flag does everywhere it is read. Without a saved price row
 * there is nothing to switch, so the control reads as unavailable rather than
 * pretending to hold a state that is not stored anywhere.
 */
function OnSaleToggle({
  tier,
  region,
  on,
  exists,
  disabled,
  onChange,
}: {
  tier: Tier;
  region: { key: PriceRegion; label: string };
  on: boolean;
  exists: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  if (!exists) {
    return (
      <span style={{ fontSize: 11, color: 'var(--gt-text-faint)' }}>
        Set a price to put this on sale.
      </span>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${tierLabel(tier)} in ${region.label} on sale`}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        alignSelf: 'flex-start',
        fontSize: 11,
        fontFamily: 'var(--font-heading)',
        fontWeight: 600,
        padding: '4px 10px',
        borderRadius: 999,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        color: on ? 'var(--gt-text)' : 'var(--gt-warning)',
        background: on ? 'var(--gt-surface-sunken)' : 'transparent',
        border: on
          ? '1px solid var(--gt-border)'
          : '1px solid color-mix(in srgb, var(--gt-warning) 40%, transparent)',
      }}
    >
      {on ? 'On sale' : 'Not on sale'}
    </button>
  );
}
