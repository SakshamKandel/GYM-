'use client';

import { useState } from 'react';
import { hasEntitlement, minTierFor, type Feature, type Tier } from '@gym/shared';
import { Button } from '@/components/console';
import { tierLabel } from '@/app/admin/_lib/tierLabel';
import { usePanelData } from './panelKit';

/**
 * The desktop coach's WRITE surface for a client (Pack K / WP-10): assign a
 * workout program, assign a diet plan, or log a milestone — the two core paid
 * deliverables that were mobile-only until now, plus milestones. Each form
 * POSTs to the EXISTING coach assign route this package already owns
 * (clients/[userId]/{workouts,diet-plans,milestones}); the server masks all
 * free text and pushes the member. No new engine — just the missing front door.
 *
 * Assigned programs and diet plans have a tier floor (Silver / Gold), and the
 * member's app hides them below it. Writing one for a client under that floor
 * used to succeed silently: stored, pushed, and invisible. Each form now reads
 * the client's current plan and turns itself off with the reason in words, and
 * the route backs it up with a 409 naming the plan required.
 */

type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snacks';

/**
 * Why this form is switched off, or null when it isn't.
 *
 * Null while the client's plan is still loading, on purpose: the route re-checks
 * every write and its 409 names the plan, so a slow read can never lock out a
 * coach who is allowed to write.
 */
function assignBlockNote(tier: Tier | null, feature: Feature, what: string): string | null {
  if (tier === null || hasEntitlement({ tier }, feature)) return null;
  return `${what} need ${tierLabel(minTierFor(feature))} or higher. This client is on ${tierLabel(tier)}, so they would not see it.`;
}

interface WorkoutRow {
  name: string;
  sets: number;
  repRange: string;
  restSec: number;
}
interface DietRow {
  meal: MealSlot;
  name: string;
  qty: string;
}

const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snacks'];

/**
 * Plain words for a rejected write. The 409 is the tier floor the client sits
 * under: it is the one failure a coach can actually do something about (ask
 * them to upgrade), so it names the plan instead of reading as a save error.
 */
async function failureText(res: Response): Promise<string> {
  if (res.status === 409) {
    let body: { error?: unknown; requiredTier?: unknown } | null = null;
    try {
      body = (await res.json()) as { error?: unknown; requiredTier?: unknown };
    } catch {
      // Not JSON. Fall through to the generic wording below.
    }
    if (body?.error === 'tier_required') {
      const needed = typeof body.requiredTier === 'string' ? tierLabel(body.requiredTier) : null;
      return needed
        ? `This client needs the ${needed} plan or higher before they can be given this.`
        : 'This client is on a plan that does not include this yet.';
    }
  }
  if (res.status === 400) return 'Please fill every field with a valid value.';
  if (res.status === 403) return 'You are not assigned to this client.';
  return 'Could not save. Try again.';
}

function useSubmit(userId: string) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function send(path: string, body: unknown, okText: string): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/coach/clients/${encodeURIComponent(userId)}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setMsg({ kind: 'err', text: await failureText(res) });
        setBusy(false);
        return false;
      }
      setMsg({ kind: 'ok', text: okText });
      setBusy(false);
      return true;
    } catch {
      setMsg({ kind: 'err', text: 'Could not reach us just now. Try again.' });
      setBusy(false);
      return false;
    }
  }

  return { busy, msg, send };
}

const inputStyle: React.CSSProperties = { width: '100%', minHeight: 40 };

function FormCard({
  title,
  children,
  onSubmit,
  busy,
  msg,
  submitLabel,
  blockedNote,
}: {
  title: string;
  children: React.ReactNode;
  onSubmit: () => void;
  busy: boolean;
  msg: { kind: 'ok' | 'err'; text: string } | null;
  submitLabel: string;
  /** Set when the client's plan can't show this: the reason, in words. */
  blockedNote?: string | null;
}) {
  const blocked = Boolean(blockedNote);
  return (
    <form
      className="gt-card"
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!blocked) onSubmit();
      }}
    >
      <strong style={{ fontFamily: 'var(--font-heading)', fontSize: 15 }}>{title}</strong>
      {children}
      {blockedNote ? (
        // Sits right above the button it explains, so the disabled state is
        // never a dead control with no reason attached.
        <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>{blockedNote}</div>
      ) : null}
      {msg ? (
        <div
          role={msg.kind === 'err' ? 'alert' : 'status'}
          style={{ fontSize: 13, color: msg.kind === 'err' ? 'var(--gt-red)' : 'var(--gt-text-dim)' }}
        >
          {msg.text}
        </div>
      ) : null}
      <div>
        <Button type="submit" variant="primary" size="sm" disabled={busy || blocked}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function WorkoutForm({ userId, blockedNote }: { userId: string; blockedNote: string | null }) {
  const { busy, msg, send } = useSubmit(userId);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<WorkoutRow[]>([{ name: '', sets: 3, repRange: '8-12', restSec: 90 }]);

  function update(i: number, patch: Partial<WorkoutRow>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function submit() {
    const items = rows
      .filter((r) => r.name.trim().length > 0)
      .map((r) => ({
        exerciseId: null,
        name: r.name.trim(),
        sets: r.sets,
        repRange: r.repRange.trim() || '8-12',
        restSec: r.restSec,
      }));
    if (title.trim().length === 0 || items.length === 0) return;
    const ok = await send('workouts', { title: title.trim(), notes: notes.trim() || undefined, items }, 'Workout assigned.');
    if (ok) {
      setTitle('');
      setNotes('');
      setRows([{ name: '', sets: 3, repRange: '8-12', restSec: 90 }]);
    }
  }

  return (
    <FormCard
      title="Assign workout"
      onSubmit={submit}
      busy={busy}
      msg={msg}
      submitLabel="Assign workout"
      blockedNote={blockedNote}
    >
      <input
        className="gt-input"
        style={inputStyle}
        placeholder="Program title (e.g. Push Day A)"
        aria-label="Workout title"
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="gt-input"
        style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }}
        placeholder="Notes (optional)"
        aria-label="Workout notes"
        value={notes}
        maxLength={1000}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input
              className="gt-input"
              style={{ flex: 2, minWidth: 120, minHeight: 40 }}
              placeholder="Exercise"
              aria-label={`Exercise ${i + 1} name`}
              value={r.name}
              maxLength={80}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <input
              className="gt-input gt-numeric"
              style={{ width: 64, minHeight: 40 }}
              type="number"
              min={1}
              max={10}
              aria-label={`Exercise ${i + 1} sets`}
              value={r.sets}
              onChange={(e) => update(i, { sets: Number(e.target.value) })}
            />
            <input
              className="gt-input"
              style={{ width: 84, minHeight: 40 }}
              placeholder="reps"
              aria-label={`Exercise ${i + 1} rep range`}
              value={r.repRange}
              maxLength={12}
              onChange={(e) => update(i, { repRange: e.target.value })}
            />
            <input
              className="gt-input gt-numeric"
              style={{ width: 72, minHeight: 40 }}
              type="number"
              min={15}
              max={600}
              aria-label={`Exercise ${i + 1} rest seconds`}
              value={r.restSec}
              onChange={(e) => update(i, { restSec: Number(e.target.value) })}
            />
          </div>
        ))}
      </div>
      {rows.length < 15 ? (
        <button
          type="button"
          onClick={() => setRows((r) => [...r, { name: '', sets: 3, repRange: '8-12', restSec: 90 }])}
          style={addRowStyle}
        >
          + Add exercise
        </button>
      ) : null}
    </FormCard>
  );
}

function DietForm({ userId, blockedNote }: { userId: string; blockedNote: string | null }) {
  const { busy, msg, send } = useSubmit(userId);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<DietRow[]>([{ meal: 'breakfast', name: '', qty: '' }]);

  function update(i: number, patch: Partial<DietRow>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function submit() {
    const valid = rows.filter((r) => r.name.trim().length > 0 && r.qty.trim().length > 0);
    if (title.trim().length === 0 || valid.length === 0) return;
    // Group flat rows into the { meal, items[] } shape the diet route expects.
    const byMeal = new Map<MealSlot, { name: string; qty: string }[]>();
    for (const r of valid) {
      const list = byMeal.get(r.meal) ?? [];
      list.push({ name: r.name.trim(), qty: r.qty.trim() });
      byMeal.set(r.meal, list);
    }
    const meals = [...byMeal.entries()].map(([meal, items]) => ({ meal, items }));
    const ok = await send('diet-plans', { title: title.trim(), notes: notes.trim() || undefined, meals }, 'Diet plan assigned.');
    if (ok) {
      setTitle('');
      setNotes('');
      setRows([{ meal: 'breakfast', name: '', qty: '' }]);
    }
  }

  return (
    <FormCard
      title="Assign diet plan"
      onSubmit={submit}
      busy={busy}
      msg={msg}
      submitLabel="Assign diet plan"
      blockedNote={blockedNote}
    >
      <input
        className="gt-input"
        style={inputStyle}
        placeholder="Plan title (e.g. Cut at 2200 kcal)"
        aria-label="Diet plan title"
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="gt-input"
        style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }}
        placeholder="Notes (optional)"
        aria-label="Diet plan notes"
        value={notes}
        maxLength={1000}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select
              className="gt-input"
              style={{ width: 120, minHeight: 40 }}
              aria-label={`Item ${i + 1} meal`}
              value={r.meal}
              onChange={(e) => update(i, { meal: e.target.value as MealSlot })}
            >
              {MEAL_SLOTS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              className="gt-input"
              style={{ flex: 2, minWidth: 120, minHeight: 40 }}
              placeholder="Food"
              aria-label={`Item ${i + 1} name`}
              value={r.name}
              maxLength={80}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <input
              className="gt-input"
              style={{ width: 100, minHeight: 40 }}
              placeholder="qty (e.g. 150g)"
              aria-label={`Item ${i + 1} quantity`}
              value={r.qty}
              maxLength={40}
              onChange={(e) => update(i, { qty: e.target.value })}
            />
          </div>
        ))}
      </div>
      {rows.length < 24 ? (
        <button
          type="button"
          onClick={() => setRows((r) => [...r, { meal: 'breakfast', name: '', qty: '' }])}
          style={addRowStyle}
        >
          + Add item
        </button>
      ) : null}
    </FormCard>
  );
}

function MilestoneForm({ userId }: { userId: string }) {
  const { busy, msg, send } = useSubmit(userId);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [achievedAt, setAchievedAt] = useState(() => new Date().toISOString().slice(0, 10));

  async function submit() {
    if (title.trim().length === 0) return;
    const ok = await send(
      'milestones',
      { title: title.trim(), note: note.trim() || undefined, achievedAt },
      'Milestone logged.',
    );
    if (ok) {
      setTitle('');
      setNote('');
    }
  }

  return (
    <FormCard title="Log milestone" onSubmit={submit} busy={busy} msg={msg} submitLabel="Log milestone">
      <input
        className="gt-input"
        style={inputStyle}
        placeholder="Milestone (e.g. First bodyweight bench)"
        aria-label="Milestone title"
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="gt-input"
        style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }}
        placeholder="Note (optional)"
        aria-label="Milestone note"
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
      />
      <input
        className="gt-input gt-numeric"
        style={{ width: 170, minHeight: 40 }}
        type="date"
        aria-label="Milestone date"
        value={achievedAt}
        onChange={(e) => setAchievedAt(e.target.value)}
      />
    </FormCard>
  );
}

const addRowStyle: React.CSSProperties = {
  appearance: 'none',
  background: 'transparent',
  border: '1px dashed var(--gt-border)',
  borderRadius: 8,
  padding: '8px 10px',
  minHeight: 40,
  fontSize: 13,
  color: 'var(--gt-text-dim)',
  cursor: 'pointer',
  alignSelf: 'flex-start',
};

/** Only the tier is read here; the Overview tab owns the rest of this payload. */
interface ClientTierRead {
  client: { tier: Tier };
}

export function AssignPanel({ userId }: { userId: string }) {
  // The client's CURRENT plan (the route already collapses a lapsed paid window
  // to starter, exactly as the member's own app does). A failed read leaves the
  // forms enabled and the route's 409 does the talking.
  const { data } = usePanelData<ClientTierRead>(
    `/api/coach/clients/${encodeURIComponent(userId)}/overview`,
  );
  const tier = data?.client.tier ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <WorkoutForm
        userId={userId}
        blockedNote={assignBlockNote(tier, 'coach_workouts', 'Assigned workouts')}
      />
      <DietForm
        userId={userId}
        blockedNote={assignBlockNote(tier, 'coach_diet', 'Assigned diet plans')}
      />
      {/* Milestones are a record of something the client actually did, so they
          are never gated by what the client is paying for. */}
      <MilestoneForm userId={userId} />
    </div>
  );
}
