import { randomBytes, scrypt } from 'node:crypto';
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { createDb } from './index';
import { accounts, admins } from './schema';

/**
 * Bootstrap the FIRST super_admin so the web consoles can be opened at all.
 *
 * Everything else in the admin console is created through the console itself,
 * which needs someone signed in — so a brand-new database has a chicken-and-egg
 * problem this script exists to break. Run it once per environment, then grant
 * every further staff role from /admin/staff.
 *
 * Idempotent: keyed by email. Re-running against an account that is already
 * staff changes nothing and never rewrites an existing password, so it is safe
 * to re-run if you are unsure whether it worked.
 *
 * Run from packages/db (DATABASE_URL comes from the repo-root .env, same as
 * drizzle.config.ts):
 *   SEED_STAFF_EMAIL=you@example.com SEED_STAFF_PASSWORD='a long passphrase' \
 *     pnpm --filter @gym/db seed:staff
 */

config({ path: '../../.env' });

const EMAIL_ENV = 'SEED_STAFF_EMAIL';
const PASSWORD_ENV = 'SEED_STAFF_PASSWORD';
const PROMOTE_ENV = 'SEED_STAFF_PROMOTE_EXISTING';

/** Shortest password accepted. This account can do everything; 8 is not enough. */
const MIN_PASSWORD_LENGTH = 12;

/**
 * Password hashing, deliberately duplicated from apps/web/src/lib/password.ts.
 *
 * The format below is exactly what the console login parses, so these three
 * constants and the `scrypt$<saltHex>$<hashHex>` layout MUST stay in step with
 * that file — a change there without a change here mints accounts that cannot
 * sign in.
 *
 * It is duplicated rather than shared because neither home works: packages/db
 * must not depend on apps/web (the dependency runs the other way), and hoisting
 * it into @gym/shared would pull node:crypto into the React Native bundle,
 * which has no such module.
 */
const SCRYPT_N = 16384;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** Returns 'scrypt$<saltHex>$<hashHex>' — the format the web login verifies. */
function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(SALT_LENGTH);
    scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_N }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`scrypt$${salt.toString('hex')}$${derivedKey.toString('hex')}`);
    });
  });
}

/** Trimmed env value, or '' when unset. */
function envValue(name: string): string {
  return (process.env[name] ?? '').trim();
}

/**
 * The reason this run must not proceed, or null when the inputs are usable.
 * Both credentials are required and there is no default: this script writes a
 * full-access account into whatever database DATABASE_URL points at, so it only
 * ever acts on values someone typed on purpose.
 */
function inputBlockedReason(email: string, password: string): string | null {
  const usage = [
    'Usage:',
    `  ${EMAIL_ENV}=you@example.com ${PASSWORD_ENV}='a long passphrase' \\`,
    '    pnpm --filter @gym/db seed:staff',
  ];

  if (email === '' || password === '') {
    const missing = [email === '' ? EMAIL_ENV : null, password === '' ? PASSWORD_ENV : null]
      .filter((name): name is string => name !== null)
      .join(' and ');
    return [
      `Refusing to run: ${missing} not set.`,
      'This creates a super admin — the account that can do everything in the',
      'console — so it needs an email and password you chose deliberately.',
      '',
      ...usage,
    ].join('\n');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return [
      `Refusing to run: ${EMAIL_ENV} ("${email}") does not look like an email address.`,
      'Sign-in is by email, so a typo here creates an account nobody can use.',
      '',
      ...usage,
    ].join('\n');
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return [
      `Refusing to run: ${PASSWORD_ENV} is shorter than ${MIN_PASSWORD_LENGTH} characters.`,
      'This one password unlocks every member record, payment and payout in the',
      'app. Use a long passphrase from your password manager.',
      '',
      ...usage,
    ].join('\n');
  }

  return null;
}

async function main(): Promise<void> {
  // Emails are stored lowercase (the login lowercases what is typed). The
  // password is taken EXACTLY as given — trimming it would hash something the
  // operator never chose, and "the password does not work" is a miserable bug.
  const email = envValue(EMAIL_ENV).toLowerCase();
  const password = process.env[PASSWORD_ENV] ?? '';

  const blocked = inputBlockedReason(email, password);
  if (blocked !== null) {
    console.error(blocked);
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL missing — put it in the repo-root .env');
  }
  const db = createDb(databaseUrl);

  // 1. The account. Never rewrite an existing one: this script is a bootstrap,
  //    not a password reset, and quietly replacing a live password would make
  //    it a back door. A password is only filled in when the row has none.
  const existing = await db
    .select({ id: accounts.id, passwordHash: accounts.passwordHash })
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);
  const found = existing[0];

  let accountId: string;
  if (found === undefined) {
    const inserted = await db
      .insert(accounts)
      .values({
        email,
        displayName: 'Admin',
        passwordHash: await hashPassword(password),
        status: 'active',
      })
      .returning({ id: accounts.id });
    const row = inserted[0];
    if (row === undefined) throw new Error(`failed to create the account for ${email}`);
    accountId = row.id;
    console.log(`created account ${email} (${accountId})`);
  } else {
    accountId = found.id;

    // An account already using this email may be a real member. Turning one
    // into a super admin because of a typo is not recoverable by re-running,
    // so it has to be asked for explicitly — unless they are already staff, in
    // which case this run is just a harmless repeat.
    const staffRows = await db
      .select({ role: admins.role })
      .from(admins)
      .where(eq(admins.accountId, accountId))
      .limit(1);
    const currentRole = staffRows[0]?.role ?? null;

    if (currentRole === null && envValue(PROMOTE_ENV) !== 'yes') {
      console.error(
        [
          `Refusing to run: ${email} already exists and is not a staff account.`,
          'It may belong to a real member. Making it a super admin would give',
          'whoever owns that account full access to all member data.',
          '',
          'If this is genuinely your own account, say so on purpose:',
          `  ${PROMOTE_ENV}=yes ${EMAIL_ENV}=${email} ${PASSWORD_ENV}='a long passphrase' \\`,
          '    pnpm --filter @gym/db seed:staff',
        ].join('\n'),
      );
      process.exit(1);
    }

    console.log(`account ${email} already exists (${accountId})`);
    if (found.passwordHash === null) {
      // Created without a sign-in credential (an earlier seed, or a Google-only
      // sign-up). Fill the gap so the console password login works.
      await db
        .update(accounts)
        .set({ passwordHash: await hashPassword(password) })
        .where(eq(accounts.id, accountId));
      console.log('set its password (it had none)');
    } else {
      console.log(`kept its existing password — ${PASSWORD_ENV} was ignored`);
    }
  }

  // 2. The staff role. onConflictDoNothing so a re-run is a no-op and an
  //    existing staff row is never silently re-ranked.
  await db
    .insert(admins)
    .values({ accountId, role: 'super_admin' })
    .onConflictDoNothing({ target: admins.accountId });

  const finalRows = await db
    .select({ role: admins.role })
    .from(admins)
    .where(eq(admins.accountId, accountId))
    .limit(1);
  const finalRole = finalRows[0]?.role ?? null;

  if (finalRole === null) throw new Error(`failed to give ${email} a staff role`);
  if (finalRole !== 'super_admin') {
    console.log('');
    console.log(`Note: ${email} was already staff as "${finalRole}" — left unchanged.`);
    console.log('Change the role from /admin/staff, or use a different email here.');
    return;
  }

  console.log('');
  console.log(`Done. ${email} is a super admin.`);
  console.log('Sign in at /admin/login, then add everyone else from /admin/staff.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
