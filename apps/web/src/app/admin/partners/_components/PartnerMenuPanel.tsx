'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, ConfirmButton } from '@/components/console';
import { formatMoney } from '@/lib/format';

/**
 * The restaurant's menu, read-only, inside the admin partner drawer, with one
 * action: take a dish off the menu.
 *
 * Until now staff could not see a single dish, let alone take one down. The only
 * lever was closing the whole restaurant, which is refused outright while orders
 * are live — so a bad listing had no remedy at all.
 *
 * Prices and dish details stay the restaurant's own. Putting a dish back is its
 * call too, from its menu screen; this panel only takes one down.
 */

interface MenuItem {
  id: string;
  name: string;
  priceMinor: number;
  currency: string;
  dietType: 'veg' | 'non_veg' | 'egg';
  kcal: number;
  isActive: boolean;
  sortOrder: number;
}

interface MenuResponse {
  partnerId: string;
  currency: string;
  meals: MenuItem[];
}

const DIET_LABEL: Record<MenuItem['dietType'], string> = {
  veg: 'Veg',
  non_veg: 'Non veg',
  egg: 'Egg',
};

export function PartnerMenuPanel({ partnerId }: { partnerId: string }) {
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (id: string, signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/partners/${encodeURIComponent(id)}/meals`, {
        credentials: 'include',
        signal,
      });
      if (signal.aborted) return;
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'You are not allowed to see this menu.'
            : 'Could not load the menu.',
        );
        setItems(null);
        setLoading(false);
        return;
      }
      const data = (await res.json()) as MenuResponse;
      if (signal.aborted) return;
      setItems(data.meals ?? []);
      setLoading(false);
    } catch {
      if (signal.aborted) return;
      setError('Could not reach us just now. Try again.');
      setItems(null);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(partnerId, controller.signal);
    return () => controller.abort();
  }, [partnerId, load]);

  async function unlist(mealId: string) {
    setBusyId(mealId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/partners/${encodeURIComponent(partnerId)}/meals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mealId }),
      });
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'You are not allowed to change this menu.'
            : res.status === 404
              ? 'That dish is no longer on this menu.'
              : 'Nothing changed. Try again.',
        );
        setBusyId(null);
        return;
      }
      const data = (await res.json()) as { meal?: MenuItem };
      const updated = data.meal;
      setItems((prev) =>
        prev
          ? prev.map((m) => (m.id === mealId ? (updated ?? { ...m, isActive: false }) : m))
          : prev,
      );
      setBusyId(null);
    } catch {
      setError('Could not reach us just now, so nothing changed. Try again.');
      setBusyId(null);
    }
  }

  const listed = items?.filter((m) => m.isActive).length ?? 0;

  return (
    <div
      style={{
        paddingTop: 16,
        borderTop: '1px solid var(--gt-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 12,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            color: 'var(--gt-text-dim)',
            fontFamily: 'var(--font-heading)',
          }}
        >
          Menu
        </span>
        {items ? (
          <span style={{ fontSize: 11, color: 'var(--gt-text-dim)' }}>
            {listed} on the menu of {items.length}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>Loading menu…</div>
      ) : items && items.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
          This restaurant has not added any dishes yet.
        </div>
      ) : items ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((m) => (
            <div
              key={m.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--gt-border)',
                opacity: m.isActive ? 1 : 0.6,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                  <span className="gt-numeric">{formatMoney(m.priceMinor, m.currency)}</span>
                  {' · '}
                  {DIET_LABEL[m.dietType]}
                  {' · '}
                  <span className="gt-numeric">{m.kcal}</span> kcal
                </div>
              </div>
              {m.isActive ? (
                <ConfirmButton
                  label="Unlist"
                  confirmLabel="Take off the menu?"
                  busyLabel="Unlisting…"
                  busy={busyId === m.id}
                  size="sm"
                  onConfirm={() => unlist(m.id)}
                />
              ) : (
                <Badge tone="neutral">Off the menu</Badge>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {error ? <div style={{ fontSize: 13, color: 'var(--gt-danger)' }}>{error}</div> : null}

      <div style={{ fontSize: 11, color: 'var(--gt-text-faint)' }}>
        Members stop seeing a dish the moment it is unlisted, and any weekly plan
        built on that dish stops being delivered. Orders already placed are not
        touched. The restaurant can put it back from its own menu screen.
      </div>
    </div>
  );
}
