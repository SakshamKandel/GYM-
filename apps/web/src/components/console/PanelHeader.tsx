'use client';

/**
 * The header row shared by <Modal> and <Drawer>. One implementation so the two
 * overlays cannot drift: same title weight, same 56px row, same close control.
 *
 * The close button is bare — a bordered box in the corner of a panel that
 * already has a border and a shadow is one box too many — but it keeps a 44px
 * hit area and picks up the shared hover, pressed and focus states from
 * .gt-icon-btn.
 */
export function PanelHeader({
  title,
  onClose,
}: {
  title?: string;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        height: 56,
        padding: '0 12px 0 var(--gt-space-5)',
        borderBottom: '1px solid var(--gt-border)',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          fontSize: 16,
          letterSpacing: '-0.01em',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        title="Close"
        className="gt-icon-btn"
        data-bare="true"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden focusable="false">
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
