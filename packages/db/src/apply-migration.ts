/**
 * Applies a generated migration file inside ONE transaction.
 *
 * Why this exists rather than `drizzle-kit push`: push stops on an interactive
 * prompt, and for a unique constraint on a populated table the prompt it offers
 * is "truncate the table?". This script takes a reviewed .sql file, refuses to
 * run if it contains a destructive statement, and applies the whole thing
 * atomically so a failure halfway leaves the database exactly as it started.
 *
 * Run: pnpm --filter @gym/db apply:migration -- migrations/0001_live_delta.sql
 */
import { Pool } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dirname, '../../../.env') });
config({ path: resolve(import.meta.dirname, '../../../apps/web/.env.local') });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: apply-migration <path-to.sql>');
  process.exit(1);
}

/** Statements that can lose data. Their presence aborts the whole run. */
const FORBIDDEN = /\b(DROP\s+TABLE|TRUNCATE|DROP\s+COLUMN|DROP\s+DATABASE|DELETE\s+FROM|DROP\s+SCHEMA)\b/i;

async function main(): Promise<void> {
  const raw = readFileSync(resolve(process.cwd(), file), 'utf8');

  const statements = raw
    .split('--> statement-breakpoint')
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim()
        .replace(/;$/, ''),
    )
    .filter((s) => s.length > 0);

  const destructive = statements.filter((s) => FORBIDDEN.test(s));
  if (destructive.length > 0) {
    console.error(`REFUSING TO RUN: ${destructive.length} destructive statement(s) found:`);
    for (const s of destructive) console.error('  ' + s.slice(0, 160));
    process.exit(1);
  }

  console.log(`${statements.length} statements, none destructive. Applying in one transaction.`);

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  let applied = 0;
  try {
    await client.query('BEGIN');
    for (const statement of statements) {
      await client.query(statement);
      applied += 1;
      if (applied % 25 === 0) console.log(`  ${applied}/${statements.length}`);
    }
    await client.query('COMMIT');
    console.log(`\nCOMMITTED. ${applied} statements applied.`);
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    console.error(`\nROLLED BACK at statement ${applied + 1} of ${statements.length}.`);
    console.error('Statement:', statements[applied]?.slice(0, 300));
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Apply failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
