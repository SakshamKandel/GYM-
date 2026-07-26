'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  Card,
  type Column,
  ConfirmButton,
  DataTable,
  FilterPill,
  FilterPills,
  Modal,
  SearchField,
  TextField,
  Toolbar,
} from '@/components/console';
import { tierLabel } from '@/app/admin/_lib/tierLabel';
import type {
  ExerciseDetail,
  ExerciseRow,
  PlanExerciseDetail,
  PlanGoal,
  PlanRow,
  PlanTier,
  PlanWorkoutDetail,
} from './types';

const TIERS: PlanTier[] = ['starter', 'silver', 'gold', 'elite'];
const GOALS: PlanGoal[] = ['fat_loss', 'muscle', 'strength'];

/**
 * What a plan is for, in the words a member reads. The console was printing
 * `fat_loss` with the underscore swapped for a space, in a dropdown an admin
 * picks from and in a column they scan — the stored key leaking onto the screen
 * in both directions.
 */
const GOAL_LABEL: Record<PlanGoal, string> = {
  fat_loss: 'Fat loss',
  muscle: 'Muscle',
  strength: 'Strength',
};

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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Read the on-demand detail payload defensively: anything we don't recognise
 * reads as "not loaded", which keeps the edit form from saving a blank list
 * over real text.
 */
function parseExerciseDetail(data: unknown): ExerciseDetail | null {
  if (typeof data !== 'object' || data === null) return null;
  const exercise = (data as { exercise?: unknown }).exercise;
  if (typeof exercise !== 'object' || exercise === null) return null;
  const { secondaryMuscles, instructions, imageUrls } = exercise as Record<string, unknown>;
  if (!isStringArray(secondaryMuscles)) return null;
  if (!isStringArray(instructions)) return null;
  if (!isStringArray(imageUrls)) return null;
  return { secondaryMuscles, instructions, imageUrls };
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
      {/* The console's own segmented control: hover, pressed, focus and a 44px
          target all come from the shared pill rules, and the selected fill is
          the accent that actually passes contrast against its label — the
          hand-rolled version used the legacy `--gt-red` alias and a raw white. */}
      <div style={{ marginBottom: 16 }}>
        <FilterPills label="Which library to edit">
          <FilterPill selected={tab === 'exercises'} onClick={() => setTab('exercises')}>
            Exercises <Count>{exercises.length}</Count>
          </FilterPill>
          <FilterPill selected={tab === 'plans'} onClick={() => setTab('plans')}>
            Plans <Count>{plans.length}</Count>
          </FilterPill>
        </FilterPills>
      </div>

      {tab === 'exercises' ? <ExercisesTab exercises={exercises} /> : <PlansTab plans={plans} />}
    </div>
  );
}

/** Tabular count riding inside a pill label, so the two numbers line up
 * with each other instead of drifting with the proportional face. */
function Count({ children }: { children: React.ReactNode }) {
  return (
    <span className="gt-numeric" style={{ fontSize: 12, opacity: 0.75 }}>
      {children}
    </span>
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

/**
 * Where the edit form's on-demand fields have got to.
 *  - 'ready'   → nothing left to wait for (always the case when creating).
 *  - 'loading' → the textareas are still filling in; saving is held back.
 *  - 'error'   → they never arrived; saving stays held back rather than risk
 *                writing empty lists over the exercise's real text.
 */
type DetailStatus = 'ready' | 'loading' | 'error';

function ExercisesTab({ exercises }: { exercises: ExerciseRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ExerciseFormState>(EMPTY_EXERCISE_FORM);
  const [detailStatus, setDetailStatus] = useState<DetailStatus>('ready');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);
  // Bumped every time the form is opened, so a detail response for a row the
  // admin has already moved on from is dropped instead of landing in the form.
  const detailRequest = useRef(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return exercises;
    return exercises.filter(
      (e) => e.name.toLowerCase().includes(q) || e.muscleGroup.toLowerCase().includes(q),
    );
  }, [exercises, query]);

  function openCreate() {
    detailRequest.current += 1;
    setEditingId(null);
    setForm(EMPTY_EXERCISE_FORM);
    setDetailStatus('ready');
    setError(null);
    setModalOpen(true);
  }

  /**
   * Opens the form straight away on what the table row already holds, then
   * fills in the three long fields for this exercise. They are not in the row
   * on purpose (see types.ts) — the list would otherwise carry the whole
   * library's instruction text.
   */
  function openEdit(row: ExerciseRow) {
    const request = detailRequest.current + 1;
    detailRequest.current = request;
    setEditingId(row.id);
    setForm({
      id: row.id,
      name: row.name,
      muscleGroup: row.muscleGroup,
      equipment: row.equipment ?? '',
      level: row.level ?? '',
      category: row.category ?? '',
      secondaryMuscles: '',
      instructions: '',
      imageUrls: '',
    });
    setDetailStatus('loading');
    setError(null);
    setModalOpen(true);

    void (async () => {
      try {
        const res = await fetch(
          `/admin/catalog/exercise-detail?id=${encodeURIComponent(row.id)}`,
          { credentials: 'include' },
        );
        if (detailRequest.current !== request) return;
        const detail = res.ok ? parseExerciseDetail((await res.json()) as unknown) : null;
        if (detailRequest.current !== request) return;
        if (!detail) {
          setDetailStatus('error');
          return;
        }
        setForm((f) => ({
          ...f,
          secondaryMuscles: arrayToLines(detail.secondaryMuscles),
          instructions: arrayToLines(detail.instructions),
          imageUrls: arrayToLines(detail.imageUrls),
        }));
        setDetailStatus('ready');
      } catch {
        if (detailRequest.current !== request) return;
        setDetailStatus('error');
      }
    })();
  }

  async function save() {
    if (!form.name.trim() || !form.muscleGroup.trim()) {
      setError('Name and muscle group are required.');
      return;
    }
    // Belt and braces with the disabled Save button: the body below always
    // sends all three long fields, so saving before they arrive would clear
    // them.
    if (editingId && detailStatus !== 'ready') {
      setError(
        detailStatus === 'loading'
          ? 'Still opening this exercise. Give it a moment.'
          : 'We could not open the rest of this exercise, so it is not safe to save. Close this and try again.',
      );
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
      setError('Could not reach us just now. Try again.');
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
          msg: code === 'in_use' ? 'Still used by a plan. Remove it there first.' : 'Could not delete.',
        });
        setRowBusy(null);
        return;
      }
      setRowBusy(null);
      router.refresh();
    } catch {
      setRowError({ id: row.id, msg: 'Could not reach us just now. Try again.' });
      setRowBusy(null);
    }
  }

  const columns: Column<ExerciseRow>[] = [
    // The exercise name is what this library IS, so it carries the row.
    {
      key: 'name',
      header: 'Exercise',
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 14 }}>
            {r.name}
          </div>
          {rowError?.id === r.id ? (
            <div style={{ color: 'var(--gt-danger)', fontSize: 12, marginTop: 4 }}>
              {rowError.msg}
            </div>
          ) : null}
        </div>
      ),
    },
    { key: 'muscle', header: 'Muscle group', render: (r) => r.muscleGroup },
    {
      key: 'equipment',
      header: 'Equipment',
      render: (r) => r.equipment ?? <Unset>No kit listed</Unset>,
    },
    {
      key: 'level',
      header: 'Level',
      render: (r) => r.level ?? <Unset>Any</Unset>,
    },
    {
      key: 'used',
      header: 'Used by',
      width: 110,
      align: 'right',
      render: (r) =>
        r.usedByPlanCount === 0 ? (
          <Unset>No plans</Unset>
        ) : (
          <span className="gt-numeric">
            {r.usedByPlanCount} plan{r.usedByPlanCount === 1 ? '' : 's'}
          </span>
        ),
    },
    {
      key: 'actions',
      header: '',
      width: 170,
      align: 'right',
      render: (r) => (
        <div
          style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}
        >
          <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
            Edit
          </Button>
          <ConfirmButton
            label="Delete"
            confirmLabel="Delete for good?"
            size="sm"
            busy={rowBusy === r.id}
            onConfirm={() => void remove(r)}
          />
        </div>
      ),
    },
  ];

  // Editing waits for the on-demand fields; creating has nothing to wait for.
  const detailPending = editingId !== null && detailStatus !== 'ready';

  return (
    <>
      <Toolbar
        left={
          <SearchField
            placeholder="Name or muscle group"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search exercises"
          />
        }
        right={
          <Button variant="primary" onClick={openCreate}>
            New exercise
          </Button>
        }
      />
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        empty={
          query.trim() ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
              <span>No exercise matches “{query.trim()}”.</span>
              <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
                Clear search
              </Button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
              <span>The exercise library is empty.</span>
              <Button variant="ghost" size="sm" onClick={openCreate}>
                Add the first exercise
              </Button>
            </div>
          )
        }
      />

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
            <Button variant="primary" disabled={saving || detailPending} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!editingId ? (
            <TextField
              label="Id (optional, auto-generated from name if blank)"
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
            disabled={saving || detailPending}
          />
          <LabeledTextarea
            label="Instructions (one step per line)"
            value={form.instructions}
            onChange={(v) => setForm((f) => ({ ...f, instructions: v }))}
            disabled={saving || detailPending}
            rows={4}
          />
          <LabeledTextarea
            label="Image URLs (one per line)"
            value={form.imageUrls}
            onChange={(v) => setForm((f) => ({ ...f, imageUrls: v }))}
            disabled={saving || detailPending}
          />
          {detailPending ? (
            <div
              style={{
                color: detailStatus === 'error' ? 'var(--gt-danger)' : 'var(--gt-text-dim)',
                fontSize: 13,
              }}
            >
              {detailStatus === 'loading'
                ? 'Loading the rest of this exercise…'
                : 'We could not load the rest of this exercise. Close this and try again.'}
            </div>
          ) : null}
          {error ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div> : null}
        </div>
      </Modal>
    </>
  );
}

/**
 * A field the catalog was never told about. An em-dash in a column of real
 * values reads as a rendering accident; naming the absence says which of the
 * two it is, and stays quiet enough not to compete with the rows that do carry
 * a value.
 */
function Unset({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--gt-text-faint)' }}>{children}</span>;
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
      setError('Could not reach us just now. Try again.');
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
    {
      key: 'name',
      header: 'Plan',
      render: (r) => (
        <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 14 }}>
            {r.name}
          </span>
          {r.isBranded ? <Badge tone="positive">GM Method</Badge> : null}
        </div>
      ),
    },
    {
      key: 'tier',
      header: 'Tier',
      width: 100,
      render: (r) => <Badge tone="info">{tierLabel(r.tierRequired)}</Badge>,
    },
    { key: 'goal', header: 'Goal', render: (r) => GOAL_LABEL[r.goalType] ?? r.goalType },
    {
      key: 'weeks',
      header: 'Weeks',
      width: 80,
      align: 'right',
      render: (r) => <span className="gt-numeric">{r.weeks}</span>,
    },
    {
      key: 'days',
      header: 'Days a week',
      width: 110,
      align: 'right',
      render: (r) => <span className="gt-numeric">{r.daysPerWeek}</span>,
    },
    {
      key: 'workouts',
      header: 'Workouts',
      width: 100,
      align: 'right',
      render: (r) =>
        r.workoutCount === 0 ? (
          <Unset>None yet</Unset>
        ) : (
          <span className="gt-numeric">{r.workoutCount}</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      width: 210,
      align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm" onClick={() => setStructureFor(r)}>
            Workouts
          </Button>
          <ConfirmButton
            label="Delete"
            confirmLabel="Delete for good?"
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
                    {tierLabel(t)}
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
                    {GOAL_LABEL[g] ?? g}
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
        if (!cancelled) setError('Could not reach us just now, so the plan did not load. Try again.');
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
            : 'Could not save. Check the JSON shape.',
        );
        setSaving(false);
        return;
      }
      setSaving(false);
      onClose();
      router.refresh();
    } catch {
      setError('Could not reach us just now. Try again.');
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Workout structure · ${plan.name}`} width={640}>
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
