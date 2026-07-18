'use client';

import type { MealCurrency, MealDietType, MealGoalTag, MealWindow } from '@gym/shared';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Badge, Button, ConfirmButton, Drawer, EmptyState, Toolbar } from '@/components/console';
import type { PartnerMenuItem } from '../_data';
import { DIET_LABEL, formatMoney, windowShort } from '../_format';

/**
 * Menu CRUD for the partner portal. Create / edit / soft-delete menu items,
 * set per-slot availability, and attach an optional photo. Every write goes to
 * the /api/partner/meals routes, which scope by the caller's own partnerId — this
 * component never sends a partnerId. After each write we `router.refresh()` so
 * the server-rendered list reflects the change.
 */

const DAYS: { i: number; label: string }[] = [
  { i: 0, label: 'Sun' },
  { i: 1, label: 'Mon' },
  { i: 2, label: 'Tue' },
  { i: 3, label: 'Wed' },
  { i: 4, label: 'Thu' },
  { i: 5, label: 'Fri' },
  { i: 6, label: 'Sat' },
];
const WINDOWS: MealWindow[] = ['lunch', 'dinner'];
const GOALS: MealGoalTag[] = ['cutting', 'bulking', 'balanced'];

interface FormState {
  name: string;
  description: string;
  imageUrl: string | null;
  kcal: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
  fiberG: string;
  sugarG: string;
  dietType: MealDietType;
  goalTags: MealGoalTag[];
  priceMajor: string;
  currency: MealCurrency;
  isActive: boolean;
  sortOrder: string;
  availability: { dayOfWeek: number; window: MealWindow }[];
}

function blankForm(currency: MealCurrency): FormState {
  return {
    name: '',
    description: '',
    imageUrl: null,
    kcal: '',
    proteinG: '',
    carbsG: '',
    fatG: '',
    fiberG: '',
    sugarG: '',
    dietType: 'veg',
    goalTags: [],
    priceMajor: '',
    currency,
    isActive: true,
    sortOrder: '0',
    availability: [],
  };
}

function formFrom(item: PartnerMenuItem): FormState {
  return {
    name: item.name,
    description: item.description,
    imageUrl: item.imageUrl,
    kcal: String(item.kcal),
    proteinG: String(item.proteinG),
    carbsG: String(item.carbsG),
    fatG: String(item.fatG),
    fiberG: item.fiberG == null ? '' : String(item.fiberG),
    sugarG: item.sugarG == null ? '' : String(item.sugarG),
    dietType: item.dietType,
    goalTags: [...item.goalTags],
    priceMajor: (item.priceMinor / 100).toString(),
    currency: item.currency,
    isActive: item.isActive,
    sortOrder: String(item.sortOrder),
    availability: item.availability.map((a) => ({ ...a })),
  };
}

export function MenuManager({
  items,
  defaultCurrency,
}: {
  items: PartnerMenuItem[];
  defaultCurrency: MealCurrency;
}) {
  const [editing, setEditing] = useState<{ id: string | null; form: FormState } | null>(null);

  function openNew() {
    setEditing({ id: null, form: blankForm(defaultCurrency) });
  }
  function openEdit(item: PartnerMenuItem) {
    setEditing({ id: item.id, form: formFrom(item) });
  }

  return (
    <div>
      <Toolbar right={<Button variant="primary" onClick={openNew}>Add menu item</Button>}>
        <span style={{ color: 'var(--gt-text-dim)', fontSize: 14 }}>
          {items.length} item{items.length === 1 ? '' : 's'}
        </span>
      </Toolbar>

      {items.length === 0 ? (
        <EmptyState
          title="No menu items yet"
          description="Add your first dish so members can browse and order from your kitchen."
          action={<Button variant="primary" onClick={openNew}>Add menu item</Button>}
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 14,
            marginTop: 16,
          }}
        >
          {items.map((item) => (
            <MenuCard key={item.id} item={item} onEdit={() => openEdit(item)} />
          ))}
        </div>
      )}

      {editing ? (
        <MealFormDrawer
          key={editing.id ?? 'new'}
          mealId={editing.id}
          initial={editing.form}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function MenuCard({ item, onEdit }: { item: PartnerMenuItem; onEdit: () => void }) {
  const availabilityLabel =
    item.availability.length === 0
      ? 'Always available'
      : item.availability
          .map((a) => `${DAYS[a.dayOfWeek]?.label ?? a.dayOfWeek} ${windowShort(a.window)}`)
          .join(', ');

  return (
    <div className="gt-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.imageUrl}
          alt={item.name}
          style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 10 }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: 140,
            borderRadius: 10,
            background: 'var(--gt-surface-sunken)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--gt-text-faint)',
            fontSize: 13,
          }}
        >
          No photo
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <strong style={{ fontSize: 16 }}>{item.name}</strong>
        <strong style={{ whiteSpace: 'nowrap' }}>{formatMoney(item.priceMinor, item.currency)}</strong>
      </div>

      {item.description ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--gt-text-dim)' }}>{item.description}</p>
      ) : null}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Badge tone={item.isActive ? 'positive' : 'neutral'}>
          {item.isActive ? 'Active' : 'Hidden'}
        </Badge>
        <Badge tone="info">{DIET_LABEL[item.dietType] ?? item.dietType}</Badge>
        {item.goalTags.map((g) => (
          <Badge key={g} tone="neutral">
            {g}
          </Badge>
        ))}
      </div>

      <div style={{ fontSize: 12, color: 'var(--gt-text-faint)' }}>
        {item.kcal} kcal · P{item.proteinG} C{item.carbsG} F{item.fatG}
      </div>
      <div style={{ fontSize: 12, color: 'var(--gt-text-faint)' }}>{availabilityLabel}</div>

      <div style={{ marginTop: 'auto' }}>
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </div>
  );
}

function MealFormDrawer({
  mealId,
  initial,
  onClose,
}: {
  mealId: string | null;
  initial: FormState;
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleGoal(g: MealGoalTag) {
    setForm((f) => ({
      ...f,
      goalTags: f.goalTags.includes(g) ? f.goalTags.filter((x) => x !== g) : [...f.goalTags, g],
    }));
  }

  function hasSlot(day: number, window: MealWindow) {
    return form.availability.some((a) => a.dayOfWeek === day && a.window === window);
  }
  function toggleSlot(day: number, window: MealWindow) {
    setForm((f) => ({
      ...f,
      availability: hasSlot(day, window)
        ? f.availability.filter((a) => !(a.dayOfWeek === day && a.window === window))
        : [...f.availability, { dayOfWeek: day, window }],
    }));
  }

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const reserveRes = await fetch('/api/uploads/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ kind: 'meal_photo' }),
      });
      if (!reserveRes.ok) {
        setError('Could not start the photo upload. You can still save the item without a photo.');
        return;
      }
      const reservation = (await reserveRes.json()) as {
        uploadUrl: string;
        fields: Record<string, string>;
        deliveryUrl?: string;
      };
      if (!reservation.deliveryUrl) {
        setError('Photo upload is not configured for public delivery.');
        return;
      }
      const fd = new FormData();
      for (const [k, v] of Object.entries(reservation.fields)) fd.append(k, v);
      fd.append('file', file);
      const cloudRes = await fetch(reservation.uploadUrl, { method: 'POST', body: fd });
      if (!cloudRes.ok) {
        setError('Photo upload failed — try again.');
        return;
      }
      set('imageUrl', reservation.deliveryUrl);
    } catch {
      setError('Network error during photo upload.');
    } finally {
      setUploading(false);
    }
  }

  function toInt(s: string): number | null {
    const n = Number(s);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }

  async function save() {
    setError(null);

    const name = form.name.trim();
    if (!name) return setError('Name is required.');
    const kcal = toInt(form.kcal);
    const proteinG = toInt(form.proteinG);
    const carbsG = toInt(form.carbsG);
    const fatG = toInt(form.fatG);
    if (kcal == null || proteinG == null || carbsG == null || fatG == null) {
      return setError('Calories and macros must be whole non-negative numbers.');
    }
    const fiberG = form.fiberG.trim() === '' ? null : toInt(form.fiberG);
    const sugarG = form.sugarG.trim() === '' ? null : toInt(form.sugarG);
    if (form.fiberG.trim() !== '' && fiberG == null) return setError('Fiber must be a whole number.');
    if (form.sugarG.trim() !== '' && sugarG == null) return setError('Sugar must be a whole number.');
    const priceValue = Number(form.priceMajor);
    if (!Number.isFinite(priceValue) || priceValue < 0) return setError('Enter a valid price.');
    const priceMinor = Math.round(priceValue * 100);
    const sortOrder = toInt(form.sortOrder) ?? 0;

    const payload = {
      name,
      description: form.description.trim(),
      imageUrl: form.imageUrl,
      kcal,
      proteinG,
      carbsG,
      fatG,
      fiberG,
      sugarG,
      dietType: form.dietType,
      goalTags: form.goalTags,
      priceMinor,
      currency: form.currency,
      isActive: form.isActive,
      sortOrder,
    };

    setBusy(true);
    try {
      let id = mealId;
      const res = await fetch(
        mealId ? `/api/partner/meals/${encodeURIComponent(mealId)}` : '/api/partner/meals',
        {
          method: mealId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        setError('Could not save this item. Check the fields and try again.');
        setBusy(false);
        return;
      }
      if (!id) {
        const body = (await res.json()) as { meal: { id: string } };
        id = body.meal.id;
      }

      // Availability is a separate replace endpoint.
      const availRes = await fetch(
        `/api/partner/meals/${encodeURIComponent(id)}/availability`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ slots: form.availability }),
        },
      );
      if (!availRes.ok) {
        setError('Item saved, but availability could not be updated. Reopen to retry.');
        router.refresh();
        setBusy(false);
        return;
      }

      router.refresh();
      onClose();
    } catch {
      setError('Network error while saving.');
      setBusy(false);
    }
  }

  async function softDelete() {
    if (!mealId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/partner/meals/${encodeURIComponent(mealId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        setError('Could not remove this item.');
        setBusy(false);
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setError('Network error while removing.');
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={mealId ? 'Edit menu item' : 'New menu item'}
      width={480}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          {mealId ? (
            <ConfirmButton
              label="Remove"
              confirmLabel="Confirm remove"
              busyLabel="Removing…"
              busy={busy}
              onConfirm={() => void softDelete()}
            />
          ) : (
            <span />
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy || uploading}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Name">
          <input
            className="gt-input"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            maxLength={120}
          />
        </Field>

        <Field label="Description">
          <textarea
            className="gt-input"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
            maxLength={1000}
            style={{ resize: 'vertical' }}
          />
        </Field>

        <Field label="Photo">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {form.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.imageUrl}
                alt="Menu item"
                style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10 }}
              />
            ) : (
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 10,
                  background: 'var(--gt-surface-sunken)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--gt-text-faint)',
                  fontSize: 11,
                }}
              >
                None
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = '';
                }}
              />
              <Button size="sm" onClick={() => fileInput.current?.click()} disabled={uploading}>
                {uploading ? 'Uploading…' : form.imageUrl ? 'Replace photo' : 'Upload photo'}
              </Button>
              {form.imageUrl ? (
                <Button size="sm" onClick={() => set('imageUrl', null)} disabled={uploading}>
                  Remove photo
                </Button>
              ) : null}
            </div>
          </div>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label={`Price (${form.currency === 'NPR' ? 'Rs' : '$'})`}>
            <input
              className="gt-input"
              type="number"
              min={0}
              step="0.01"
              value={form.priceMajor}
              onChange={(e) => set('priceMajor', e.target.value)}
            />
          </Field>
          <Field label="Currency">
            <select
              className="gt-input"
              value={form.currency}
              onChange={(e) => set('currency', e.target.value as MealCurrency)}
            >
              <option value="NPR">NPR (Rs)</option>
              <option value="USD">USD ($)</option>
            </select>
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Calories (kcal)">
            <input className="gt-input" type="number" min={0} value={form.kcal} onChange={(e) => set('kcal', e.target.value)} />
          </Field>
          <Field label="Protein (g)">
            <input className="gt-input" type="number" min={0} value={form.proteinG} onChange={(e) => set('proteinG', e.target.value)} />
          </Field>
          <Field label="Carbs (g)">
            <input className="gt-input" type="number" min={0} value={form.carbsG} onChange={(e) => set('carbsG', e.target.value)} />
          </Field>
          <Field label="Fat (g)">
            <input className="gt-input" type="number" min={0} value={form.fatG} onChange={(e) => set('fatG', e.target.value)} />
          </Field>
          <Field label="Fiber (g) — optional">
            <input className="gt-input" type="number" min={0} value={form.fiberG} onChange={(e) => set('fiberG', e.target.value)} />
          </Field>
          <Field label="Sugar (g) — optional">
            <input className="gt-input" type="number" min={0} value={form.sugarG} onChange={(e) => set('sugarG', e.target.value)} />
          </Field>
        </div>

        <Field label="Diet type">
          <select
            className="gt-input"
            value={form.dietType}
            onChange={(e) => set('dietType', e.target.value as MealDietType)}
          >
            <option value="veg">Veg</option>
            <option value="non_veg">Non-veg</option>
            <option value="egg">Egg</option>
          </select>
        </Field>

        <Field label="Goal tags">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {GOALS.map((g) => (
              <label
                key={g}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 14,
                  textTransform: 'capitalize',
                }}
              >
                <input type="checkbox" checked={form.goalTags.includes(g)} onChange={() => toggleGoal(g)} />
                {g}
              </label>
            ))}
          </div>
        </Field>

        <Field label="Availability (leave all off = always available)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {DAYS.map((d) => (
              <div key={d.i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 36, fontSize: 13, color: 'var(--gt-text-dim)' }}>{d.label}</span>
                {WINDOWS.map((w) => (
                  <label key={w} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                    <input type="checkbox" checked={hasSlot(d.i, w)} onChange={() => toggleSlot(d.i, w)} />
                    {windowShort(w)}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'end' }}>
          <Field label="Sort order">
            <input className="gt-input" type="number" min={0} value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, paddingBottom: 10 }}>
            <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
            Active (visible to members)
          </label>
        </div>

        {error ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div> : null}
      </div>
    </Drawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--gt-text-dim)', fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}
