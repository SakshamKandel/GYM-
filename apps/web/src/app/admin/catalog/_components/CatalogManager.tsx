'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  Card,
  type Column,
  ConfirmButton,
  DataTable,
  Modal,
  SearchField,
  TextField,
  Toolbar,
} from '@/components/console';
import type {
  ExerciseRow,
  PlanExerciseDetail,
  PlanGoal,
  PlanRow,
  PlanTier,
  PlanWorkoutDetail,
} from './types';

const TIERS: PlanTier[] = ['starter', 'silver', 'gold', 'elite'];
const GOALS: PlanGoal[] = ['fat_loss', 'muscle', 'strength'];

/** Textarea (one item per line) <-> string[] helpers for the jsonb array fields. */
function linesToArray(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
function arrayToLines(arr: string[]): string {
  return arr.join('\n');
}

async function parseErrorCode(res: Response): Promise<string | null> {
  try {
    const data = (await res.json()) as { error?: unknown };
    return typeof data.error === 'string' ? data.error : null;
  } catch {
    return null;
  }
}

/**
 * Exercise + plan catalog CRUD (P2-16). Two tabs sharing one Toolbar/Modal
 * shell. The plan editor's workout/exercise structure is edited as JSON in a
 * textarea rather than a drag-and-drop builder — a deliberate scope cut for
 * this wave (see the admin route's doc comment); it round-trips exactly the
 * shape `GET /api/admin/catalog/plans/[id]` returns and
 * `PATCH .../plans/[id]` accepts for `workouts`.
 */
export function CatalogManager({
  exercises,
  plans,
}: {
  exercises: ExerciseRow[];
  plans: PlanRow[];
}) {
  const [tab, setTab] = useState<'exercises' | 'plans'>('exercises');

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <TabButton active={tab === 'exercises'} onClick={() => setTab('exercises')}>
          Exercises ({exercises.length})
        </TabButton>
        <TabButton active={tab === 'plans'} onClick={() => setTab('plans')}>
          Plans ({plans.length})
        </TabButton>
      </div>

      {tab === 'exercises' ? <ExercisesTab exercises={exercises} /> : <PlansTab plans={plans} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '8px 14px',
        borderRadius: 10,
        cursor: 'pointer',
        fontFamily: 'var(--font-heading)',
        fontSize: 13,
        fontWeight: 600,
        background: active ? 'var(--gt-red)' : 'transparent',
        color: active ? '#fff' : 'var(--gt-text)',
        border: active ? '1px solid var(--gt-red)' : '1px solid var(--gt-border)',
      }}
    >
      {children}
    </button>
  );
}

// ── Exercises ────────────────────────────────────────────────────────────

interface ExerciseFormState {
  id: string;
  name: string;
  muscleGroup: string;
  equipment: string;
  level: string;
  category: string;
  secondaryMuscles: string;
  instructions: string;
  imageUrls: string;
}

const EMPTY_EXERCISE_FORM: ExerciseFormState = {
  id: '',
  name: '',
  muscleGroup: '',
  equipment: '',
  level: '',
  category: '',
  secondaryMuscles: '',
  instructions: '',
  imageUrls: '',
};

function ExercisesTab({ exercises }: { exercises: ExerciseRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ExerciseFormState>(EMPTY_EXERCISE_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return exercises;
    return exercises.filter(
      (e) => e.name.toLowerCase().includes(q) || e.muscleGroup.toLowerCase().includes(q),
    );
  }, [exercises, query]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_EXERCISE_FORM);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(row: ExerciseRow) {
    setEditingId(row.id);
    setForm({
      id: row.id,
      name: row.name,
      muscleGroup: row.muscleGroup,
      equipment: row.equipment ?? '',
      level: row.level ?? '',
      category: row.category ?? '',
      secondaryMuscles: arrayToLines(row.secondaryMuscles),
      instructions: arrayToLines(row.instructions),
      imageUrls: arrayToLines(row.imageUrls),
    });
    setError(null);
    setModalOpen(true);
  }

  async function save() {
    if (!form.name.trim() || !form.muscleGroup.trim()) {
      setError('Name and muscle group are required.');
      return;
    }
    setSaving(true);
    setError(null);
    // PATCH (edit) and POST (create) disagree on what an empty field means:
    // the PATCH route treats an omitted key as "leave untouched" and an
    // explicit `null` as "clear it" (its zod schema is `.nullable().optional()`),
    // while the POST route's schema has no `.nullable()` — sending `null` there
    // fails validation, so a blank optional field must be omitted (`undefined`)
    // on create. Using `|| undefined` unconditionally for both meant clearing
    // an existing value while editing silently dropped the key instead of
    // clearing it, so the stale value survived the "save".
    const trimmedEquipment = form.equipment.trim();
    const trimmedLevel = form.level.trim();
    const trimmedCategory = form.category.trim();
    const body = {
      name: form.name.trim(),
      muscleGroup: form.muscleGroup.trim(),
      equipment: trimmedEquipment || (editingId ? null : undefined),
      level: trimmedLevel || (editingId ? null : undefined),
      category: trimmedCategory || (editingId ? null : undefined),
      secondaryMuscles: linesToArray(form.secondaryMuscles),
      instructions: linesToArray(form.instructions),
      imageUrls: linesToArray(form.imageUrls),
    };
    try {
      const res = editingId
        ? await fetch(`/api/admin/catalog/exercises/${encodeURIComponent(editingId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
          })
        : await fetch('/api/admin/catalog/exercises', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(editingId ? body : { ...body, id: form.id.trim() || undefined }),
          });
      if (!res.ok) {
        const code = await parseErrorCode(res);
        setError(
          code === 'id_taken'
            ? 'That exercise id is already in use.'
            : res.status === 403
              ? 'You are not allowed to manage the catalog.'
              : 'Could not save that exercise.',
        );
        setSaving(false);
        return;
      }
      setSaving(false);
      setModalOpen(false);
      router.refresh();
    } catch {
      setError('Network error.');
      setSaving(false);
    }
  }

  async function remove(row: ExerciseRow) {
    setRowBusy(row.id);
    setRowError(null);
    try {
      const res = await fetch(`/api/admin/catalog/exercises/${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const code = await parseErrorCode(res);
        setRowError({
          id: row.id,
          msg: code === 'in_use' ? 'Still used by a plan — remove it there first.' : 'Could not delete.',
        });
        setRowBusy(null);
        return;
      }
      setRowBusy(null);
      router.refresh();
    } catch {
      setRowError({ id: row.id, msg: 'Network error.' });
      setRowBusy(null);
    }
  }

  const columns: Column<ExerciseRow>[] = [
    { key: 'name', header: 'Name', render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
    { key: 'muscle', header: 'Muscle group', render: (r) => r.muscleGroup },
    {
      key: 'equipment',
      header: 'Equipment',
      render: (r) => r.equipment ?? <span style={{ color: 'var(--gt-text-dim)' }}>—</span>,
    },
    {
      key: 'level',
      header: 'Level',
      render: (r) => r.level ?? <span style={{ color: 'var(--gt-text-dim)' }}>—</span>,
    },
    {
      key: 'used',
      header: 'Used by',
      width: 90,
      align: 'right',
      render: (r) => <span className="gt-numeric">{r.usedByPlanCount} plan{r.usedByPlanCount === 1 ? '' : 's'}</span>,
    },
    {
      key: 'actions',
      header: '',
      width: 160,
      align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
            Edit
          </Button>
          <ConfirmButton
            label="Delete"
            confirmLabel="Confirm?"
            size="sm"
            busy={rowBusy === r.id}
            onConfirm={() => void remove(r)}
          />
          {rowError?.id === r.id ? (
            <div style={{ color: 'var(--gt-danger)', fontSize: 11 }}>{rowError.msg}</div>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <Toolbar
        left={
          <SearchField
            placeholder="Search by name or muscle group…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
        right={
          <Button variant="primary" onClick={openCreate}>
            New exercise
          </Button>
        }
      />
      <DataTable columns={columns} rows={filtered} rowKey={(r) => r.id} />

      <Modal
        open={modalOpen}
        onClose={() => (saving ? undefined : setModalOpen(false))}
        title={editingId ? 'Edit exercise' : 'New exercise'}
        width={520}
        footer={
          <>
            <Button variant="ghost" disabled={saving} onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!editingId ? (
            <TextField
              label="Id (optional — auto-generated from name if blank)"
              value={form.id}
              onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
              disabled={saving}
            />
          ) : null}
          <TextField
            label="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            disabled={saving}
          />
          <TextField
            label="Muscle group"
            value={form.muscleGroup}
            onChange={(e) => setForm((f) => ({ ...f, muscleGroup: e.target.value }))}
            disabled={saving}
          />
          <div style={{ display: 'flex', gap: 12 }}>
            <TextField
              label="Equipment"
              value={form.equipment}
              onChange={(e) => setForm((f) => ({ ...f, equipment: e.target.value }))}
              disabled={saving}
              style={{ flex: 1 }}
            />
            <TextField
              label="Level"
              value={form.level}
              onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
              disabled={saving}
              style={{ flex: 1 }}
            />
            <TextField
              label="Category"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              disabled={saving}
              style={{ flex: 1 }}
            />
          </div>
          <LabeledTextarea
            label="Secondary muscles (one per line)"
            value={form.secondaryMuscles}
            onChange={(v) => setForm((f) => ({ ...f, secondaryMuscles: v }))}
            disabled={saving}
          />
          <LabeledTextarea
            label="Instructions (one step per line)"
            value={form.instructions}
            onChange={(v) => setForm((f) => ({ ...f, instructions: v }))}
            disabled={saving}
            rows={4}
          />
          <LabeledTextarea
            label="Image URLs (one per line)"
            value={form.imageUrls}
            onChange={(v) => setForm((f) => ({ ...f, imageUrls: v }))}
            disabled={saving}
          />
          {error ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div> : null}
        </div>
      </Modal>
    </>
  );
}

function LabeledTextarea({
  label,
  value,
  onChange,
  disabled,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  rows?: number;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span
        style={{
          fontSize: 12,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
          color: 'var(--gt-text-dim)',
          fontFamily: 'var(--font-heading)',
        }}
      >
        {label}
      </span>
      <textarea
        className="gt-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={rows}
        style={{ resize: 'vertical', fontFamily: 'var(--font-body, inherit)' }}
      />
    </label>
  );
}

// ── Plans ────────────────────────────────────────────────────────────────

interface PlanFormState {
  name: string;
  tierRequired: PlanTier;
  goalType: PlanGoal;
  weeks: string;
  daysPerWeek: string;
  description: string;
  isBranded: boolean;
}

const EMPTY_PLAN_FORM: PlanFormState = {
  name: '',
  tierRequired: 'starter',
  goalType: 'strength',
  weeks: '4',
  daysPerWeek: '3',
  description: '',
  isBranded: false,
};

function PlansTab({ plans }: { plans: PlanRow[] }) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<PlanFormState>(EMPTY_PLAN_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [structureFor, setStructureFor] = useState<PlanRow | null>(null);

  function openCreate() {
    setForm(EMPTY_PLAN_FORM);
    setError(null);
    setModalOpen(true);
  }

  async function create() {
    const weeks = Number(form.weeks);
    const daysPerWeek = Number(form.daysPerWeek);
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
      setError('Weeks must be a whole number between 1 and 52.');
      return;
    }
    if (!Number.isInteger(daysPerWeek) || daysPerWeek < 1 || daysPerWeek > 7) {
      setError('Days per week must be a whole number between 1 and 7.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/catalog/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: form.name.trim(),
          tierRequired: form.tierRequired,
          goalType: form.goalType,
          weeks,
          daysPerWeek,
          description: form.description.trim() || undefined,
          isBranded: form.isBranded,
        }),
      });
      if (!res.ok) {
        setError(res.status === 403 ? 'You are not allowed to manage the catalog.' : 'Could not create that plan.');
        setSaving(false);
        return;
      }
      setSaving(false);
      setModalOpen(false);
      router.refresh();
    } catch {
      setError('Network error.');
      setSaving(false);
    }
  }

  async function remove(row: PlanRow) {
    setRowBusy(row.id);
    try {
      const res = await fetch(`/api/admin/catalog/plans/${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) router.refresh();
      setRowBusy(null);
    } catch {
      setRowBusy(null);
    }
  }

  const columns: Column<PlanRow>[] = [
    { key: 'name', header: 'Name', render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
    { key: 'tier', header: 'Tier', width: 90, render: (r) => <Badge tone="info">{r.tierRequired}</Badge> },
    { key: 'goal', header: 'Goal', render: (r) => r.goalType.replace('_', ' ') },
    { key: 'weeks', header: 'Weeks', width: 70, align: 'right', render: (r) => r.weeks },
    { key: 'days', header: 'Days/wk', width: 80, align: 'right', render: (r) => r.daysPerWeek },
    { key: 'workouts', header: 'Workouts', width: 90, align: 'right', render: (r) => r.workoutCount },
    {
      key: 'branded',
      header: '',
      width: 90,
      render: (r) => (r.isBranded ? <Badge tone="positive">Branded</Badge> : null),
    },
    {
      key: 'actions',
      header: '',
      width: 190,
      align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm" onClick={() => setStructureFor(r)}>
            Structure
          </Button>
          <ConfirmButton
            label="Delete"
            confirmLabel="Confirm?"
            size="sm"
            busy={rowBusy === r.id}
            onConfirm={() => void remove(r)}
          />
        </div>
      ),
    },
  ];

  return (
    <>
      <Toolbar
        right={
          <Button variant="primary" onClick={openCreate}>
            New plan
          </Button>
        }
      />
      <DataTable columns={columns} rows={plans} rowKey={(r) => r.id} />

      <Modal
        open={modalOpen}
        onClose={() => (saving ? undefined : setModalOpen(false))}
        title="New plan"
        width={480}
        footer={
          <>
            <Button variant="ghost" disabled={saving} onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={() => void create()}>
              {saving ? 'Creating…' : 'Create plan'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TextField
            label="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            disabled={saving}
          />
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <span style={{ fontSize: 12, color: 'var(--gt-text-dim)', textTransform: 'uppercase' }}>
                Tier required
              </span>
              <select
                className="gt-input"
                value={form.tierRequired}
                onChange={(e) => setForm((f) => ({ ...f, tierRequired: e.target.value as PlanTier }))}
                disabled={saving}
              >
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <span style={{ fontSize: 12, color: 'var(--gt-text-dim)', textTransform: 'uppercase' }}>
                Goal
              </span>
              <select
                className="gt-input"
                value={form.goalType}
                onChange={(e) => setForm((f) => ({ ...f, goalType: e.target.value as PlanGoal }))}
                disabled={saving}
              >
                {GOALS.map((g) => (
                  <option key={g} value={g}>
                    {g.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <TextField
              label="Weeks"
              type="number"
              min={1}
              max={52}
              value={form.weeks}
              onChange={(e) => setForm((f) => ({ ...f, weeks: e.target.value }))}
              disabled={saving}
              style={{ flex: 1 }}
            />
            <TextField
              label="Days per week"
              type="number"
              min={1}
              max={7}
              value={form.daysPerWeek}
              onChange={(e) => setForm((f) => ({ ...f, daysPerWeek: e.target.value }))}
              disabled={saving}
              style={{ flex: 1 }}
            />
          </div>
          <LabeledTextarea
            label="Description"
            value={form.description}
            onChange={(v) => setForm((f) => ({ ...f, description: v }))}
            disabled={saving}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={form.isBranded}
              onChange={(e) => setForm((f) => ({ ...f, isBranded: e.target.checked }))}
              disabled={saving}
            />
            Branded (GM Method flagship plan)
          </label>
          {error ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div> : null}
        </div>
      </Modal>

      {structureFor ? (
        <PlanStructureDrawer plan={structureFor} onClose={() => setStructureFor(null)} />
      ) : null}
    </>
  );
}

/**
 * Whole-structure JSON editor for a plan's workouts/exercises (see the
 * PATCH .../plans/[id] route doc for why this is a full-replace, not a diff).
 * Loads the current structure on open, lets the admin edit the JSON
 * directly, and PATCHes the parsed array back.
 */
function PlanStructureDrawer({ plan, onClose }: { plan: PlanRow; onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/catalog/plans/${encodeURIComponent(plan.id)}`, {
          credentials: 'include',
        });
        if (!res.ok) {
          if (!cancelled) setError('Could not load the current structure.');
          return;
        }
        const data = (await res.json()) as {
          workouts: PlanWorkoutDetail[];
        };
        if (!cancelled) {
          setText(
            JSON.stringify(
              data.workouts.map((w) => ({
                week: w.week,
                day: w.day,
                name: w.name,
                exercises: w.exercises.map((e: PlanExerciseDetail) => ({
                  exerciseId: e.exerciseId,
                  position: e.position,
                  sets: e.sets,
                  repRange: e.repRange,
                  restSec: e.restSec,
                })),
              })),
              null,
              2,
            ),
          );
        }
      } catch {
        if (!cancelled) setError('Network error loading structure.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Load exactly once per plan opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  async function save() {
    let workouts: unknown;
    try {
      workouts = JSON.parse(text);
    } catch {
      setError('Invalid JSON.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/catalog/plans/${encodeURIComponent(plan.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ workouts }),
      });
      if (!res.ok) {
        const code = await parseErrorCode(res);
        setError(
          code === 'unknown_exercise'
            ? 'One or more exerciseId values do not exist in the catalog.'
            : 'Could not save — check the JSON shape.',
        );
        setSaving(false);
        return;
      }
      setSaving(false);
      onClose();
      router.refresh();
    } catch {
      setError('Network error.');
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Workout structure — ${plan.name}`} width={640}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Card style={{ padding: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
            One JSON array of workouts, each with `week`, `day`, `name`, and an `exercises` array of
            `{'{'}exerciseId, position, sets, repRange, restSec{'}'}`. Saving replaces the ENTIRE
            structure for this plan.
          </span>
        </Card>
        {loading ? (
          <div style={{ color: 'var(--gt-text-dim)', fontSize: 14 }}>Loading current structure…</div>
        ) : (
          <textarea
            className="gt-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={16}
            disabled={saving}
            style={{ fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
          />
        )}
        {error ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div> : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving || loading} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save structure'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
