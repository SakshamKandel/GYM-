/**
 * READ-ONLY pre-flight for the normalization migration.
 *
 * Every constraint added in that pass is a partial-unique or functional-unique
 * index, and Postgres REFUSES to create one when the table already holds rows
 * that violate it. This script reports those rows so they can be resolved
 * deliberately (cancel the older duplicate, merge the legacy profile) instead of
 * discovering the failure halfway through a push against a live database.
 *
 * Run: pnpm --filter @gym/db check:constraints
 */
import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dirname, '../../../.env') });
config({ path: resolve(import.meta.dirname, '../../../apps/web/.env.local') });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set — cannot run the pre-flight.');
  process.exit(1);
}

const sql = neon(url);

async function tableExists(name: string): Promise<boolean> {
  const rows = (await sql`select to_regclass(${'public.' + name}) as reg`) as {
    reg: string | null;
  }[];
  return rows[0]?.reg !== null;
}

async function main(): Promise<void> {
  let blocking = 0;

  // 1. coach_requests: one pending request per member.
  if (await tableExists('coach_requests')) {
    const rows = (await sql`
      select user_id, count(*)::int as n
      from coach_requests
      where status = 'pending'
      group by user_id
      having count(*) > 1
    `) as { user_id: string; n: number }[];
    if (rows.length === 0) {
      console.log('OK   coach_requests_one_pending — no member holds 2+ pending requests');
    } else {
      blocking += rows.length;
      console.log(`BLOCK coach_requests_one_pending — ${rows.length} member(s) hold multiple pending requests:`);
      for (const r of rows) console.log(`        user_id=${r.user_id} pending=${r.n}`);
      console.log('        Resolve: cancel all but the newest pending row per member.');
    }
  }

  // 2. meal_payment_requests: one live (pending) request per order / cycle.
  if (await tableExists('meal_payment_requests')) {
    const byOrder = (await sql`
      select order_id, count(*)::int as n
      from meal_payment_requests
      where status = 'pending' and order_id is not null
      group by order_id
      having count(*) > 1
    `) as { order_id: string; n: number }[];
    const byCycle = (await sql`
      select cycle_id, count(*)::int as n
      from meal_payment_requests
      where status = 'pending' and cycle_id is not null
      group by cycle_id
      having count(*) > 1
    `) as { cycle_id: string; n: number }[];
    if (byOrder.length === 0 && byCycle.length === 0) {
      console.log('OK   meal_payment_requests one-live-per-target — no duplicate pending receipts');
    } else {
      blocking += byOrder.length + byCycle.length;
      console.log(`BLOCK meal_payment_requests — ${byOrder.length} order(s) and ${byCycle.length} cycle(s) carry multiple pending receipts:`);
      for (const r of byOrder) console.log(`        order_id=${r.order_id} pending=${r.n}`);
      for (const r of byCycle) console.log(`        cycle_id=${r.cycle_id} pending=${r.n}`);
      console.log('        Resolve: reject the superseded receipts, keep the newest, before pushing.');
    }
  }

  // 3. profiles: legacy identity root joined to accounts by lowercase email.
  if (await tableExists('profiles')) {
    const rows = (await sql`
      select lower(email) as email, count(*)::int as n
      from profiles
      where email is not null
      group by lower(email)
      having count(*) > 1
    `) as { email: string; n: number }[];
    if (rows.length === 0) {
      console.log('OK   profiles_email_lower — no duplicate legacy emails');
    } else {
      blocking += rows.length;
      console.log(`BLOCK profiles_email_lower — ${rows.length} email(s) appear on multiple legacy profiles:`);
      for (const r of rows) console.log(`        ${r.email} rows=${r.n}`);
      console.log('        Note: these are exactly the members whose account deletion is permanently blocked today.');
    }
  }

  // 4. saved_addresses: one default per account.
  if (await tableExists('saved_addresses')) {
    const rows = (await sql`
      select account_id, count(*)::int as n
      from saved_addresses
      where is_default = true
      group by account_id
      having count(*) > 1
    `) as { account_id: string; n: number }[];
    if (rows.length === 0) {
      console.log('OK   saved_addresses_one_default — no account has two default addresses');
    } else {
      blocking += rows.length;
      console.log(`BLOCK saved_addresses_one_default — ${rows.length} account(s) have multiple defaults:`);
      for (const r of rows) console.log(`        account_id=${r.account_id} defaults=${r.n}`);
      console.log('        Resolve: keep the most recently updated default per account.');
    }
  }

  // 5. meal_delivery_config.updated_by becomes a real FK — a value pointing at a
  //    hard-deleted staffer would make the constraint creation fail.
  if (await tableExists('meal_delivery_config')) {
    const rows = (await sql`
      select c.updated_by
      from meal_delivery_config c
      where c.updated_by is not null
        and not exists (select 1 from accounts a where a.id = c.updated_by)
    `) as { updated_by: string }[];
    if (rows.length === 0) {
      console.log('OK   meal_delivery_config_updated_by fk — no dangling editor reference');
    } else {
      blocking += rows.length;
      console.log(`BLOCK meal_delivery_config.updated_by references ${rows.length} deleted account(s):`);
      for (const r of rows) console.log(`        updated_by=${r.updated_by}`);
      console.log('        Resolve: null the column before adding the foreign key.');
    }
  }

  // 6. coach_assignments.assigned_by — how many rows would a staff deletion take
  //    out today (the ON DELETE CASCADE P0).
  if (await tableExists('coach_assignments')) {
    const rows = (await sql`
      select count(*)::int as n
      from coach_assignments
      where assigned_by is not null
        and assigned_by <> coach_id
        and assigned_by <> user_id
    `) as { n: number }[];
    console.log(
      `INFO coach_assignments: ${rows[0]?.n ?? 0} pairing(s) were created by a third-party staffer. ` +
        'Since the foreign key became ON DELETE SET NULL these survive that staffer being deleted; ' +
        'before the fix they were destroyed with them.',
    );
  }

  console.log('');
  console.log(
    blocking === 0
      ? 'PRE-FLIGHT CLEAN — every new constraint can be created safely.'
      : `PRE-FLIGHT BLOCKED — ${blocking} group(s) must be resolved before pushing.`,
  );
}

main().catch((error: unknown) => {
  console.error('Pre-flight failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
