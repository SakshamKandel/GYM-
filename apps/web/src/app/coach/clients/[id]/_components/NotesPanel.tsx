'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/console';

/**
 * The coach's PRIVATE CRM note about a client (Pack K / WP-10). Loads the
 * existing note, edits it, and PUTs an upsert to the notes route. Never shown to
 * the member; server-scoped to `coachId = me` and maskPii'd on write.
 */
export function NotesPanel({ userId }: { userId: string }) {
  const path = `/api/coach/clients/${encodeURIComponent(userId)}/notes`;
  const [note, setNote] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(path, { headers: { Accept: 'application/json' } });
        if (!live) return;
        if (res.ok) {
          const data = (await res.json()) as { note: string; updatedAt: string | null };
          setNote(data.note);
          setSavedNote(data.note);
          setUpdatedAt(data.updatedAt);
        }
        setLoading(false);
      } catch {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [path]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) {
        setMsg({ kind: 'err', text: 'Could not save the note. Try again.' });
        setBusy(false);
        return;
      }
      const data = (await res.json()) as { note: string; updatedAt: string | null };
      setNote(data.note);
      setSavedNote(data.note);
      setUpdatedAt(data.updatedAt);
      setMsg({ kind: 'ok', text: 'Saved.' });
      setBusy(false);
    } catch {
      setMsg({ kind: 'err', text: 'Network error. Retry.' });
      setBusy(false);
    }
  }

  const dirty = note !== savedNote;

  return (
    <div className="gt-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <strong style={{ fontFamily: 'var(--font-heading)', fontSize: 15 }}>Private note</strong>
        <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          Only you can see this
        </span>
      </div>
      <textarea
        className="gt-input"
        style={{ width: '100%', minHeight: 160, resize: 'vertical', lineHeight: 1.5 }}
        placeholder={loading ? 'Loading…' : 'Goals, injuries, preferences, context for this client…'}
        aria-label="Private client note"
        value={note}
        maxLength={4000}
        disabled={loading}
        onChange={(e) => setNote(e.target.value)}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: msg?.kind === 'err' ? 'var(--gt-red)' : 'var(--gt-text-dim)' }}>
          {msg?.text ?? (updatedAt ? `Last saved ${new Date(updatedAt).toLocaleString()}` : '')}
        </span>
        <Button type="button" variant="primary" size="sm" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save note'}
        </Button>
      </div>
    </div>
  );
}
