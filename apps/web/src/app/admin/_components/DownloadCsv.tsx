/**
 * Small "Download CSV" link for a `PageHeader`'s `action` slot (plan §3
 * P1-10). Points straight at one of the `GET /api/admin/exports/*` routes —
 * those are cookie-authed GET reads (same `gt_staff` httpOnly cookie the rest
 * of the console uses), so a plain same-origin `<a>` with no client JS is
 * enough: the browser attaches the cookie, the server streams the CSV, and
 * `Content-Disposition: attachment` drives the download. No fetch/blob
 * plumbing needed, so this stays a server component like the rest of the
 * page shells that place it.
 *
 * Styled to match `Button`'s ghost/sm variant without importing a 'use
 * client' component into these otherwise-server page files.
 */
export function DownloadCsv({ href, label = 'Download CSV' }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      download
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        fontSize: 13,
        fontFamily: 'var(--font-heading)',
        fontWeight: 600,
        borderRadius: 10,
        lineHeight: 1.2,
        textDecoration: 'none',
        color: 'var(--gt-text)',
        border: '1px solid var(--gt-border)',
        background: 'transparent',
      }}
    >
      {label}
    </a>
  );
}
