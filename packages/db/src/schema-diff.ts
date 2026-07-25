/**
 * READ-ONLY diff between the Drizzle schema and the live database.
 *
 * `drizzle-kit push` cannot be used unattended here: it stops on an interactive
 * prompt and, for a unique constraint on a populated table, the prompt it offers
 * is "truncate the table?". So the delta is computed here instead and applied by
 * hand as explicit, reviewed statements.
 *
 * Run: pnpm --filter @gym/db diff:schema
 */
import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { resolve } from 'node:path';
import * as schema from './schema';

config({ path: resolve(import.meta.dirname, '../../../.env') });
config({ path: resolve(import.meta.dirname, '../../../apps/web/.env.local') });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const sql = neon(url);

function isPgTable(value: unknown): value is PgTable {
  if (typeof value !== 'object' || value === null) return false;
  return Object.getOwnPropertySymbols(value).some((s) =>
    s.toString().includes('drizzle:Name'),
  );
}

async function main(): Promise<void> {
  const liveTables = new Set(
    (
      (await sql`select table_name from information_schema.tables where table_schema = 'public'`) as {
        table_name: string;
      }[]
    ).map((r) => r.table_name),
  );

  const liveColumns = new Map<string, Set<string>>();
  for (const row of (await sql`
    select table_name, column_name from information_schema.columns where table_schema = 'public'
  `) as { table_name: string; column_name: string }[]) {
    const set = liveColumns.get(row.table_name) ?? new Set<string>();
    set.add(row.column_name);
    liveColumns.set(row.table_name, set);
  }

  const liveIndexes = new Set(
    (
      (await sql`select indexname from pg_indexes where schemaname = 'public'`) as {
        indexname: string;
      }[]
    ).map((r) => r.indexname),
  );

  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  const missingIndexes: string[] = [];
  const codeTables = new Set<string>();

  for (const value of Object.values(schema)) {
    if (!isPgTable(value)) continue;
    const cfg = getTableConfig(value);
    codeTables.add(cfg.name);

    if (!liveTables.has(cfg.name)) {
      missingTables.push(cfg.name);
      continue; // its columns and indexes come with the table
    }

    const live = liveColumns.get(cfg.name) ?? new Set<string>();
    for (const col of cfg.columns) {
      if (!live.has(col.name)) {
        missingColumns.push(`${cfg.name}.${col.name}  (${col.getSQLType()}${col.notNull ? ' NOT NULL' : ''})`);
      }
    }
    for (const idx of cfg.indexes) {
      const name = idx.config.name;
      if (name && !liveIndexes.has(name)) missingIndexes.push(`${cfg.name}: ${name}`);
    }
    for (const uq of cfg.uniqueConstraints) {
      const name = uq.name;
      if (name && !liveIndexes.has(name)) missingIndexes.push(`${cfg.name}: ${name} (unique constraint)`);
    }
  }

  const extraTables = [...liveTables].filter((t) => !codeTables.has(t) && t !== '__drizzle_migrations');

  const section = (title: string, rows: string[]): void => {
    console.log(`\n== ${title} (${rows.length}) ==`);
    for (const r of rows) console.log('  ' + r);
    if (rows.length === 0) console.log('  none');
  };

  section('TABLES IN CODE, MISSING FROM DATABASE', missingTables);
  section('COLUMNS MISSING FROM DATABASE', missingColumns);
  section('INDEXES / UNIQUES MISSING FROM DATABASE', missingIndexes);
  section('TABLES IN DATABASE, NOT IN CODE (never dropped automatically)', extraTables);

  console.log('\nRead-only. No statement was executed.');
}

main().catch((error: unknown) => {
  console.error('Diff failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
