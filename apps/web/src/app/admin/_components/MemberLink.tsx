import Link from 'next/link';

/**
 * A member's name, everywhere it appears in a staff queue, as a link to that
 * member's record (`/admin/members/[id]/view`).
 *
 * Before this, the name was dead text on every queue except the members list:
 * an operator handling a payment, an order or a dispute had to copy the email
 * address, open a second tab, and search the directory just to find out who
 * they were about to act on.
 *
 * `canView` mirrors the `members.read` permission the target page enforces —
 * when the viewer doesn't hold it the name renders as plain text rather than a
 * link that would bounce them back to the dashboard. Falls back to the email
 * when a display name is empty, so the cell is never blank.
 *
 * Server-component friendly (plain <Link>). Inside a clickable DataTable row
 * the link swallows the row click, so it navigates instead of also opening the
 * row's drawer.
 */
export function MemberLink({
  id,
  name,
  email,
  canView = true,
  strong = true,
}: {
  id: string | null | undefined;
  name?: string | null;
  email?: string | null;
  /** Viewer holds `members.read`. When false, renders plain text. */
  canView?: boolean;
  /** Heading weight (queue tables); false for inline body copy. */
  strong?: boolean;
}) {
  const label = (name ?? '').trim() || (email ?? '').trim() || 'Unknown member';
  const base: React.CSSProperties = {
    fontFamily: strong ? 'var(--font-heading)' : undefined,
    fontWeight: strong ? 600 : undefined,
    fontSize: strong ? 14 : undefined,
    color: 'var(--gt-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'block',
  };

  if (!canView || !id) return <span style={base}>{label}</span>;

  return (
    <Link
      href={`/admin/members/${encodeURIComponent(id)}/view`}
      title={`Open ${label}'s member record`}
      style={{
        ...base,
        textDecoration: 'underline',
        textDecorationColor: 'var(--gt-border-strong)',
        textUnderlineOffset: 3,
      }}
    >
      {label}
    </Link>
  );
}
