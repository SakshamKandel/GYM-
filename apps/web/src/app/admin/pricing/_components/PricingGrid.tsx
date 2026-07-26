'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, CardHeader, FilterPill, FilterPills } from '@/components/console';
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
  // Which cell the last failed save was about, so the message points at a field
  // instead of leaving the operator to work out which of six it meant. The typed
  // value is never cleared — a rejected save must not cost somebody their input.
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // A save with no page reload has to SAY it landed, or it looks like nothing
  // happened. Cleared the moment the grid is edited again.
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

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

  /** Any edit means the last outcome is no longer what is on screen. */
  function touched() {
    setSaved(false);
    setError(null);
    setErrorKey(null);
  }

  function setCell(region: PriceRegion, tier: Tier, value: string) {
    touched();
    setEdits((prev) => ({ ...prev, [key(region, tier)]: value }));
  }

  function setActive(region: PriceRegion, tier: Tier, value: boolean) {
    touched();
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
          setError(
            `${tierLabel(tier)} in ${region.label} needs an amount in ${region.currency}, with at most two decimals.`,
          );
          setErrorKey(k);
          setSaved(false);
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
    setErrorKey(null);
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
            : 'Could not save these prices. Nothing changed, and what you typed is still here.',
        );
        setSaving(false);
        return;
      }
      setSaving(false);
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 6000);
      router.refresh();
    } catch {
      setError('Could not reach us just now. Nothing changed, and what you typed is still here.');
      setSaving(false);
    }
  }

  /** How many cells this save would touch — the number the action bar quotes
   * back, so "Save changes" is never a leap of faith. */
  const changeCount = useMemo(() => {
    let n = 0;
    for (const region of REGIONS) {
      for (const tier of ALL_TIERS) {
        const k = key(region.key, tier);
        const cell = byKey.get(k);
        if (actives[k] !== (cell ? cell.active : true)) {
          n += 1;
          continue;
        }
        if (tier === 'starter') continue;
        const original = cell ? toMajorInput(cell.amountMinor) : '';
        if (edits[k] !== original) n += 1;
      }
    }
    return n;
  }, [edits, actives, byKey]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {REGIONS.map((region) => {
        // What members see RIGHT NOW, from the saved rows — not from pending
        // edits, so the warning always answers "is the price list live?".
        const liveNow = ALL_TIERS.every((t) => byKey.get(key(region.key, t))?.active === true);
        return (
          <Card key={region.key} padded={false}>
            <CardHeader
              title={
                <>
                  {region.label}
                  <span
                    className="gt-numeric"
                    style={{
                      marginLeft: 8,
                      fontSize: 12,
                      color: 'var(--gt-text-faint)',
                      textTransform: 'none',
                      letterSpacing: '0.02em',
                    }}
                  >
                    {region.currency} a month
                  </span>
                </>
              }
              action={
                liveNow ? (
                  <Badge tone="positive">Members can buy</Badge>
                ) : (
                  <Badge tone="warning">Hidden from members</Badge>
                )
              }
            />

            {liveNow ? null : (
              <div
                style={{
                  padding: '12px 18px',
                  fontSize: 13,
                  color: 'var(--gt-text)',
                  background: 'var(--gt-warning-weak)',
                  borderBottom: '1px solid var(--gt-border)',
                }}
              >
                Nobody in {region.label} can see a price right now. Every tier needs an amount
                and needs to be on sale.
              </div>
            )}

            {/* A price list is a record, so it reads as a table: one row per
                tier, the amount right-aligned under a single header, and the
                on-sale state in its own column instead of hiding under each
                input as a 20px chip. */}
            <div className="gt-table-wrap">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr>
                    <Th>Tier</Th>
                    <Th align="right">Price</Th>
                    <Th align="right">Members are charged</Th>
                    <Th>On sale</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <Td>
                      <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 600 }}>
                        {tierLabel('starter')}
                      </span>
                    </Td>
                    <Td align="right">
                      <span style={{ color: 'var(--gt-text-faint)' }}>Always free</span>
                    </Td>
                    <Td align="right">
                      <span className="gt-numeric" style={{ color: 'var(--gt-text-dim)' }}>
                        Free
                      </span>
                    </Td>
                    <Td>
                      <OnSaleToggle
                        tier="starter"
                        region={region}
                        on={actives[key(region.key, 'starter')] ?? true}
                        exists={byKey.has(key(region.key, 'starter'))}
                        disabled={saving}
                        onChange={(v) => setActive(region.key, 'starter', v)}
                      />
                    </Td>
                  </tr>

                  {EDITABLE_TIERS.map((tier) => {
                    const k = key(region.key, tier);
                    const raw = edits[k] ?? '';
                    const minor = toMinor(raw);
                    const flagged = errorKey === k;
                    const inputId = `price-${k}`;
                    return (
                      <tr key={tier}>
                        <Td>
                          <label
                            htmlFor={inputId}
                            style={{ fontFamily: 'var(--font-heading)', fontWeight: 600 }}
                          >
                            {tierLabel(tier)}
                          </label>
                        </Td>
                        <Td align="right">
                          <div style={{ position: 'relative', maxWidth: 160, marginLeft: 'auto' }}>
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
                              id={inputId}
                              type="number"
                              min={0}
                              step="0.01"
                              className="gt-input gt-numeric"
                              value={raw}
                              onChange={(e) => setCell(region.key, tier, e.target.value)}
                              disabled={saving}
                              aria-invalid={flagged || undefined}
                              aria-describedby={flagged ? 'pricing-error' : undefined}
                              style={{
                                paddingLeft: 34,
                                textAlign: 'right',
                                borderColor: flagged ? 'var(--gt-danger)' : undefined,
                              }}
                            />
                          </div>
                        </Td>
                        <Td align="right">
                          <span
                            className="gt-numeric"
                            style={{
                              fontSize: 15,
                              color: minor !== null ? 'var(--gt-text)' : 'var(--gt-text-faint)',
                            }}
                          >
                            {minor !== null ? formatMoney(minor, region.currency) : 'Not set'}
                          </span>
                        </Td>
                        <Td>
                          <OnSaleToggle
                            tier={tier}
                            region={region}
                            on={actives[k] ?? true}
                            exists={byKey.has(k)}
                            disabled={saving}
                            onChange={(v) => setActive(region.key, tier, v)}
                          />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div
              style={{
                fontSize: 12,
                color: 'var(--gt-text-faint)',
                padding: '12px 18px',
                borderTop: '1px solid var(--gt-border)',
              }}
            >
              Taking any tier off sale hides the whole {region.label} price list from members
              until it is back on.
            </div>
          </Card>
        );
      })}

      {error ? (
        <div
          id="pricing-error"
          role="alert"
          style={{
            padding: '12px 14px',
            borderRadius: 'var(--gt-radius-sm)',
            border: '1px solid color-mix(in srgb, var(--gt-danger) 32%, transparent)',
            background: 'var(--gt-danger-weak)',
            color: 'var(--gt-text)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      {/* The action bar answers three questions at once: is there anything to
          save, how much, and did the last save land. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        <span role="status" aria-live="polite" style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
          {saving
            ? ''
            : dirty
              ? `${changeCount} change${changeCount === 1 ? '' : 's'} not saved yet`
              : saved
                ? 'Saved. Members see these prices now.'
                : 'Nothing to save.'}
        </span>
      </div>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      style={{
        textAlign: align,
        padding: '12px 18px',
        fontFamily: 'var(--font-heading)',
        fontWeight: 600,
        fontSize: 12,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        color: 'var(--gt-text-dim)',
        borderBottom: '1px solid var(--gt-border)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <td
      style={{
        textAlign: align,
        padding: '12px 18px',
        borderBottom: '1px solid var(--gt-border)',
        verticalAlign: 'middle',
      }}
    >
      {children}
    </td>
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
      <span style={{ fontSize: 12, color: 'var(--gt-text-faint)' }}>
        Set a price first
      </span>
    );
  }
  // A segmented pair rather than a 20px pill that toggled on click: both
  // choices are visible, the state is announced, each half clears the 44px
  // target, and hover / pressed / focus / disabled all come from the shared
  // `.gt-pill` rules instead of being absent. Neutral tone deliberately — the
  // one accent on this page belongs to Save changes.
  return (
    <FilterPills label={`${tierLabel(tier)} in ${region.label}`}>
      <FilterPill
        selected={on}
        tone="neutral"
        disabled={disabled}
        onClick={() => onChange(true)}
        aria-label={`Put ${tierLabel(tier)} in ${region.label} on sale`}
      >
        On sale
      </FilterPill>
      <FilterPill
        selected={!on}
        tone="neutral"
        disabled={disabled}
        onClick={() => onChange(false)}
        aria-label={`Take ${tierLabel(tier)} in ${region.label} off sale`}
      >
        Off
      </FilterPill>
    </FilterPills>
  );
}
