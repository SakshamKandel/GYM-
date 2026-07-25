import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The admin console's front door.
 *
 * `apps/web/src/app/admin/layout.tsx` guards the WHOLE /admin subtree: a
 * principal may enter only when their effective permission set contains at
 * least one permission named in the console nav (`ALL_NAV_PERMS`). Two silent
 * failure modes follow from that, and this file pins both:
 *
 *  (a) A nav item carrying a permission string that is not a real `Permission`
 *      (a typo, or a key renamed in @gym/shared) is dead weight — nobody can
 *      ever hold it, so the item never appears and, worse, the whole gate
 *      quietly shrinks. TypeScript catches a literal typo today, but only while
 *      the annotation survives; this check is independent of it.
 *  (b) If a `partner` ever came to hold ANY nav permission, that role would be
 *      one preset edit away from the admin console. The role bounce in the
 *      layout is a UX courtesy, not the boundary — the permission gate is. So
 *      we prove the partner preset and the nav permissions are disjoint SETS,
 *      which is the property that actually keeps a restaurant operator out.
 *
 * The layout is read as TEXT rather than imported, and `ALL_NAV_PERMS` stays
 * module-private, for two independent reasons:
 *   - Node's test runner cannot load `.tsx` at all (it strips types, it does not
 *     transform JSX), and the layout's imports (`next/headers`, `@/lib/authz`)
 *     would open a Neon connection at import time anyway.
 *   - Next generates a type guard per layout that rejects ANY export outside its
 *     known set (`default`, `metadata`, `dynamic`, `runtime`, …), so exporting
 *     the constant to make it importable would fail `next build` type checking.
 */

// @gym/shared's barrel uses extensionless relative exports (the repo-wide
// source idiom) which Node's native TS runner rejects on static resolution.
// Bridge them for this test process, then load shared dynamically AFTER the
// hook is live — same pattern as the sibling meal-subscription tests.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (typeof specifier === 'string' && specifier.startsWith('.') && !specifier.endsWith('.ts')) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw err;
    }
  },
});

const { ALL_PERMISSIONS, effectivePermissionsForRole, permissionsForRole } =
  await import('@gym/shared');

const LAYOUT_PATH = fileURLToPath(new URL('../app/admin/layout.tsx', import.meta.url));
const layoutSource = readFileSync(LAYOUT_PATH, 'utf8');

/**
 * Lower bound on the nav permissions found by the scan. Without it a regex that
 * stops matching would leave an empty list, and every assertion below would
 * pass while checking nothing.
 */
const MIN_EXPECTED_NAV_PERMS = 15;

/**
 * The permission strings the nav gates on, scraped from the `NAV_GROUPS`
 * literal: `perm: '<key>'` for single-permission items and `anyPerm: [...]` for
 * the OR-gated ones. The type declarations use `perm?:` / `anyPerm?:` and so
 * cannot match. Structural drift in how the list is BUILT is caught separately
 * by the derivation assertions below, so this scrape cannot silently go stale.
 */
function navPermissionStrings(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/(?:^|[\s{,])perm:\s*'([^']+)'/gm)) {
    found.push(match[1]);
  }
  for (const match of source.matchAll(/anyPerm:\s*\[([^\]]*)\]/g)) {
    for (const inner of match[1].matchAll(/'([^']+)'/g)) found.push(inner[1]);
  }
  return found;
}

const navPermissions = navPermissionStrings(layoutSource);
const navPermissionSet = new Set(navPermissions);

describe('admin console access gate', () => {
  it('actually finds the nav permissions in the layout', () => {
    assert.ok(
      navPermissions.length >= MIN_EXPECTED_NAV_PERMS,
      `only ${navPermissions.length} nav permissions scraped from ${LAYOUT_PATH} — ` +
        'the scan is out of date, so every other assertion here is vacuous',
    );
  });

  it('still derives the console gate from every nav permission', () => {
    // Pins the two lines the scrape depends on: the gate must keep reading from
    // NAV_GROUPS, and entry must keep being "holds ANY nav permission". If the
    // layout starts gating on something else, this test has to be revisited
    // rather than silently continuing to check the wrong thing.
    assert.match(
      layoutSource,
      /const ALL_NAV_PERMS: Permission\[\] = NAV_GROUPS\.flatMap\(/,
      'ALL_NAV_PERMS is no longer derived from NAV_GROUPS — re-check what this test scrapes',
    );
    assert.match(
      layoutSource,
      /ALL_NAV_PERMS\.some\(\(perm\) => permissions\.has\(perm\)\)/,
      'the admin subtree no longer gates on holding any nav permission',
    );
  });

  it('names only real permissions in the nav', () => {
    const known = new Set<string>(ALL_PERMISSIONS);
    for (const perm of navPermissionSet) {
      assert.ok(
        known.has(perm),
        `admin nav gates on '${perm}', which is not in ALL_PERMISSIONS — nobody can ` +
          'ever hold it, so that item is permanently hidden and the console gate is ' +
          'narrower than it looks',
      );
    }
  });

  it('shares no permission between the partner role and the admin nav', () => {
    // The preset as shipped, and the preset after a hypothetical override-free
    // merge — both must stay disjoint from the console gate.
    const partnerSets = [
      permissionsForRole('partner'),
      effectivePermissionsForRole('partner', new Map()),
    ];
    for (const partnerPermissions of partnerSets) {
      const overlap = partnerPermissions.filter((perm) => navPermissionSet.has(perm));
      assert.deepEqual(
        overlap,
        [],
        `the partner role now holds ${overlap.join(', ')}, which the admin nav gates ` +
          'on — a partner would pass the /admin layout gate. Partners are ' +
          'delivery-only and must never reach the admin console.',
      );
    }
  });

  it('still bounces a partner principal to its own console', () => {
    // Belt to the permission braces above: even with the sets disjoint, the
    // layout should redirect rather than leave a partner at a login loop.
    assert.match(
      layoutSource,
      /principal\.role === 'partner'/,
      'the admin layout no longer special-cases the partner role',
    );
  });
});
