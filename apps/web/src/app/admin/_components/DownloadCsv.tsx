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
 * It wears the shared button classes rather than a copy of them. Hand-copied,
 * it was 30px tall against the console's 44px minimum, had no hover and no
 * pressed state, and had a hard-coded 10px corner that would survive any change
 * to the radius token. `.gt-btn` carries all of that, and borrowing the class
 * costs nothing here: the styling is in globals.css, so this stays a server
 * component like the page shells that place it.
 */
export function DownloadCsv({ href, label = 'Download CSV' }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      download
      className="gt-btn"
      data-variant="ghost"
      data-size="sm"
      style={{ textDecoration: 'none' }}
    >
      {label}
    </a>
  );
}
