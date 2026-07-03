'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';
import { Button } from '@/components/console';

const MAX_LEN = 2000;

/**
 * Coach reply composer. POSTs to /api/coach/threads/[userId]/reply (owned by the
 * API agent — do NOT change that route) with { body }, which inserts a
 * coach_messages row (sender='coach', senderAccountId = the signed-in coach).
 * On success we clear the box and router.refresh() so the server component
 * re-renders the thread with the new message — no optimistic client state, so
 * the server stays the single source of truth.
 *
 * The httpOnly 'gt_staff' cookie rides along automatically with the same-origin
 * fetch, so the route resolves the coach via the staff session.
 */
export function ReplyBox({ userId }: { userId: string }) {
  const router = useRouter();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = body.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= MAX_LEN && !busy;

  async function submit() {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/coach/threads/${encodeURIComponent(userId)}/reply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: trimmed }),
        },
      );
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'You are not assigned to this client.'
            : res.status === 401
              ? 'Your session expired. Sign in again.'
              : 'Could not send the reply. Try again.',
        );
        setBusy(false);
        return;
      }
      setBody('');
      setBusy(false);
      taRef.current?.focus();
      router.refresh();
    } catch {
      setError('Network error. Check your connection and retry.');
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="gt-card"
      style={{
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        position: 'sticky',
        bottom: 16,
      }}
    >
      <textarea
        ref={taRef}
        id="reply-body"
        className="gt-input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={MAX_LEN}
        placeholder="Reply as coach…  (⌘/Ctrl + Enter to send)"
        aria-label="Reply as coach"
        style={{
          resize: 'vertical',
          minHeight: 64,
          fontFamily: 'var(--font-heading)',
          lineHeight: 1.5,
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
      />
      {error ? (
        <div style={{ color: '#ff8178', fontSize: 13 }} role="alert">
          {error}
        </div>
      ) : null}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span
          className="gt-numeric"
          style={{
            fontSize: 12,
            color:
              trimmed.length > MAX_LEN ? '#ff8178' : 'var(--gt-text-dim)',
          }}
        >
          {trimmed.length}/{MAX_LEN}
        </span>
        <Button type="submit" variant="primary" size="sm" disabled={!canSend}>
          {busy ? 'Sending…' : 'Send reply'}
        </Button>
      </div>
    </form>
  );
}
