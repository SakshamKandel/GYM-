import { sql, type SQL } from 'drizzle-orm';

/**
 * Bind a JS array as ONE Postgres array parameter.
 *
 * drizzle's `sql` template expands an array value into a ROW constructor —
 * `x = ${[1,2,3]}` renders `x = ($1, $2, $3)` — which Postgres cannot assign to
 * an array column (`column … is of type integer[] but expression is of type
 * record`) nor feed to `= any(...)`. A one-element array happens to render as a
 * bare scalar in parentheses, so this failure mode hides until someone picks a
 * second value.
 *
 * Rendering the value as an array LITERAL and casting it keeps the whole array
 * a single, correctly typed parameter.
 */

/** `{1,3,5}::integer[]` — callers must pass validated integers. */
export function pgIntArray(values: readonly number[]): SQL {
  const literal = `{${values
    .map((value) => {
      if (!Number.isInteger(value)) {
        throw new TypeError(`pgIntArray expects integers, received ${String(value)}`);
      }
      return String(value);
    })
    .join(',')}}`;
  return sql`${literal}::integer[]`;
}

/** `{"a","b"}::text[]` — quoted + escaped, so any string is safe to carry. */
export function pgTextArray(values: readonly string[]): SQL {
  const literal = `{${values
    .map((value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')}}`;
  return sql`${literal}::text[]`;
}
