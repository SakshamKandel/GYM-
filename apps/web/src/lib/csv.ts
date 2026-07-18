import { CORS_HEADERS } from './http';

/**
 * Shared CSV-export plumbing for the admin console (WP-exports-support,
 * plan §3 P1-10). Every `api/admin/exports/*` route streams its table through
 * `csvStreamResponse` rather than building one giant string in memory: the
 * caller supplies a `fetchPage(cursor)` function that runs ONE bounded DB
 * query per call (reusing each route's existing keyset-pagination shape), and
 * this helper turns that into a chunked `ReadableStream` response — so a
 * multi-thousand-row export never holds the whole CSV (or the whole result
 * set) in memory at once, and the browser starts downloading immediately.
 */

/**
 * Escapes one CSV field per RFC 4180: wrap in double quotes (doubling any
 * embedded quote) whenever the value contains a comma, quote, or newline.
 * `null`/`undefined` become an empty field, not the literal string "null".
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** One CSV row (CRLF line ending — the RFC 4180 / Excel-safe default). */
export function csvLine(fields: readonly unknown[]): string {
  return `${fields.map(csvEscape).join(',')}\r\n`;
}

function csvHeaders(filename: string): Record<string, string> {
  return {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    ...CORS_HEADERS,
  };
}

/**
 * Builds a chunked CSV `Response`. `fetchPage(cursor)` is called repeatedly —
 * starting with `cursor: null` — until it returns `nextCursor: null`; each
 * call's `rows` are written to the stream immediately, so memory use stays
 * bounded by one page regardless of table size. `header` is written once
 * up front. Any error thrown mid-stream aborts the response via
 * `controller.error` (the client sees a truncated/failed download rather than
 * a silently-incomplete file).
 */
export function csvStreamResponse<Cursor>(
  filename: string,
  header: readonly string[],
  fetchPage: (
    cursor: Cursor | null,
  ) => Promise<{ rows: readonly unknown[][]; nextCursor: Cursor | null }>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(csvLine(header)));
        let cursor: Cursor | null = null;
        let iterations = 0;
        // Hard safety ceiling: a pagination bug that never returns
        // nextCursor:null must not spin forever and hold the connection open.
        const MAX_ITERATIONS = 20_000;
        do {
          const { rows, nextCursor } = await fetchPage(cursor);
          for (const row of rows) {
            controller.enqueue(encoder.encode(csvLine(row)));
          }
          cursor = nextCursor;
          iterations += 1;
        } while (cursor !== null && iterations < MAX_ITERATIONS);
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  return new Response(stream, { status: 200, headers: csvHeaders(filename) });
}

/** `<name>-YYYY-MM-DD.csv`, per the brief's "filename with date" requirement. */
export function dateStampedFilename(name: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${name}-${stamp}.csv`;
}
