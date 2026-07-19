'use client';

import { useState } from 'react';
import { Button } from '@/components/console';

/**
 * The desktop coach's WRITE surface for a client (Pack K / WP-10): assign a
 * workout program, assign a diet plan, or log a milestone — the two core paid
 * deliverables that were mobile-only until now, plus milestones. Each form
 * POSTs to the EXISTING coach assign route this package already owns
 * (clients/[userId]/{workouts,diet-plans,milestones}); the server masks all
 * free text and pushes the member. No new engine — just the missing front door.
 */

type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snacks';

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
        setMsg({
          kind: 'err',
          text:
            res.status === 400
              ? 'Please fill every field with a valid value.'
              : res.status === 403
                ? 'You are not assigned to this client.'
                : 'Could not save. Try again.',
        });
        setBusy(false);
        return false;
      }
      setMsg({ kind: 'ok', text: okText });
      setBusy(false);
      return true;
    } catch {
      setMsg({ kind: 'err', text: 'Network error. Retry.' });
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
}: {
  title: string;
  children: React.ReactNode;
  onSubmit: () => void;
  busy: boolean;
  msg: { kind: 'ok' | 'err'; text: string } | null;
  submitLabel: string;
}) {
  return (
    <form
      className="gt-card"
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <strong style={{ fontFamily: 'var(--font-heading)', fontSize: 15 }}>{title}</strong>
      {children}
      {msg ? (
        <div
          role={msg.kind === 'err' ? 'alert' : 'status'}
          style={{ fontSize: 13, color: msg.kind === 'err' ? 'var(--gt-red)' : 'var(--gt-text-dim)' }}
        >
          {msg.text}
        </div>
      ) : null}
      <div>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function WorkoutForm({ userId }: { userId: string }) {
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
    <FormCard title="Assign workout" onSubmit={submit} busy={busy} msg={msg} submitLabel="Assign workout">
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

function DietForm({ userId }: { userId: string }) {
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
    <FormCard title="Assign diet plan" onSubmit={submit} busy={busy} msg={msg} submitLabel="Assign diet plan">
      <input
        className="gt-input"
        style={inputStyle}
        placeholder="Plan title (e.g. Cut — 2200 kcal)"
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

export function AssignPanel({ userId }: { userId: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <WorkoutForm userId={userId} />
      <DietForm userId={userId} />
      <MilestoneForm userId={userId} />
    </div>
  );
}
