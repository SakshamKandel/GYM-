'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, EmptyState } from '@/components/console';
import type { PartnerSupportMessage } from '../_data';
import { formatKtmDateTime } from '../_format';
import styles from './support.module.css';

/**
 * The partner ↔ platform-team conversation.
 *
 * Deliberately plain: a list of what was said and a box to say the next thing.
 * Replies land in the same thread, and opening this page marks them read, which
 * is what clears the "the team wrote back" chip in the portal's alert dock.
 *
 * The thread refreshes on an interval while the page is open. A restaurant
 * cannot be pushed to (there is no app on a kitchen counter), so a reply that
 * only appeared on reload would sit unseen for hours.
 */

const REFRESH_MS = 30_000;

export function PartnerSupportThread({
  initialMessages,
  about,
}: {
  initialMessages: PartnerSupportMessage[];
  /** Order code carried in from the feedback page, pre-filling the box. */
  about: string;
}) {
  const [messages, setMessages] = useState<PartnerSupportMessage[]>(initialMessages);
  const [draft, setDraft] = useState(about ? `About order ${about}: ` : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Opening the page is reading it, so clear the unread flag on the replies.
  useEffect(() => {
    if (!initialMessages.some((m) => m.unread)) return;
    void fetch('/api/partner/support/read', { method: 'POST', credentials: 'include' }).catch(
      () => {
        /* the badge simply stays until the next visit */
      },
    );
  }, [initialMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/partner/support', { credentials: 'include' });
        if (!res.ok) return;
        const body = (await res.json()) as { messages: PartnerSupportMessage[] };
        setMessages(body.messages);
      } catch {
        /* transient — the next tick tries again */
      }
    };
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/partner/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        setError(
          res.status === 429
            ? 'That is a lot of messages at once. Give it a minute and try again.'
            : 'That did not send. Try again.',
        );
        return;
      }
      const payload = (await res.json()) as { message: PartnerSupportMessage };
      setMessages((list) => [...list, payload.message]);
      setDraft('');
    } catch {
      setError('No connection. Try again once you are back online.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      {messages.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="Write below and the platform team picks it up. Replies land on this page."
        />
      ) : (
        <div className={styles.thread}>
          {messages.map((m) => (
            <div
              key={m.id}
              className={`${styles.bubbleRow} ${m.from === 'you' ? styles.bubbleRowOwn : ''}`}
            >
              <div className={`${styles.bubble} ${m.from === 'you' ? styles.bubbleOwn : ''}`}>
                <span className={styles.bubbleWho}>
                  {m.from === 'you' ? 'You' : 'Platform team'}
                </span>
                <p className={styles.bubbleBody}>{m.body}</p>
                <span className={styles.bubbleWhen}>{formatKtmDateTime(m.createdAt)}</span>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      <div className={styles.composer}>
        <label htmlFor="partner-support-draft" className={styles.composerLabel}>
          Your message
        </label>
        <textarea
          id="partner-support-draft"
          className={`gt-input ${styles.composerInput}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          maxLength={2000}
          disabled={busy}
          placeholder="What do you need help with?"
        />
        <div className={styles.composerFoot}>
          <span className={styles.composerHint}>
            The team answers here. Nothing you write reaches your customers.
          </span>
          <Button variant="primary" disabled={busy || draft.trim().length === 0} onClick={send}>
            {busy ? 'Sending…' : 'Send'}
          </Button>
        </div>
        {error ? <div className={styles.composerError}>{error}</div> : null}
      </div>
    </div>
  );
}
