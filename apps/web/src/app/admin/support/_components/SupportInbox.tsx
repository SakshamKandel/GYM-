'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  type Column,
  DataTable,
  Drawer,
  EmptyState,
  SkeletonBar,
  TierChip,
} from '@/components/console';
import type { SupportMessage, SupportThreadRow } from './types';

const MAX_LEN = 2000;

type TabKey = 'open' | 'mine' | 'resolved' | 'all';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'mine', label: 'Assigned to me' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
];

/** Short relative age ("3m", "2h", "5d") with an absolute fallback. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < 0) return 'now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Admin console — Support inbox. A table of every account with a support
 * ticket (master) opens a Drawer with the full thread + reply composer
 * (detail) — same master/detail shape as the Members directory, chat bubbles
 * mirroring the coach console's thread view.
 *
 * Opening a thread calls GET /api/admin/support/threads/[accountId] (read-
 * only) and, alongside it, POST .../read to mark the account's inbound rows
 * readByCoach=true server-side (F2: mark-read is a distinct POST, never a
 * side effect of GET, so a plain top-level navigation can't silently clear
 * the unread queue). Closing the drawer (or sending a reply, resolving,
 * reopening, or assigning) triggers router.refresh() so the table's unread
 * badges, lifecycle chips, and stat tiles reflect that.
 *
 * Lifecycle tabs (plan §3 P1-11) filter the ALREADY-LOADED `threads` array
 * client-side — this inbox has never been paginated (support ticket volume
 * is small relative to the member base), so there is no extra network round
 * trip per tab switch, and no request-race guard is needed for the list
 * itself (only the per-thread drawer load still needs one — see reqSeq
 * below).
 */
export function SupportInbox({
  threads,
  viewerId,
  canReply,
}: {
  threads: SupportThreadRow[];
  viewerId: string;
  /**
   * Effective `support.thread.reply`. When false the composer and all three
   * lifecycle actions (assign/resolve/reopen) are disabled — every one of them
   * backs onto a route guarded by that permission, so surfacing them enabled to
   * a read-only viewer is the P1-3 403-trap.
   */
  canReply: boolean;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('open');

  const filtered = useMemo(() => {
    switch (tab) {
      case 'open':
        return threads.filter((t) => t.status === 'open');
      case 'resolved':
        return threads.filter((t) => t.status === 'resolved');
      case 'mine':
        return threads.filter((t) => t.assignedTo === viewerId);
      case 'all':
      default:
        return threads;
    }
  }, [threads, tab, viewerId]);

  function tabCount(key: TabKey): number {
    switch (key) {
      case 'open':
        return threads.filter((t) => t.status === 'open').length;
      case 'resolved':
        return threads.filter((t) => t.status === 'resolved').length;
      case 'mine':
        return threads.filter((t) => t.assignedTo === viewerId).length;
      case 'all':
      default:
        return threads.length;
    }
  }

  const selected = openId ? threads.find((t) => t.account.id === openId) ?? null : null;

  const columns: Column<SupportThreadRow>[] = [
    {
      key: 'account',
      header: 'Account',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 500 }}>{r.account.displayName.trim() || r.account.email}</span>
          {r.unread > 0 ? <Badge tone="critical">{r.unread} new</Badge> : null}
        </span>
      ),
    },
    { key: 'tier', header: 'Tier', render: (r) => <TierChip tier={r.account.tier} /> },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge tone={r.status === 'resolved' ? 'positive' : 'warning'}>{r.status}</Badge>
      ),
    },
    {
      key: 'assigned',
      header: 'Assigned',
      render: (r) => (
        <span style={{ color: r.assignedToLabel ? 'var(--gt-text)' : 'var(--gt-text-dim)' }}>
          {r.assignedToLabel ?? 'Unassigned'}
        </span>
      ),
    },
    {
      key: 'last',
      header: 'Last message',
      render: (r) => (
        <span
          style={{
            display: 'block',
            maxWidth: 360,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: r.unread > 0 ? 'var(--gt-text)' : 'var(--gt-text-dim)',
          }}
        >
          {r.lastSender === 'coach' ? 'You: ' : ''}
          {r.lastBody}
        </span>
      ),
    },
    {
      key: 'time',
      header: 'Last activity',
      align: 'right',
      render: (r) => (
        <span className="gt-numeric" style={{ color: 'var(--gt-text-dim)', whiteSpace: 'nowrap' }}>
          {relativeTime(r.lastAt)}
        </span>
      ),
    },
  ];

  function onClose() {
    setOpenId(null);
    router.refresh();
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: '7px 14px',
                borderRadius: 10,
                cursor: 'pointer',
                fontFamily: 'var(--font-heading)',
                fontSize: 13,
                fontWeight: 600,
                background: active ? 'var(--gt-accent)' : 'transparent',
                color: active ? 'var(--gt-accent-ink)' : 'var(--gt-text)',
                border: active ? '1px solid var(--gt-accent)' : '1px solid var(--gt-border)',
              }}
            >
              {t.label} · {tabCount(t.key)}
            </button>
          );
        })}
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.account.id}
        onRowClick={(r) => setOpenId(r.account.id)}
        rowAriaLabel={(r) =>
          `Open ticket for ${r.account.displayName.trim() || r.account.email}`
        }
        empty={
          tab === 'open'
            ? 'No open tickets — all clear.'
            : tab === 'resolved'
              ? 'No resolved tickets yet.'
              : tab === 'mine'
                ? 'No tickets assigned to you.'
                : 'No support tickets yet.'
        }
      />

      <SupportThreadDrawer
        accountId={openId}
        fallback={selected}
        viewerId={viewerId}
        canReply={canReply}
        onClose={onClose}
        onReplied={() => router.refresh()}
      />
    </>
  );
}

function SupportThreadDrawer({
  accountId,
  fallback,
  viewerId,
  canReply,
  onClose,
  onReplied,
}: {
  accountId: string | null;
  fallback: SupportThreadRow | null;
  viewerId: string;
  canReply: boolean;
  onClose: () => void;
  onReplied: () => void;
}) {
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Monotonic request sequence (mirrors MembersDirectory's fetchPage guard /
  // StaffManager's GrantRoleModal search guard): every load() bumps this
  // before firing, and the response only commits if it's still the newest
  // request in flight for the currently-open drawer. Without this, clicking
  // ticket A then quickly clicking ticket B (or closing the drawer) could let
  // a slow response for A land after B is open (or after close) and overwrite
  // the wrong account's messages.
  const reqSeq = useRef(0);

  const load = useCallback(async (id: string) => {
    const mySeq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/support/threads/${id}`, { credentials: 'include' });
      if (mySeq !== reqSeq.current) return; // superseded by a newer request
      if (!res.ok) {
        setError('Could not load this thread.');
        setMessages([]);
        return;
      }
      const data = (await res.json()) as { messages: SupportMessage[] };
      setMessages(data.messages);
      // Fire-and-forget: mark the thread read now that it's open. Failure
      // here just leaves the unread badge stale until the next open/refresh —
      // it must never block or fail the (already-successful) thread load.
      void fetch(`/api/admin/support/threads/${id}/read`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {});
    } catch {
      if (mySeq !== reqSeq.current) return;
      setError('Could not load this thread.');
      setMessages([]);
    } finally {
      if (mySeq === reqSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId) {
      reqSeq.current += 1; // supersede any in-flight load for the closed/previous account
      setMessages([]);
      setBody('');
      setError(null);
      setLifecycleError(null);
      return;
    }
    setLifecycleError(null);
    void load(accountId);
  }, [accountId, load]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  const trimmed = body.trim();
  const canSend =
    canReply && accountId !== null && trimmed.length > 0 && trimmed.length <= MAX_LEN && !sending;

  async function send() {
    if (!canSend || !accountId) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/support/threads/${accountId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      });
      if (!res.ok) {
        let code: string | null = null;
        try {
          const data = (await res.json()) as { error?: unknown };
          code = typeof data.error === 'string' ? data.error : null;
        } catch {
          code = null;
        }
        setError(
          res.status === 403
            ? 'You do not have permission to reply.'
            : code === 'not_found'
              ? 'This account no longer exists.'
              : code === 'no_thread'
                ? 'This account has no support ticket yet — nothing to reply to.'
                : 'Could not send the reply.',
        );
        return;
      }
      setBody('');
      await load(accountId);
      onReplied();
    } catch {
      setError('Network error. Check your connection and retry.');
    } finally {
      setSending(false);
    }
  }

  /**
   * Shared runner for the three lifecycle actions (resolve/reopen/assign) —
   * each is a POST with no body (resolve/reopen) or a small JSON body
   * (assign). On success, re-loads the thread's own state isn't needed (the
   * list-level fields live on `fallback`/`threads` in the parent), so we just
   * bubble up `onReplied()` — the parent's router.refresh() re-fetches the
   * server-rendered page, which is where status/assignedTo actually live.
   */
  async function runLifecycleAction(path: string, body?: unknown): Promise<void> {
    if (!accountId || lifecycleBusy || !canReply) return;
    setLifecycleBusy(true);
    setLifecycleError(null);
    try {
      const res = await fetch(`/api/admin/support/threads/${accountId}/${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        setLifecycleError(
          res.status === 403 ? 'You do not have permission to do that.' : 'Could not update the ticket.',
        );
        return;
      }
      onReplied();
    } catch {
      setLifecycleError('Network error. Check your connection and retry.');
    } finally {
      setLifecycleBusy(false);
    }
  }

  const header = fallback?.account.displayName.trim() || fallback?.account.email || 'Support ticket';

  return (
    <Drawer
      open={accountId !== null}
      onClose={onClose}
      title={header}
      width={520}
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          {!canReply ? (
            <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
              You have read-only access to support — replying, assigning and
              resolving are disabled.
            </div>
          ) : null}
          <textarea
            className="gt-input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={MAX_LEN}
            disabled={!canReply}
            placeholder={
              canReply
                ? 'Reply as support…  (⌘/Ctrl + Enter to send)'
                : 'Read-only — you cannot reply.'
            }
            aria-label="Reply"
            style={{ resize: 'vertical', minHeight: 56, fontFamily: 'var(--font-heading)' }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span
              className="gt-numeric"
              style={{ fontSize: 12, color: trimmed.length > MAX_LEN ? 'var(--gt-danger)' : 'var(--gt-text-dim)' }}
            >
              {trimmed.length}/{MAX_LEN}
            </span>
            <Button variant="primary" size="sm" disabled={!canSend} onClick={() => void send()}>
              {sending ? 'Sending…' : 'Send reply'}
            </Button>
          </div>
        </div>
      }
    >
      {fallback ? (
        <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--gt-text-dim)', wordBreak: 'break-all' }}>
          {fallback.account.email}
        </div>
      ) : null}

      {fallback ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
            marginBottom: 14,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid var(--gt-border)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Badge tone={fallback.status === 'resolved' ? 'positive' : 'warning'}>
              {fallback.status}
            </Badge>
            <span style={{ color: 'var(--gt-text-dim)' }}>
              {fallback.assignedToLabel
                ? fallback.assignedTo === viewerId
                  ? 'Assigned to you'
                  : `Assigned to ${fallback.assignedToLabel}`
                : 'Unassigned'}
            </span>
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {fallback.assignedTo === viewerId ? (
              <Button
                size="sm"
                disabled={lifecycleBusy || !canReply}
                onClick={() => void runLifecycleAction('assign', { assigneeId: null })}
              >
                Unassign
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={lifecycleBusy || !canReply}
                onClick={() => void runLifecycleAction('assign', { assigneeId: viewerId })}
              >
                Assign to me
              </Button>
            )}
            {fallback.status === 'resolved' ? (
              <Button
                size="sm"
                disabled={lifecycleBusy || !canReply}
                onClick={() => void runLifecycleAction('reopen')}
              >
                Reopen
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                disabled={lifecycleBusy || !canReply}
                onClick={() => void runLifecycleAction('resolve')}
              >
                Resolve
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {lifecycleError ? (
        <div
          role="alert"
          style={{
            marginBottom: 14,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid color-mix(in srgb, var(--gt-danger) 32%, transparent)',
            background: 'var(--gt-danger-weak)',
            color: 'var(--gt-danger)',
            fontSize: 13,
          }}
        >
          {lifecycleError}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          style={{
            marginBottom: 14,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid color-mix(in srgb, var(--gt-danger) 32%, transparent)',
            background: 'var(--gt-danger-weak)',
            color: 'var(--gt-danger)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SkeletonBar w="70%" />
          <SkeletonBar w="55%" />
          <SkeletonBar w="80%" />
        </div>
      ) : messages.length === 0 ? (
        <EmptyState
          title="No messages yet"
          description="This account hasn't sent a support message."
        />
      ) : (
        <div ref={scrollRef} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {messages.map((m) => {
            const fromUser = m.sender === 'user';
            return (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: fromUser ? 'flex-end' : 'flex-start',
                  marginTop: 8,
                }}
              >
                <div
                  style={{
                    maxWidth: '86%',
                    padding: '9px 13px',
                    borderRadius: 14,
                    background: fromUser ? 'var(--gt-card)' : 'var(--gt-bg)',
                    border: '1px solid var(--gt-border)',
                    fontSize: 14,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: 'var(--gt-text)',
                  }}
                >
                  {m.body}
                </div>
                <span
                  className="gt-numeric"
                  style={{ fontSize: 10.5, color: 'var(--gt-text-dim)', margin: '3px 4px 0' }}
                >
                  {fromUser ? 'Member' : 'Support'} · {clockTime(m.createdAt)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Drawer>
  );
}
