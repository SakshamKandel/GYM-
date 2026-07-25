'use client';

import { orderNumber } from '@gym/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { PartnerAlertOrder, PartnerAlerts as PartnerAlertsPayload } from '../_data';
import { formatDateLabel, formatMoney, windowShort } from '../_format';
import { useCallbackRef } from './useCallbackRef';
import styles from './alerts.module.css';

/**
 * The kitchen bell — mounted once by the partner layout, so it watches from
 * EVERY page of the portal, not just the board.
 *
 * Why it exists: a restaurant has no phone signed into the member app, so the
 * "new order" push sent at checkout has nothing to land on. The only place a
 * partner can be reached is the browser tab that is already open, so that tab
 * has to do the work: poll, show it, say it out loud, and put the count in the
 * page title for the (very common) case where the tab is in the background.
 *
 * Three deliberate decisions:
 *
 *  1. The cursor does NOT advance until the partner acknowledges. Every poll
 *     re-reports the same unseen orders, so a page reload, a navigation, or a
 *     browser crash cannot make an unseen order quietly disappear. Advancing on
 *     read would have been simpler and would have lost orders.
 *  2. Sound is OFF until the partner turns it on, and the choice is remembered.
 *     Browsers refuse to play audio before a real user gesture, so a chime that
 *     switched itself on would be silence pretending to be an alarm. Turning it
 *     on plays the sound once, right there, so the kitchen knows what it will
 *     hear and knows it works.
 *  3. When sound is on but the browser has not let us start audio yet (a fresh
 *     tab restored by the browser, for instance), the bar SAYS so and asks for
 *     one tap. It never claims an alarm it cannot ring.
 */

const POLL_MS = 20_000;
const CHIME_REPEAT_MS = 25_000;
const TITLE_REFRESH_MS = 2_000;
const CURSOR_KEY = 'gt.partner.alertCursor';
const SOUND_KEY = 'gt.partner.alertSound';
const TITLE_PREFIX = /^\(\d+\+?\)\s.*?·\s/;

type SoundState = 'off' | 'ready' | 'blocked';

/** Read a localStorage key without exploding in private mode. */
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the session still works, it just won't be remembered */
  }
}

function audioContextCtor(): typeof AudioContext | undefined {
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

/** A short rising two-tone bell. Silent (never throws) if audio is unavailable. */
function ring(ctx: AudioContext): void {
  try {
    const now = ctx.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const start = now + i * 0.17;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.32, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  } catch {
    /* audio unavailable — the visual alert and the title carry the message */
  }
}

export function PartnerAlerts() {
  const [newOrders, setNewOrders] = useState<PartnerAlertOrder[]>([]);
  const [moreNewOrders, setMoreNewOrders] = useState(false);
  const [activeCount, setActiveCount] = useState(0);
  const [liveDisputes, setLiveDisputes] = useState(0);
  const [unreadTeamReplies, setUnreadTeamReplies] = useState(0);
  const [currency, setCurrency] = useState('NPR');
  const [pollFailed, setPollFailed] = useState(false);
  const [sound, setSound] = useState<SoundState>('off');
  const [expanded, setExpanded] = useState(false);

  const cursorRef = useRef<string | null>(null);
  const latestServerTime = useRef<string | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const knownIds = useRef<Set<string>>(new Set());

  const count = newOrders.length;
  const countLabel = moreNewOrders ? `${count}+` : `${count}`;

  // ── Sound preference ──────────────────────────────────────────────────────
  // Restored after mount (never during render — localStorage is client-only).
  // A remembered "on" still has to get past the browser's autoplay rule, so we
  // try to resume immediately and, failing that, wait for the first real tap
  // anywhere in the portal.
  useEffect(() => {
    if (readStored(SOUND_KEY) !== 'on') return;
    const Ctor = audioContextCtor();
    if (!Ctor) return;
    const ctx = new Ctor();
    audioRef.current = ctx;
    if (ctx.state === 'running') {
      setSound('ready');
      return;
    }
    setSound('blocked');
    const unlock = () => {
      void ctx.resume().then(() => {
        if (ctx.state === 'running') setSound('ready');
      });
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  /** Runs inside the click, which is exactly what the browser wants to see. */
  function turnSoundOn() {
    const Ctor = audioContextCtor();
    if (!Ctor) {
      setSound('blocked');
      return;
    }
    const ctx = audioRef.current ?? new Ctor();
    audioRef.current = ctx;
    void ctx.resume().then(() => {
      if (ctx.state === 'running') {
        setSound('ready');
        ring(ctx);
      } else {
        setSound('blocked');
      }
    });
    writeStored(SOUND_KEY, 'on');
  }

  function turnSoundOff() {
    writeStored(SOUND_KEY, 'off');
    setSound('off');
  }

  // ── The watch ─────────────────────────────────────────────────────────────
  const poll = useCallbackRef(async () => {
    try {
      if (cursorRef.current === null) cursorRef.current = readStored(CURSOR_KEY);
      const qs = cursorRef.current ? `?since=${encodeURIComponent(cursorRef.current)}` : '';
      const res = await fetch(`/api/partner/alerts${qs}`, { credentials: 'include' });
      if (!res.ok) {
        setPollFailed(true);
        return;
      }
      const body = (await res.json()) as PartnerAlertsPayload;
      latestServerTime.current = body.serverTime;

      // First ever poll for this browser: bank the cursor, alert nothing. The
      // kitchen has been working these orders all morning; they are not news.
      if (!cursorRef.current) {
        cursorRef.current = body.serverTime;
        writeStored(CURSOR_KEY, body.serverTime);
      }

      const arrived = body.newOrders.some((o) => !knownIds.current.has(o.orderId));
      for (const o of body.newOrders) knownIds.current.add(o.orderId);

      setNewOrders(body.newOrders);
      setMoreNewOrders(body.moreNewOrders);
      setActiveCount(body.activeCount);
      setLiveDisputes(body.liveDisputes);
      setUnreadTeamReplies(body.unreadTeamReplies);
      setCurrency(body.currency);
      setPollFailed(false);

      if (arrived && body.newOrders.length > 0 && audioRef.current && sound === 'ready') {
        ring(audioRef.current);
      }
    } catch {
      // Offline or a server hiccup. Say so rather than sit there looking live —
      // a silent bell that is silently broken is the whole problem here.
      setPollFailed(true);
    }
  });

  useEffect(() => {
    void poll();
    const t = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  // Ring again, on an interval, for as long as orders sit unacknowledged. A
  // kitchen that missed the first bell is exactly the case this exists for.
  useEffect(() => {
    if (count === 0 || sound !== 'ready') return;
    const t = setInterval(() => {
      if (audioRef.current) ring(audioRef.current);
    }, CHIME_REPEAT_MS);
    return () => clearInterval(t);
  }, [count, sound]);

  // The tab title carries the count so a backgrounded tab is noticeable. It is
  // re-applied on an interval because navigating inside the portal makes Next
  // rewrite the title from the new page's metadata.
  useEffect(() => {
    if (count === 0) return;
    const apply = () => {
      const base = document.title.replace(TITLE_PREFIX, '');
      const next = `(${countLabel}) New order${count === 1 ? '' : 's'} · ${base}`;
      if (document.title !== next) document.title = next;
    };
    apply();
    const t = setInterval(apply, TITLE_REFRESH_MS);
    return () => {
      clearInterval(t);
      document.title = document.title.replace(TITLE_PREFIX, '');
    };
  }, [count, countLabel]);

  function acknowledge() {
    const at = latestServerTime.current;
    if (at) {
      cursorRef.current = at;
      writeStored(CURSOR_KEY, at);
    }
    knownIds.current.clear();
    setNewOrders([]);
    setMoreNewOrders(false);
    setExpanded(false);
  }

  const alerting = count > 0;
  const soundLabel =
    sound === 'ready' ? 'Sound on' : sound === 'blocked' ? 'Tap to start sound' : 'Sound off';

  return (
    <aside
      className={`${styles.dock} ${alerting ? styles.dockAlert : ''}`}
      aria-label="New order watch"
    >
      <div className={styles.row}>
        <span className={styles.status} role="status" aria-live="polite">
          {pollFailed ? (
            <>
              <span className={styles.dotIdle} aria-hidden />
              Not updating right now. Trying again.
            </>
          ) : alerting ? (
            <>
              <span className={styles.dotAlert} aria-hidden />
              <strong className={styles.countText}>
                {countLabel} new order{count === 1 ? '' : 's'}
              </strong>
            </>
          ) : (
            <>
              <span className={styles.dotLive} aria-hidden />
              Watching for new orders
              {activeCount > 0 ? ` · ${activeCount} still open` : ''}
            </>
          )}
        </span>

        {alerting ? (
          <>
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className={styles.ghostBtn}
              aria-expanded={expanded}
            >
              {expanded ? 'Hide' : 'See them'}
            </button>
            <Link href="/partner#live-orders" className={styles.primaryBtn} onClick={acknowledge}>
              Open the board
            </Link>
            <button type="button" onClick={acknowledge} className={styles.ghostBtn}>
              Got it
            </button>
          </>
        ) : null}

        {sound === 'ready' ? (
          <button
            type="button"
            onClick={turnSoundOff}
            className={styles.soundBtn}
            title="Turn the new-order sound off"
          >
            <span aria-hidden="true">🔔</span> {soundLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={turnSoundOn}
            className={`${styles.soundBtn} ${sound === 'blocked' ? styles.soundBtnNudge : ''}`}
            title={
              sound === 'blocked'
                ? 'Your browser needs one tap before it will play sound'
                : 'Play a sound when a new order arrives'
            }
          >
            <span aria-hidden="true">🔕</span> {soundLabel}
          </button>
        )}
      </div>

      {alerting && expanded ? (
        <ul className={styles.list}>
          {newOrders.map((o) => (
            <li key={o.orderId} className={styles.listItem}>
              <span className={styles.listCode}>{orderNumber(o.orderId)}</span>
              <span className={styles.listMeta}>
                {formatDateLabel(o.deliveryDate)} · {windowShort(o.window)} · {o.itemCount} item
                {o.itemCount === 1 ? '' : 's'}
              </span>
              <span className={styles.listTotal}>{formatMoney(o.totalMinor, currency)}</span>
            </li>
          ))}
          {moreNewOrders ? <li className={styles.listMore}>More are waiting on the board.</li> : null}
        </ul>
      ) : null}

      {liveDisputes > 0 || unreadTeamReplies > 0 ? (
        <div className={styles.row}>
          {liveDisputes > 0 ? (
            <Link href="/partner/feedback" className={styles.chip}>
              {liveDisputes} reported problem{liveDisputes === 1 ? '' : 's'}
            </Link>
          ) : null}
          {unreadTeamReplies > 0 ? (
            <Link href="/partner/support" className={styles.chip}>
              {unreadTeamReplies} repl{unreadTeamReplies === 1 ? 'y' : 'ies'} from the team
            </Link>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
