'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/console';

const MAX_LEN = 2000;

interface Template {
  id: string;
  title: string;
  body: string;
}

/**
 * Coach reply composer. POSTs to /api/coach/threads/[userId]/reply (owned by the
 * API agent — do NOT change that route) with { body }, which inserts a
 * coach_messages row (sender='coach', senderAccountId = the signed-in coach).
 * On success we clear the box and router.refresh() so the server component
 * re-renders the thread with the new message — no optimistic client state, so
 * the server stays the single source of truth.
 *
 * WP-10 (Pack K): saved quick-reply TEMPLATES. The composer loads the coach's
 * templates (/api/coach/message-templates, self-scoped), inserts one into the
 * draft with a click, and can save the current draft as a new template — so a
 * coach answering the same questions all day stops retyping them.
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
  const [templates, setTemplates] = useState<Template[]>([]);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const trimmed = body.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= MAX_LEN && !busy;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch('/api/coach/message-templates', {
          headers: { Accept: 'application/json' },
        });
        if (!live || !res.ok) return;
        const data = (await res.json()) as { templates: Template[] };
        setTemplates(data.templates);
      } catch {
        // Templates are a convenience — a load failure just hides the row.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  function insertTemplate(t: Template) {
    setBody((prev) => {
      const joiner = prev.trim().length > 0 ? `${prev.replace(/\s+$/, '')}\n` : '';
      return `${joiner}${t.body}`.slice(0, MAX_LEN);
    });
    taRef.current?.focus();
  }

  async function saveTemplate() {
    if (trimmed.length === 0 || savingTemplate) return;
    setSavingTemplate(true);
    try {
      const res = await fetch('/api/coach/message-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      });
      if (res.ok) {
        const data = (await res.json()) as { template: Template };
        setTemplates((prev) => [data.template, ...prev]);
      } else if (res.status === 409) {
        setError('Template limit reached — delete one first.');
      }
    } catch {
      setError('Could not save template. Try again.');
    }
    setSavingTemplate(false);
  }

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
      {templates.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} aria-label="Quick replies">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => insertTemplate(t)}
              title={t.body}
              style={{
                appearance: 'none',
                cursor: 'pointer',
                border: '1px solid var(--gt-border)',
                borderRadius: 999,
                background: 'var(--gt-bg)',
                color: 'var(--gt-text)',
                fontSize: 12,
                padding: '6px 10px',
                minHeight: 32,
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {t.title.trim() || t.body.slice(0, 32)}
            </button>
          ))}
        </div>
      ) : null}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            className="gt-numeric"
            style={{
              fontSize: 12,
              color: trimmed.length > MAX_LEN ? '#ff8178' : 'var(--gt-text-dim)',
            }}
          >
            {trimmed.length}/{MAX_LEN}
          </span>
          <button
            type="button"
            onClick={() => void saveTemplate()}
            disabled={trimmed.length === 0 || savingTemplate}
            style={{
              appearance: 'none',
              background: 'transparent',
              border: 'none',
              cursor: trimmed.length === 0 ? 'default' : 'pointer',
              fontSize: 12,
              color: trimmed.length === 0 ? 'var(--gt-text-dim)' : 'var(--gt-text)',
              textDecoration: 'underline',
              padding: 4,
            }}
          >
            {savingTemplate ? 'Saving…' : 'Save as template'}
          </button>
        </div>
        <Button type="submit" variant="primary" size="sm" disabled={!canSend}>
          {busy ? 'Sending…' : 'Send reply'}
        </Button>
      </div>
    </form>
  );
}
