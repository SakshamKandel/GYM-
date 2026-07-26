import type { ReactNode } from 'react';

/**
 * A message strip that belongs to the thing above or below it — the error a
 * save just came back with, the caveat over a form, the confirmation after a
 * queue action.
 *
 * Six pages hand-rolled this as a tinted div, each with its own padding and its
 * own idea of how loud it should be. This is the one implementation: a tinted
 * wash, a hairline in the same family, no shadow and no icon in a circle.
 *
 * A critical or warning strip announces itself politely (`role="status"`) so an
 * operator who is not looking at that corner of the screen still hears that the
 * save failed. Set `live={false}` for a strip that was on the page from the
 * start and has nothing new to say.
 */
export function InlineAlert({
  tone = 'critical',
  title,
  children,
  action,
  live = true,
}: {
  tone?: 'critical' | 'warning' | 'positive' | 'info';
  /** Optional bold lead line above the message. */
  title?: string;
  children?: ReactNode;
  /** At most one thing to do about it — usually "Try again". */
  action?: ReactNode;
  live?: boolean;
}) {
  return (
    <div
      className="gt-alert"
      data-tone={tone}
      role={live ? 'status' : undefined}
      aria-live={live ? 'polite' : undefined}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {title ? (
          <div style={{ fontWeight: 600, marginBottom: children ? 2 : 0 }}>{title}</div>
        ) : null}
        {children}
      </div>
      {action ? <div style={{ flexShrink: 0, marginLeft: 'var(--gt-space-2)' }}>{action}</div> : null}
    </div>
  );
}
