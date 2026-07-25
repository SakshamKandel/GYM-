'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import {
  type Column,
  DataTable,
  SkeletonRows,
  StatTile,
  TextField,
  Toolbar,
} from '@/components/console';
import { formatMoney } from '@/lib/format';
import { DownloadCsv } from '../../_components/DownloadCsv';

/**
 * Daily all-partner reconciliation board. Reads GET /api/admin/reconciliation,
 * which had been complete but unreachable — finance could only get these
 * numbers by calling the endpoint by hand.
 *
 * For one Kathmandu delivery date it shows, per partner: cash the rider
 * collected at the door (COD), digital money the platform is holding for that
 * day, the delivered/refused split, and the running lifetime balance still owed
 * to that partner. The CSV button hands the same date to the route's existing
 * `format=csv` branch, so the download always matches what's on screen.
 */

const rowSchema = z.object({
  partnerId: z.string(),
  name: z.string(),
  currency: z.string(),
  codCollectedMinor: z.number(),
  digitalHeldMinor: z.number(),
  delivered: z.number(),
  refused: z.number(),
  owedMinor: z.number(),
});

const responseSchema = z.object({
  date: z.string(),
  partners: z.array(rowSchema),
  totals: z.object({
    codCollectedMinor: z.number(),
    digitalHeldMinor: z.number(),
    delivered: z.number(),
    refused: z.number(),
    owedMinor: z.number(),
  }),
});

type ReconRow = z.infer<typeof rowSchema>;
type ReconResponse = z.infer<typeof responseSchema>;

/** Money totals per currency — partners may bill in NPR or USD, so a single
 *  summed figure would be meaningless the day both appear. */
interface CurrencyTotals {
  currency: string;
  codCollectedMinor: number;
  digitalHeldMinor: number;
  owedMinor: number;
}

function totalsByCurrency(rows: readonly ReconRow[]): CurrencyTotals[] {
  const byCurrency = new Map<string, CurrencyTotals>();
  for (const row of rows) {
    const acc = byCurrency.get(row.currency) ?? {
      currency: row.currency,
      codCollectedMinor: 0,
      digitalHeldMinor: 0,
      owedMinor: 0,
    };
    acc.codCollectedMinor += row.codCollectedMinor;
    acc.digitalHeldMinor += row.digitalHeldMinor;
    acc.owedMinor += row.owedMinor;
    byCurrency.set(row.currency, acc);
  }
  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

const COLUMNS: Column<ReconRow>[] = [
  { key: 'name', header: 'Partner', render: (r) => r.name },
  { key: 'delivered', header: 'Delivered', align: 'right', render: (r) => r.delivered },
  { key: 'refused', header: 'Refused', align: 'right', render: (r) => r.refused },
  {
    key: 'cod',
    header: 'Cash collected',
    align: 'right',
    render: (r) => (
      <span className="gt-numeric">{formatMoney(r.codCollectedMinor, r.currency)}</span>
    ),
  },
  {
    key: 'digital',
    header: 'Digital held',
    align: 'right',
    render: (r) => (
      <span className="gt-numeric">{formatMoney(r.digitalHeldMinor, r.currency)}</span>
    ),
  },
  {
    key: 'owed',
    header: 'Owed (lifetime)',
    align: 'right',
    render: (r) => <span className="gt-numeric">{formatMoney(r.owedMinor, r.currency)}</span>,
  },
];

export function ReconciliationBoard({ initialDate }: { initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState<ReconResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (forDate: string, signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/reconciliation?date=${encodeURIComponent(forDate)}`,
        { credentials: 'include', signal },
      );
      if (signal.aborted) return;
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'You are not allowed to view reconciliation.'
            : 'Could not load this day. Try again.',
        );
        setLoading(false);
        return;
      }
      const parsed = responseSchema.safeParse(await res.json());
      if (signal.aborted) return;
      if (!parsed.success) {
        setError('Unexpected response from the server.');
        setLoading(false);
        return;
      }
      setData(parsed.data);
      setLoading(false);
    } catch {
      if (signal.aborted) return;
      setError('Could not reach us just now. Try again.');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // A half-typed date ("2026-0") must not fire a request the route will 400.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const controller = new AbortController();
    void load(date, controller.signal);
    return () => controller.abort();
  }, [date, load]);

  const rows = data?.partners ?? [];
  const currencyTotals = useMemo(() => totalsByCurrency(data?.partners ?? []), [data]);
  const exportHref = `/api/admin/reconciliation?date=${encodeURIComponent(date)}&format=csv`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Toolbar
        left={
          <div style={{ minWidth: 200 }}>
            <TextField
              label="Delivery date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              hint="Kathmandu calendar day."
            />
          </div>
        }
        right={<DownloadCsv href={exportHref} label="Download CSV" />}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 14,
        }}
      >
        <StatTile label="Delivered" value={data?.totals.delivered ?? 0} />
        <StatTile label="Refused" value={data?.totals.refused ?? 0} />
        {currencyTotals.map((t) => (
          <StatTile
            key={`cod-${t.currency}`}
            label={`Cash collected (${t.currency})`}
            value={formatMoney(t.codCollectedMinor, t.currency)}
          />
        ))}
        {currencyTotals.map((t) => (
          <StatTile
            key={`digital-${t.currency}`}
            label={`Digital held (${t.currency})`}
            value={formatMoney(t.digitalHeldMinor, t.currency)}
          />
        ))}
        {currencyTotals.map((t) => (
          <StatTile
            key={`owed-${t.currency}`}
            label={`Owed to partners (${t.currency})`}
            value={formatMoney(t.owedMinor, t.currency)}
          />
        ))}
      </div>

      {error ? (
        <div role="alert" style={{ color: 'var(--gt-danger)', fontSize: 13 }}>
          {error}
        </div>
      ) : null}

      {loading && data === null ? (
        <SkeletonRows rows={4} cols={6} />
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          rowKey={(r) => r.partnerId}
          empty="No partner activity on this day."
        />
      )}
    </div>
  );
}
