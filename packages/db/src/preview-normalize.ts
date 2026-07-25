/**
 * READ-ONLY preview of what the normalization pass changes in the live database.
 *
 * `drizzle-kit generate` is useless here — this project has always used
 * `db:push`, so the migrations snapshot is stale and generate emits a full
 * CREATE-everything dump rather than a diff. This script instead asks the LIVE
 * database what exists today for each object the pass touches, so the reported
 * difference is real rather than inferred from a snapshot.
 *
 * Run: pnpm --filter @gym/db preview:normalize
 */
import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dirname, '../../../.env') });
config({ path: resolve(import.meta.dirname, '../../../apps/web/.env.local') });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const sql = neon(url);

/** Indexes this pass ADDS, with the statement push is expected to emit. */
const ADDED_INDEXES = [
  'coach_requests_one_pending',
  'meal_payment_requests_order',
  'meal_payment_requests_cycle',
  'meal_payment_requests_one_live_order',
  'meal_payment_requests_one_live_cycle',
  'saved_addresses_one_default',
  'profiles_email_lower',
];

/** Indexes this pass DROPS as redundant, each covered by a PK/unique prefix. */
const DROPPED_INDEXES = [
  'meal_partners_account',
  'admin_permission_overrides_account',
  'gym_favorites_account',
  'coach_reviews_coach',
  'meals_partner',
];

/** Tables this pass CREATES. */
const NEW_TABLES = ['gym_enquiries', 'payment_settings'];

async function main(): Promise<void> {
  const existing = (await sql`
    select indexname from pg_indexes where schemaname = 'public'
  `) as { indexname: string }[];
  const have = new Set(existing.map((r) => r.indexname));

  console.log('== NEW TABLES ==');
  for (const t of NEW_TABLES) {
    const rows = (await sql`select to_regclass(${'public.' + t}) as reg`) as {
      reg: string | null;
    }[];
    console.log(`  ${rows[0]?.reg ? 'already exists' : 'WILL BE CREATED'}  ${t}`);
  }

  console.log('');
  console.log('== INDEXES / CONSTRAINTS ADDED ==');
  for (const i of ADDED_INDEXES) {
    console.log(`  ${have.has(i) ? 'already exists' : 'WILL BE CREATED'}  ${i}`);
  }

  console.log('');
  console.log('== REDUNDANT INDEXES DROPPED ==');
  for (const i of DROPPED_INDEXES) {
    console.log(`  ${have.has(i) ? 'WILL BE DROPPED ' : 'already absent'}  ${i}`);
  }

  console.log('');
  console.log('== FOREIGN KEY / NULLABILITY CHANGES ==');
  const fks = (await sql`
    select
      c.conname,
      c.confdeltype,
      a.attnotnull
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_attribute a on a.attrelid = t.oid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and t.relname in ('coach_assignments', 'meal_delivery_config')
      and a.attname in ('assigned_by', 'updated_by')
  `) as { conname: string; confdeltype: string; attnotnull: boolean }[];
  const action = (c: string): string =>
    ({ a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' })[c] ?? c;
  if (fks.length === 0) {
    console.log('  meal_delivery_config.updated_by  no FK today -> WILL BE ADDED as ON DELETE SET NULL');
  }
  for (const f of fks) {
    console.log(
      `  ${f.conname}: currently ON DELETE ${action(f.confdeltype)}, column ${f.attnotnull ? 'NOT NULL' : 'nullable'}`,
    );
  }
  console.log('  target state: coach_assignments.assigned_by -> nullable, ON DELETE SET NULL');
  console.log('  target state: meal_delivery_config.updated_by -> FK to accounts, ON DELETE SET NULL');

  console.log('');
  console.log('No statement was executed. This script only reads catalog metadata.');
}

main().catch((error: unknown) => {
  console.error('Preview failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
