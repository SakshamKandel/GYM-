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
  SearchField,
  SkeletonBar,
  TierChip,
} from '@/components/console';
import { formatAge, formatTime } from '@/lib/format';
import { MemberLink } from '../../_components/MemberLink';
import type { SupportMessage, SupportThreadRow } from './types';

const MAX_LEN = 2000;

type TabKey = 'open' | 'mine' | 'resolved' | 'all';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'mine', label: 'Assigned to me' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
];

/**
 * Does this thread belong in the Open work queue? Status OR unread — a member
 * replying to a resolved ticket reopens it server-side, but the reply itself is
 * the work signal, so an unread inbound message keeps the thread in the queue
 * even if its lifecycle row lags (or was never written). Without the unread
 * clause a follow-up on a closed ticket sat invisible behind the Resolved tab
 * forever. Kept as one predicate so the tab filter, the tab counts and the
 * page's stat tiles can never disagree.
 */
function inOpenQueue(t: SupportThreadRow): boolean {
  return t.status === 'open' || t.unread > 0;
}

/**
 * A ticket from a member who pays for priority support AND is waiting on a
 * reply. `priority` alone is just a tier; this pair is what the Elite promise
 * is actually about, and it is the same predicate behind the "Elite waiting"
 * tile on the page above.
 */
function waitingPriority(t: SupportThreadRow): boolean {
  return t.priority && t.unread > 0;
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
 *
 * ORDER MATTERS HERE. Elite members are sold "your support messages get
 * answered first", so the rows arrive already sorted by
 * lib/supportThreads.compareSupportThreads: waiting on a reply first, Elite
 * above the rest, longest wait first inside a tier. Every filter below
 * PRESERVES that order (Array.filter is stable), so whichever tab is showing,
 * the ticket at the top is the one to answer next. Do not re-sort here — the
 * promise is only true if the one comparator decides it.
 */
export function SupportInbox({
  threads,
  viewerId,
  canReply,
  canViewMembers,
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
  /** Viewer holds `members.read`, so member names can link to the record. */
  canViewMembers: boolean;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('open');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const inTab = ((): SupportThreadRow[] => {
      switch (tab) {
        case 'open':
          return threads.filter(inOpenQueue);
        // Resolved is the exact complement of Open, so the two tabs stay a
        // partition of the inbox: a resolved thread with an unread member reply
        // is waiting on staff, so it shows under Open and not here.
        case 'resolved':
          return threads.filter((t) => !inOpenQueue(t));
        case 'mine':
          return threads.filter((t) => t.assignedTo === viewerId);
        case 'all':
        default:
          return threads;
      }
    })();
    // The inbox loads every thread (it has never been paginated), so a plain
    // client-side match over the name, the email and the latest message covers
    // the whole queue — a daily queue with no way to find a ticket by the
    // person who sent it is a queue you read top to bottom, every time.
    const q = query.trim().toLowerCase();
    if (!q) return inTab;
    return inTab.filter((t) =>
      [t.account.displayName, t.account.email, t.lastBody, t.assignedToLabel ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [threads, tab, viewerId, query]);

  function tabCount(key: TabKey): number {
    switch (key) {
      case 'open':
        return threads.filter(inOpenQueue).length;
      case 'resolved':
        return threads.filter((t) => !inOpenQueue(t)).length;
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
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <MemberLink
            id={r.account.id}
            name={r.account.displayName}
            email={r.account.email}
            canView={canViewMembers}
          />
          {r.unread > 0 ? <Badge tone="critical">{r.unread} new</Badge> : null}
        </span>
      ),
    },
    {
      key: 'tier',
      header: 'Tier',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <TierChip tier={r.account.tier} />
          {waitingPriority(r) ? <Badge tone="info">First in line</Badge> : null}
        </span>
      ),
    },
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
          {formatAge(r.lastAt)}
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
      <div style={{ marginBottom: 16, maxWidth: 340 }}>
        <SearchField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email or message"
          aria-label="Search support tickets"
        />
      </div>

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
          query.trim()
            ? 'No tickets match that search.'
            : tab === 'open'
              ? 'No open tickets. All clear.'
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
                ? 'This account has no support ticket yet, so there is nothing to reply to.'
                : 'Could not send the reply.',
        );
        return;
      }
      setBody('');
      await load(accountId);
      onReplied();
    } catch {
      setError('Could not reach us just now. Check your connection and try again.');
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
      setLifecycleError('Could not reach us just now. Check your connection and try again.');
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
              You have read-only access to support. Replying, assigning and
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
                : 'Read-only, so you cannot reply.'
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
            {fallback.priority ? <Badge tone="info">Priority support</Badge> : null}
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
                  {fromUser ? 'Member' : 'Support'} · {formatTime(m.createdAt)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Drawer>
  );
}
