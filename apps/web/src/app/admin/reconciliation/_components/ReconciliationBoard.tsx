'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import {
  Button,
  type Column,
  DataTable,
  EmptyState,
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
 *
 * This is a finance screen, so the ONE rule the state machine below exists to
 * enforce is that a figure on screen is always the figure the server returned
 * for the date in the picker. A single `board` union makes the alternatives
 * unrepresentable: numbers live only inside `{ kind: 'ready' }`, so a failed or
 * in-flight load cannot leave the previous day's cash totals sitting under a new
 * date, and a failure cannot fall back to zeroes that read like a quiet day.
 * A failure states that it failed and offers to try again.
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

/**
 * Every state the board can be in. There is deliberately no "stale data plus an
 * error banner" arm: numbers exist only on `ready`.
 */
type BoardState =
  | { kind: 'needs_date' }
  | { kind: 'loading' }
  | { kind: 'ready'; data: ReconResponse }
  | { kind: 'failed'; message: string };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function ReconciliationBoard({ initialDate }: { initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  // Bumped by "Try again" so the same date re-runs the effect.
  const [attempt, setAttempt] = useState(0);
  const [board, setBoard] = useState<BoardState>(
    DATE_PATTERN.test(initialDate) ? { kind: 'loading' } : { kind: 'needs_date' },
  );

  const load = useCallback(async (forDate: string, signal: AbortSignal) => {
    setBoard({ kind: 'loading' });
    try {
      const res = await fetch(
        `/api/admin/reconciliation?date=${encodeURIComponent(forDate)}`,
        { credentials: 'include', signal },
      );
      if (signal.aborted) return;
      if (!res.ok) {
        setBoard({
          kind: 'failed',
          message:
            res.status === 403
              ? 'You do not have access to the daily partner totals.'
              : "We could not load this day's totals.",
        });
        return;
      }
      const parsed = responseSchema.safeParse(await res.json());
      if (signal.aborted) return;
      if (!parsed.success) {
        setBoard({ kind: 'failed', message: "We could not read this day's totals." });
        return;
      }
      setBoard({ kind: 'ready', data: parsed.data });
    } catch {
      if (signal.aborted) return;
      setBoard({ kind: 'failed', message: 'We could not reach the server just now.' });
    }
  }, []);

  useEffect(() => {
    // A half-typed or cleared date must not fire a request the route will 400 —
    // and must not leave the day before it on screen either.
    if (!DATE_PATTERN.test(date)) {
      setBoard({ kind: 'needs_date' });
      return;
    }
    const controller = new AbortController();
    void load(date, controller.signal);
    return () => controller.abort();
  }, [date, attempt, load]);

  const currencyTotals = useMemo(
    () => (board.kind === 'ready' ? totalsByCurrency(board.data.partners) : []),
    [board],
  );
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
        // The download is the same day the route just returned, so it is only
        // offered once that day is actually on screen.
        right={
          board.kind === 'ready' ? <DownloadCsv href={exportHref} label="Download CSV" /> : null
        }
      />

      {board.kind === 'ready' ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 14,
            }}
          >
            <StatTile label="Delivered" value={board.data.totals.delivered} />
            <StatTile label="Refused" value={board.data.totals.refused} />
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

          <DataTable
            columns={COLUMNS}
            rows={board.data.partners}
            rowKey={(r) => r.partnerId}
            empty="No partner activity on this day."
          />
        </>
      ) : null}

      {board.kind === 'loading' ? <SkeletonRows rows={4} cols={6} /> : null}

      {board.kind === 'needs_date' ? (
        <EmptyState
          title="Pick a delivery date"
          description="Choose the day you want to settle and the partner totals will load."
        />
      ) : null}

      {board.kind === 'failed' ? (
        <div role="alert">
          <EmptyState
            title={board.message}
            description="Nothing is shown here rather than figures that might belong to another day. Try again in a moment."
            action={
              <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            }
          />
        </div>
      ) : null}
    </div>
  );
}
