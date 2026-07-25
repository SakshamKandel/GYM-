import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Guard-coverage check over the console PAGES, the sibling of
 * `apiRouteGuards.test.ts` for server-rendered surfaces.
 *
 * A console page is a server component that queries the database directly for
 * its first paint, so an unguarded page leaks its data to anyone who types the
 * URL — the layout guard above it is a coarse "may enter this console at all"
 * check, not the per-page permission. Every page therefore re-resolves the
 * caller itself. Each console has its own established helper for that:
 *
 *   /admin   → `staffFromCookie` + `effectivePermissionSet`
 *   /coach   → `requireCoachPage`
 *   /partner → `requirePartnerPage`
 *
 * Read as TEXT for the same reason as the route test: these are `.tsx` server
 * components whose imports open a Neon connection, and Node's test runner
 * cannot load JSX.
 */

/** `apps/web/src/app/` — resolved from this file, not the process cwd. */
const APP_ROOT = fileURLToPath(new URL('../app/', import.meta.url));

/** One required helper: the binding name, and the module it must come from. */
interface RequiredGuardImport {
  name: string;
  /** Suffix the import specifier must end with, so a local shadow can't pass. */
  fromSuffix: string;
}

interface ConsoleSpec {
  /** Directory under `app/`, also the label used in failure messages. */
  dir: string;
  /** ALL of these must be imported by every page in the tree. */
  required: readonly RequiredGuardImport[];
  /**
   * The console's sign-in page — the one page that must NOT be guarded, since
   * guarding the door you sign in through is an infinite redirect. Nothing else
   * is ever exempt.
   */
  loginPage: string;
}

const CONSOLES: readonly ConsoleSpec[] = [
  {
    dir: 'admin',
    required: [
      { name: 'staffFromCookie', fromSuffix: '/staffSession' },
      { name: 'effectivePermissionSet', fromSuffix: '/authz' },
    ],
    loginPage: 'admin/login/page.tsx',
  },
  {
    dir: 'coach',
    required: [{ name: 'requireCoachPage', fromSuffix: '/coachPage' }],
    loginPage: 'coach/login/page.tsx',
  },
  {
    dir: 'partner',
    // `requirePartnerPage` lives in the portal's own colocated `_data` module,
    // imported as './_data' from the root page and '../_data' from the rest.
    required: [{ name: 'requirePartnerPage', fromSuffix: '_data' }],
    loginPage: 'partner/login/page.tsx',
  },
];

/**
 * Lower bound on the page count. Guards against a directory rename making the
 * walk find nothing, which would let every assertion pass vacuously.
 */
const MIN_EXPECTED_PAGES = 40;

/** Named-import bindings, including multi-line and `type`-prefixed forms. */
const NAMED_IMPORT_RE = /import\s+(?:type\s+)?\{([^{}]*)\}\s*from\s*'([^']+)'/g;

/** Every `page.tsx` under `app/<dir>`, as sorted `dir/../page.tsx` paths. */
function pageFiles(dir: string): string[] {
  const found: string[] = [];

  function walk(absDir: string, relDir: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, entry.name);
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.name === 'page.tsx') found.push(rel);
    }
  }

  walk(path.join(APP_ROOT, dir), dir);
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

/** Helper names in `required` that `relPath` does NOT import from its module. */
function missingGuards(relPath: string, required: readonly RequiredGuardImport[]): string[] {
  const source = readFileSync(path.join(APP_ROOT, relPath), 'utf8');
  return required
    .filter((guard) => !namedImportsFrom(source, guard.fromSuffix).has(guard.name))
    .map((guard) => `${guard.name} (from '...${guard.fromSuffix}')`);
}

/**
 * A retired route kept so old bookmarks still land somewhere: its whole body is
 * `redirect(...)`. It reads nothing, so there is no data to guard, and the page
 * it forwards to is checked like every other one.
 *
 * Deliberately STRUCTURAL rather than a filename allowlist: the exemption only
 * holds while the file both redirects AND never awaits. The moment someone adds
 * a query to it, `await` appears, the exemption lapses, and the guard assertion
 * catches it. A filename allowlist would keep covering that file forever.
 */
function isRedirectStub(relPath: string): boolean {
  const source = readFileSync(path.join(APP_ROOT, relPath), 'utf8');
  return /\bredirect\s*\(/.test(source) && !/\bawait\b/.test(source);
}

const allPages = CONSOLES.flatMap((consoleSpec) => pageFiles(consoleSpec.dir));

describe('console page guard coverage', () => {
  it('actually finds the console pages', () => {
    assert.ok(
      allPages.length >= MIN_EXPECTED_PAGES,
      `only ${allPages.length} console pages found under ${APP_ROOT} — the scan is ` +
        'looking in the wrong place, so every other assertion here is vacuous',
    );
  });

  for (const spec of CONSOLES) {
    it(`guards every /${spec.dir} page except its login page`, () => {
      const pages = pageFiles(spec.dir);
      const unguarded: string[] = [];

      for (const relPath of pages) {
        if (relPath === spec.loginPage) continue;
        if (isRedirectStub(relPath)) continue;
        const missing = missingGuards(relPath, spec.required);
        if (missing.length > 0) unguarded.push(`${relPath} is missing ${missing.join(' + ')}`);
      }

      assert.deepEqual(
        unguarded,
        [],
        `these /${spec.dir} pages render server-side data without re-resolving the ` +
          'caller, so anyone who knows the URL can read it:\n' +
          unguarded.join('\n'),
      );
    });

    it(`exempts only the /${spec.dir} login page`, () => {
      const pages = pageFiles(spec.dir);
      assert.ok(
        pages.includes(spec.loginPage),
        `${spec.loginPage} no longer exists — the exemption is stale and would ` +
          'silently cover a future page at that path',
      );
      // The login page is exempt because it is the door, not a room behind it.
      assert.ok(
        missingGuards(spec.loginPage, spec.required).length > 0,
        `${spec.loginPage} now imports the page guard — if sign-in really does need ` +
          'it, drop the exemption so the page is checked like every other one',
      );
    });
  }
});
