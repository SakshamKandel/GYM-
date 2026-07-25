import { createDb } from '@gym/db';
import { config } from 'dotenv';
import { codDeliveredBackfillSql, codDeliveredPreviewSql } from './codBackfillSql.ts';

/**
 * One-time backfill runner: close the payment on cash-on-delivery orders that
 * were delivered before the delivered transition started doing it itself.
 * The reasoning, and the exact scope, live in {@link codDeliveredPreviewSql}'s
 * module doc (./codBackfillSql.ts).
 *
 * Run from the repo root (`pnpm dlx tsx` also works, the way the packages/db
 * scripts are run, if tsx is not already installed):
 *   pnpm exec tsx apps/web/src/lib/meals/backfillCodPaid.ts            # preview
 *   pnpm exec tsx apps/web/src/lib/meals/backfillCodPaid.ts --apply    # write
 *
 * Options:
 *   --apply             perform the write. Without it this only reads.
 *   --before=YYYY-MM-DD only orders with a delivery date before this day.
 *
 * Safe to run twice: the write only matches orders that are still unpaid, so a
 * second run reports nothing left to do. Keep the printed output with the
 * period's books, since a payment status change leaves no order event of its
 * own (the events table records status transitions only).
 */

config({ path: '.env' });
config({ path: 'apps/web/.env.local' });
config({ path: '../../.env' });
config({ path: '.env.local' });

interface Options {
  apply: boolean;
  before?: string;
}

function parseArgs(argv: readonly string[]): Options | string {
  const options: Options = { apply: false };
  for (const arg of argv) {
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg.startsWith('--before=')) {
      const value = arg.slice('--before='.length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return `--before must be YYYY-MM-DD, got "${value}"`;
      options.before = value;
      continue;
    }
    return `Unknown option "${arg}". Use --apply and --before=YYYY-MM-DD.`;
  }
  return options;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : String(value ?? '');
}

/** Postgres returns bigint sums as strings, counts as numbers. Accept both. */
function count(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function money(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (typeof parsed === 'string') {
    console.error(parsed);
    return 1;
  }
  const scope = parsed.before === undefined ? {} : { before: parsed.before };

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Run this from the repo root, or export it first.');
    return 1;
  }
  const db = createDb(url);

  const preview = await db.execute(codDeliveredPreviewSql(scope));
  const rows = preview.rows;
  if (rows.length === 0) {
    console.log('Nothing to do: every delivered cash order already reads as paid.');
    return 0;
  }

  console.log(
    parsed.before === undefined
      ? 'Delivered cash orders still marked unpaid:'
      : `Delivered cash orders still marked unpaid, before ${parsed.before}:`,
  );
  let totalOrders = 0;
  for (const row of rows) {
    const orders = count(row, 'orders');
    totalOrders += orders;
    console.log(
      `  partner ${text(row, 'partnerId')}  ${orders} order(s)  ` +
        `${money(count(row, 'totalMinor'), text(row, 'currency'))}  ` +
        `${text(row, 'firstDate')} to ${text(row, 'lastDate')}`,
    );
  }

  if (!parsed.apply) {
    console.log(
      `\n${totalOrders} order(s) would be closed as paid. Re-run with --apply to write it.`,
    );
    return 0;
  }

  const written = await db.execute(codDeliveredBackfillSql(scope));
  console.log(`\nClosed ${written.rows.length} order(s) as paid:`);
  for (const row of written.rows) {
    console.log(
      `  ${text(row, 'id')}  partner ${text(row, 'partnerId')}  ` +
        `${money(count(row, 'totalMinor'), text(row, 'currency'))}  ${text(row, 'deliveryDate')}`,
    );
  }
  return 0;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    console.error('The backfill did not finish. Nothing partial was written.', err);
    process.exit(1);
  });
