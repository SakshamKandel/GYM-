import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Guard-coverage check over the staff-facing API surface.
 *
 * Every route under /api/admin, /api/coach, /api/partner and /api/staff answers
 * for a console; each one must authorize through `@/lib/authz` rather than
 * hand-rolling its own check. A new route added without a guard is the single
 * highest-impact mistake possible here — it is silently world-readable — and it
 * is invisible in review because the file simply lacks a line.
 *
 * This test reads the route files as TEXT. It deliberately never imports them:
 * a route module pulls in `next/server` and opens a Neon connection at import
 * time, so importing one would turn a unit test into a live database call.
 * Static reading is also the point — we are asserting a property of the source,
 * not of a running handler.
 */

/** `apps/web/src/app/api/` — resolved from this file, not the process cwd. */
const API_ROOT = fileURLToPath(new URL('../app/api/', import.meta.url));

/** The console API trees. Everything else under /api is member-facing. */
const CONSOLE_GROUPS = ['admin', 'coach', 'partner', 'staff'] as const;

/**
 * The authorization entry points exported by `@/lib/authz`. A route satisfies
 * the check by importing at least one — which one is correct is the route's own
 * business (and is covered by the permission tests); this test only proves that
 * authorization was considered at all.
 */
const AUTHZ_GUARDS = [
  'requireStaff',
  'requirePermission',
  'requireAnyPermission',
  'requirePartner',
] as const;

/** Matches the module every guard must come from ('@/lib/authz'). */
const AUTHZ_MODULE_SUFFIX = '/authz';

/**
 * The ONLY console routes that legitimately hold no `@/lib/authz` guard. Each
 * entry is a deliberate, reviewed exception — verified by reading the file, not
 * assumed. Paths are relative to `API_ROOT` with forward slashes.
 *
 *  - `staff/login/route.ts`   — the credential entry point itself. It cannot
 *    require a session because it is what mints one; it verifies email/password
 *    against `accounts`, requires an `admins` row, and is IP rate limited.
 *  - `staff/logout/route.ts`  — session teardown. Deliberately unauthenticated
 *    and idempotent: it deletes whatever session the caller's own cookie names
 *    and clears the cookie, so an expired or already-dead token still logs out
 *    cleanly instead of stranding the browser in a signed-in-looking state.
 *  - `coach/messages/route.ts` — despite the `/coach` prefix this is the MEMBER
 *    side of coach chat and support, called by the mobile app. It authenticates
 *    the member with `bearerToken` + `userForToken` from `@/lib/auth` and scopes
 *    every query to that account id. A staff guard here would lock members out
 *    of their own inbox.
 *
 * Adding a path here must be a conscious decision with a reason written down.
 */
const UNGUARDED_ALLOWLIST: readonly string[] = [
  'coach/messages/route.ts',
  'staff/login/route.ts',
  'staff/logout/route.ts',
];

/**
 * Lower bound on the console route count. Guards against the silent failure
 * mode where a directory rename makes the walk find nothing and every
 * assertion below passes vacuously.
 */
const MIN_EXPECTED_ROUTES = 100;

/** Named-import bindings, including multi-line and `type`-prefixed forms. */
const NAMED_IMPORT_RE = /import\s+(?:type\s+)?\{([^{}]*)\}\s*from\s*'([^']+)'/g;

/** Every `route.ts` under the console groups, as sorted `group/../route.ts`. */
function consoleRouteFiles(): string[] {
  const found: string[] = [];

  function walk(absDir: string, relDir: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, entry.name);
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.name === 'route.ts') found.push(rel);
    }
  }

  for (const group of CONSOLE_GROUPS) walk(path.join(API_ROOT, group), group);
  return found.sort();
}

/**
 * The names a source file imports from a module whose specifier ends with
 * `moduleSuffix`. The bindings pattern excludes braces so a preceding
 * `import { x } from 'other'` can never be swallowed into the match.
 */
function namedImportsFrom(source: string, moduleSuffix: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(NAMED_IMPORT_RE)) {
    const bindings = match[1];
    const specifier = match[2];
    if (!specifier.endsWith(moduleSuffix)) continue;
    for (const raw of bindings.split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name !== '') names.add(name);
    }
  }
  return names;
}

function readRoute(relPath: string): string {
  return readFileSync(path.join(API_ROOT, relPath), 'utf8');
}

const routes = consoleRouteFiles();

const unguarded = routes.filter((relPath) => {
  const imported = namedImportsFrom(readRoute(relPath), AUTHZ_MODULE_SUFFIX);
  return !AUTHZ_GUARDS.some((guard) => imported.has(guard));
});

describe('console API route guard coverage', () => {
  it('actually finds the console route surface', () => {
    assert.ok(
      routes.length >= MIN_EXPECTED_ROUTES,
      `only ${routes.length} console routes found under ${API_ROOT} — the scan is ` +
        'looking in the wrong place, so every other assertion here is vacuous',
    );
  });

  it('imports an authz guard in every console route except the documented exceptions', () => {
    assert.deepEqual(
      unguarded,
      [...UNGUARDED_ALLOWLIST].sort(),
      'a console API route has no requireStaff/requirePermission/requireAnyPermission/' +
        'requirePartner import — it is reachable by anyone. Add the right guard, or, ' +
        'if it is genuinely an authentication entry point, add it to ' +
        'UNGUARDED_ALLOWLIST above WITH the reason.',
    );
  });

  it('keeps every allowlist entry pointing at a route that still exists', () => {
    for (const relPath of UNGUARDED_ALLOWLIST) {
      assert.ok(
        routes.includes(relPath),
        `${relPath} is allowlisted as unguarded but no longer exists — delete the ` +
          'stale entry so the allowlist cannot quietly cover a future file at that path',
      );
    }
  });

  it('still authenticates the member on the one non-staff route in the tree', () => {
    // coach/messages is exempt from the STAFF guards, not from authentication.
    const authImports = namedImportsFrom(readRoute('coach/messages/route.ts'), '/auth');
    assert.ok(
      authImports.has('userForToken') && authImports.has('bearerToken'),
      'coach/messages/route.ts no longer resolves the caller through bearerToken + ' +
        'userForToken — it is allowlisted out of the staff guards, so this member ' +
        'authentication is the only thing protecting the thread',
    );
  });
});
