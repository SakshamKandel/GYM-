'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  type Column,
  DataTable,
  Drawer,
  SearchField,
  SkeletonBar,
  TierChip,
  Toolbar,
} from '@/components/console';
import { formatAge, formatDate, formatTime } from '@/lib/format';
import { ActionFeedback, useActionFeedback } from '../../_components/ActionFeedback';
import { KeyboardRows } from '../../_components/KeyboardRows';
import { MemberLink } from '../../_components/MemberLink';
import { QueueTabs } from '../../_components/QueueTabs';
import { useUrlSearch, useUrlState } from '../../_components/useUrlState';
import type { SupportMessage, SupportThreadRow } from './types';

const MAX_LEN = 2000;
/** Show the length counter only once the limit is close enough to matter. */
const COUNTER_FROM = Math.round(MAX_LEN * 0.8);

type TabKey = 'open' | 'mine' | 'resolved' | 'all';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'mine', label: 'Assigned to me' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
];

const TAB_KEYS: readonly TabKey[] = ['open', 'mine', 'resolved', 'all'];

/** The stored value is a database word; the chip should read like English. */
function statusLabel(status: SupportThreadRow['status']): string {
  return status === 'resolved' ? 'Resolved' : 'Open';
}

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
  // Tab and search live in the URL: a staffer who opens a member record from a
  // ticket and comes back lands on the same tab, the same search and the same
  // row, rather than at the top of the whole inbox.
  const [tab, setTab] = useUrlState<TabKey>('tab', 'open', TAB_KEYS);
  const [query, setQuery] = useUrlSearch('q');

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

  // An empty queue should say which empty it is and what to do next, rather
  // than leaving the operator to guess whether the filter or the day is at
  // fault.
  const emptyState = ((): {
    title: string;
    description: string;
    clearSearch?: boolean;
    showAll?: boolean;
  } => {
    if (query.trim()) {
      return {
        title: 'Nothing matches that search',
        description: 'Try part of a name, an email, or a phrase from the message.',
        clearSearch: true,
      };
    }
    switch (tab) {
      case 'open':
        return {
          title: 'The queue is clear',
          description:
            'Every ticket has been answered. New messages land here as they arrive.',
          showAll: true,
        };
      case 'mine':
        return {
          title: 'Nothing is assigned to you',
          description: 'Open a ticket and choose "Assign to me" to pick up the work.',
          showAll: true,
        };
      case 'resolved':
        return {
          title: 'No resolved tickets yet',
          description: 'Tickets move here once you mark them resolved.',
          showAll: true,
        };
      default:
        return {
          title: 'No support tickets yet',
          description: 'When a member writes in from the app, their ticket shows up here.',
        };
    }
  })();

  const columns: Column<SupportThreadRow>[] = [
    {
      // The one accent on the page. A queue is read to answer "what do I do
      // next", and the answer is always the ticket with messages waiting, so
      // that count gets the only loud thing on screen and everything else stays
      // quiet around it.
      key: 'unread',
      header: 'Unread',
      headerHidden: true,
      width: 40,
      render: (r) =>
        r.unread > 0 ? (
          <span
            className="gt-numeric"
            title={`${r.unread} waiting on a reply`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 22,
              height: 22,
              padding: '0 6px',
              borderRadius: 'var(--gt-radius-pill)',
              background: 'var(--gt-accent-strong)',
              color: 'var(--gt-accent-ink)',
              fontSize: 12,
              lineHeight: 1,
            }}
          >
            {r.unread}
          </span>
        ) : null,
    },
    {
      key: 'account',
      header: 'Member',
      primary: true,
      render: (r) => (
        <div style={{ minWidth: 0, maxWidth: 240 }}>
          <MemberLink
            id={r.account.id}
            name={r.account.displayName}
            email={r.account.email}
            canView={canViewMembers}
          />
          <div
            style={{
              marginTop: 2,
              fontSize: 13,
              fontWeight: 400,
              color: 'var(--gt-text-dim)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {r.account.email}
          </div>
        </div>
      ),
    },
    {
      key: 'last',
      header: 'Last message',
      render: (r) => (
        <span
          title={r.lastBody}
          style={{
            display: 'block',
            maxWidth: 380,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            // Answered threads recede; a thread waiting on us keeps full ink.
            color: r.unread > 0 ? 'var(--gt-text)' : 'var(--gt-text-dim)',
            fontWeight: r.unread > 0 ? 500 : 400,
          }}
        >
          {r.lastSender === 'coach' ? (
            <span style={{ color: 'var(--gt-text-faint)' }}>You: </span>
          ) : null}
          {r.lastBody}
        </span>
      ),
    },
    {
      key: 'tier',
      header: 'Plan',
      width: 170,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <TierChip tier={r.account.tier} />
          {waitingPriority(r) ? <Badge tone="info">First in line</Badge> : null}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 116,
      render: (r) => (
        <Badge tone={r.status === 'resolved' ? 'positive' : 'warning'}>
          {statusLabel(r.status)}
        </Badge>
      ),
    },
    {
      key: 'assigned',
      header: 'Owner',
      width: 150,
      render: (r) =>
        r.assignedTo == null ? (
          <span style={{ color: 'var(--gt-text-faint)' }}>Nobody yet</span>
        ) : (
          <span style={{ color: 'var(--gt-text)' }}>
            {r.assignedTo === viewerId ? 'You' : r.assignedToLabel}
          </span>
        ),
    },
    {
      key: 'time',
      header: 'Waiting',
      numeric: true,
      width: 104,
      render: (r) => (
        <span
          title={formatDate(r.lastAt)}
          style={{ color: 'var(--gt-text-dim)', whiteSpace: 'nowrap', fontSize: 13 }}
        >
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
      <Toolbar
        left={
          <QueueTabs
            label="Filter support tickets"
            // Neutral on purpose: the accent on this page marks the tickets
            // waiting on a reply, and a page cannot have two focal points.
            tone="neutral"
            tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: tabCount(t.key) }))}
            value={tab}
            onChange={setTab}
          />
        }
        right={
          <div style={{ width: 280, maxWidth: '100%' }}>
            <SearchField
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email or message"
              aria-label="Search support tickets"
            />
          </div>
        }
      />

      <KeyboardRows>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.account.id}
          caption="Support tickets"
          selectedKey={openId}
          onRowClick={(r) => setOpenId(r.account.id)}
          rowAriaLabel={(r) =>
            `Open ticket for ${r.account.displayName.trim() || r.account.email}${
              r.unread > 0 ? `, ${r.unread} unread` : ''
            }`
          }
          emptyTitle={emptyState.title}
          emptyDescription={emptyState.description}
          emptyAction={
            emptyState.clearSearch ? (
              <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
                Clear search
              </Button>
            ) : emptyState.showAll ? (
              <Button variant="ghost" size="sm" onClick={() => setTab('all')}>
                Show all tickets
              </Button>
            ) : undefined
          }
        />
      </KeyboardRows>

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
  // Resolving, assigning and replying all used to end in silence, so the only
  // way to know a decision had landed was to watch the list behind the drawer.
  const done = useActionFeedback();
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
      done.succeed('Reply sent');
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
  async function runLifecycleAction(
    path: string,
    doneMessage: string,
    body?: unknown,
  ): Promise<void> {
    if (!accountId || lifecycleBusy || !canReply) return;
    setLifecycleBusy(true);
    setLifecycleError(null);
    done.clear();
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
      done.succeed(doneMessage);
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
      width={560}
      footer={
        // A message box, not a form field: room to write, the keyboard shortcut
        // stated once, and the length only mentioned when it starts to matter.
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
          {!canReply ? (
            <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
              You can read support tickets but not answer them, so replying, assigning and
              resolving are switched off.
            </div>
          ) : null}
          <textarea
            className="gt-input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={MAX_LEN}
            disabled={!canReply}
            placeholder={canReply ? 'Write a reply' : 'Read only, so you cannot reply.'}
            aria-label="Write a reply"
            style={{
              resize: 'vertical',
              minHeight: 92,
              lineHeight: 1.5,
              fontSize: 15,
              fontFamily: 'var(--font-heading)',
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--gt-text-faint)' }}>
              {trimmed.length >= COUNTER_FROM ? (
                <span
                  className="gt-numeric"
                  style={{
                    color: trimmed.length > MAX_LEN ? 'var(--gt-danger)' : 'var(--gt-text-dim)',
                  }}
                >
                  {MAX_LEN - trimmed.length} characters left
                </span>
              ) : canReply ? (
                'Ctrl + Enter sends'
              ) : null}
            </span>
            <Button variant="primary" size="sm" disabled={!canSend} onClick={() => void send()}>
              {sending ? 'Sending…' : 'Send reply'}
            </Button>
          </div>
        </div>
      }
    >
      {fallback ? (
        <>
          <div
            style={{
              fontSize: 13,
              color: 'var(--gt-text-dim)',
              overflowWrap: 'anywhere',
            }}
          >
            {fallback.account.email}
          </div>

          {/* Where this ticket stands, and the two things you can do about it.
              Both actions are quiet: the accent belongs to Send reply. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              margin: '12px 0 18px',
              padding: '12px 14px',
              borderRadius: 'var(--gt-radius-sm)',
              border: '1px solid var(--gt-border)',
              background: 'var(--gt-surface-sunken)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Badge tone={fallback.status === 'resolved' ? 'positive' : 'warning'}>
                  {statusLabel(fallback.status)}
                </Badge>
                {fallback.priority ? <Badge tone="info">Priority support</Badge> : null}
              </span>
              <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                {fallback.assignedToLabel
                  ? fallback.assignedTo === viewerId
                    ? 'Assigned to you'
                    : `Assigned to ${fallback.assignedToLabel}`
                  : 'Nobody owns this yet'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {fallback.assignedTo === viewerId ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={lifecycleBusy || !canReply}
                  onClick={() =>
                    void runLifecycleAction('assign', 'No longer assigned to you', {
                      assigneeId: null,
                    })
                  }
                >
                  Unassign
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={lifecycleBusy || !canReply}
                  onClick={() =>
                    void runLifecycleAction('assign', 'Assigned to you', {
                      assigneeId: viewerId,
                    })
                  }
                >
                  Assign to me
                </Button>
              )}
              {fallback.status === 'resolved' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={lifecycleBusy || !canReply}
                  onClick={() => void runLifecycleAction('reopen', 'Ticket reopened')}
                >
                  Reopen
                </Button>
              ) : (
                <Button
                  variant="dark"
                  size="sm"
                  disabled={lifecycleBusy || !canReply}
                  onClick={() => void runLifecycleAction('resolve', 'Ticket resolved')}
                >
                  {lifecycleBusy ? 'Saving…' : 'Mark resolved'}
                </Button>
              )}
            </div>
          </div>
        </>
      ) : null}

      <div style={{ marginBottom: done.feedback ? 14 : 0 }}>
        <ActionFeedback feedback={done.feedback} />
      </div>

      {lifecycleError ? <ThreadAlert>{lifecycleError}</ThreadAlert> : null}
      {error ? <ThreadAlert>{error}</ThreadAlert> : null}

      {loading ? (
        // Bubble-shaped, alternating sides, so the conversation does not jump
        // sideways when it lands.
        <div
          role="status"
          aria-label="Loading this conversation"
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <SkeletonBar w="62%" h={40} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <SkeletonBar w="48%" h={32} />
          </div>
          <SkeletonBar w="70%" h={46} />
        </div>
      ) : messages.length === 0 ? (
        <div style={{ padding: '32px 8px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--gt-text)' }}>
            No messages yet
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--gt-text-dim)',
              marginTop: 6,
              maxWidth: '40ch',
              marginInline: 'auto',
            }}
          >
            This member has not written in. Anything you send starts the conversation.
          </div>
        </div>
      ) : (
        // Ours on the right in solid ink, theirs on the left on a light card:
        // who said what is answered by position and weight before a word is
        // read. A date rule breaks the run so a long thread has landmarks.
        <div ref={scrollRef} style={{ display: 'flex', flexDirection: 'column' }}>
          {messages.map((m, i) => {
            const fromMember = m.sender === 'user';
            const day = formatDate(m.createdAt);
            const newDay = i === 0 || formatDate(messages[i - 1].createdAt) !== day;
            return (
              <div key={m.id}>
                {newDay ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      margin: i === 0 ? '0 0 14px' : '20px 0 14px',
                    }}
                  >
                    <span style={{ flex: 1, height: 1, background: 'var(--gt-border)' }} />
                    <span
                      className="gt-numeric"
                      style={{ fontSize: 11, color: 'var(--gt-text-faint)' }}
                    >
                      {day}
                    </span>
                    <span style={{ flex: 1, height: 1, background: 'var(--gt-border)' }} />
                  </div>
                ) : null}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: fromMember ? 'flex-start' : 'flex-end',
                    marginTop: newDay ? 0 : 10,
                  }}
                >
                  <div
                    style={{
                      maxWidth: '82%',
                      padding: '10px 14px',
                      borderRadius: 'var(--gt-radius)',
                      background: fromMember ? 'var(--gt-surface-sunken)' : 'var(--gt-text)',
                      border: fromMember
                        ? '1px solid var(--gt-border-strong)'
                        : '1px solid var(--gt-text)',
                      color: fromMember ? 'var(--gt-text)' : 'var(--gt-surface)',
                      fontSize: 15,
                      lineHeight: 1.55,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {m.body}
                  </div>
                  <span
                    style={{ fontSize: 11, color: 'var(--gt-text-faint)', margin: '4px 4px 0' }}
                  >
                    {fromMember ? 'Member' : 'Support'}
                    {' · '}
                    <span className="gt-numeric">{formatTime(m.createdAt)}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Drawer>
  );
}

/** One shape for everything that goes wrong inside this panel. */
function ThreadAlert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      style={{
        marginBottom: 14,
        padding: '10px 12px',
        borderRadius: 'var(--gt-radius-sm)',
        border: '1px solid color-mix(in srgb, var(--gt-danger) 32%, transparent)',
        background: 'var(--gt-danger-weak)',
        color: 'var(--gt-danger)',
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}
