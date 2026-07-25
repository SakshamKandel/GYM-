'use client';

import type { MealCurrency, MealDietType, MealGoalTag, MealWindow } from '@gym/shared';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Badge, Button, ConfirmButton, Drawer, EmptyState, Toolbar } from '@/components/console';
import type { PartnerMenuItem } from '../_data';
import { DIET_LABEL, formatMoney, windowShort } from '../_format';
import styles from './menu.module.css';

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

/** One (weekday, window) availability slot — the unit both grids toggle. */
interface Slot {
  dayOfWeek: number;
  window: MealWindow;
}

function slotKey(dayOfWeek: number, window: MealWindow): string {
  return `${dayOfWeek}|${window}`;
}

function slotLabel(slot: Slot): string {
  return `${DAYS[slot.dayOfWeek]?.label ?? slot.dayOfWeek} ${windowShort(slot.window)}`;
}

/**
 * Card summary for the sold-out flags. Named by WEEKDAY on purpose: the flag is
 * stored per (weekday, window), so it applies to that day every week and calling
 * it "today" would be a lie.
 */
function soldOutSummary(slots: Slot[]): string {
  if (slots.length > 3) return `Sold out on ${slots.length} slots`;
  return `Sold out: ${slots.map(slotLabel).join(', ')}`;
}

function fixedSubscriptionBlockCount(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  if (!('error' in value) || value.error !== 'fixed_subscription_in_use') return null;
  if (!('subscriptionCount' in value) || typeof value.subscriptionCount !== 'number') return null;
  return value.subscriptionCount;
}

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
  availability: Slot[];
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
  const [editing, setEditing] = useState<{
    id: string | null;
    form: FormState;
    /** Live sold-out flags, kept beside the form: they save instantly, not on Save. */
    soldOut: Slot[];
  } | null>(null);

  function openNew() {
    setEditing({ id: null, form: blankForm(defaultCurrency), soldOut: [] });
  }
  function openEdit(item: PartnerMenuItem) {
    setEditing({
      id: item.id,
      form: formFrom(item),
      soldOut: item.soldOutSlots.map((s) => ({ ...s })),
    });
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
        <div className={styles.menuGrid}>
          {items.map((item) => (
            <MenuCard key={item.id} item={item} onEdit={() => openEdit(item)} />
          ))}
        </div>
      )}

      {editing ? (
        <MealFormDrawer
          key={editing.id ?? 'new'}
          mealId={editing.id}
          accountCurrency={defaultCurrency}
          initial={editing.form}
          initialSoldOut={editing.soldOut}
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
    <div className={`gt-card ${styles.menuCard}`}>
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.imageUrl} alt={item.name} className={styles.menuPhoto} loading="lazy" />
      ) : (
        <div className={styles.menuPhotoFallback}>
          <span className={styles.menuPhotoInitial} aria-hidden>
            {item.name.trim().charAt(0).toUpperCase() || '?'}
          </span>
          No photo yet
        </div>
      )}

      <div className={styles.menuNameRow}>
        <strong className={styles.menuName}>{item.name}</strong>
        <span className={styles.pricePill}>{formatMoney(item.priceMinor, item.currency)}</span>
      </div>

      {item.description ? <p className={styles.menuDescription}>{item.description}</p> : null}

      <div className={styles.badgeRow}>
        <Badge tone={item.isActive ? 'positive' : 'neutral'}>
          {item.isActive ? 'Active' : 'Hidden'}
        </Badge>
        {item.soldOutSlots.length > 0 ? (
          <Badge tone="warning">{soldOutSummary(item.soldOutSlots)}</Badge>
        ) : null}
        <Badge tone="info">{DIET_LABEL[item.dietType] ?? item.dietType}</Badge>
        {item.goalTags.map((g) => (
          <Badge key={g} tone="neutral">
            {g}
          </Badge>
        ))}
      </div>

      <div className={styles.macroRow}>
        <span className={styles.macroChip}>{item.kcal} kcal</span>
        <span className={styles.macroChip}>P {item.proteinG}</span>
        <span className={styles.macroChip}>C {item.carbsG}</span>
        <span className={styles.macroChip}>F {item.fatG}</span>
      </div>

      <div className={styles.availabilityLine}>
        <span className={styles.availabilityDot} aria-hidden />
        {availabilityLabel}
      </div>

      <div className={styles.menuFooter}>
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </div>
  );
}

function MealFormDrawer({
  mealId,
  accountCurrency,
  initial,
  initialSoldOut,
  onClose,
}: {
  mealId: string | null;
  accountCurrency: MealCurrency;
  initial: FormState;
  initialSoldOut: Slot[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initial);
  // Sold-out is NOT part of the form: it is a live "we ran out" flag with its
  // own PATCH, so it saves the moment it is switched instead of waiting for
  // Save. Kept here so the grid can render both states side by side.
  const [soldOut, setSoldOut] = useState<Slot[]>(initialSoldOut);
  const [soldOutBusy, setSoldOutBusy] = useState<string | null>(null);
  // Once a create succeeds we adopt the new id here so a retry (e.g. after the
  // availability sub-write fails) PATCHes the same row instead of inserting a
  // duplicate (P0-15).
  const [currentId, setCurrentId] = useState<string | null>(mealId);
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

  function isSoldOut(day: number, window: MealWindow) {
    return soldOut.some((s) => s.dayOfWeek === day && s.window === window);
  }

  /**
   * Flip one slot's sold-out flag. Optimistic, then reverted if the write is
   * refused, so the grid never shows a state the kitchen isn't actually in.
   * `slot_not_available` means the slot only exists in the unsaved form, which
   * is the one case worth naming to the partner.
   */
  async function toggleSoldOut(dayOfWeek: number, window: MealWindow, next: boolean) {
    if (!currentId) return;
    const key = slotKey(dayOfWeek, window);
    const previousSoldOut = soldOut;
    const previousAvailability = form.availability;
    setSoldOutBusy(key);
    setError(null);
    setSoldOut((list) =>
      next
        ? [...list, { dayOfWeek, window }]
        : list.filter((s) => !(s.dayOfWeek === dayOfWeek && s.window === window)),
    );
    // A dish with no schedule is "always available", so there is no slot row to
    // flag. The write fills the whole 7x2 grid in that case (same availability,
    // spelled out), so mirror it here or a later Save would wipe the grid back
    // to empty and take the flag with it.
    if (next && previousAvailability.length === 0) {
      setForm((f) => ({
        ...f,
        availability: DAYS.flatMap((d) => WINDOWS.map((w) => ({ dayOfWeek: d.i, window: w }))),
      }));
    }

    function revert() {
      setSoldOut(previousSoldOut);
      setForm((f) => ({ ...f, availability: previousAvailability }));
    }

    try {
      const res = await fetch(
        `/api/partner/meals/${encodeURIComponent(currentId)}/availability`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ dayOfWeek, window, soldOut: next }),
        },
      );
      if (!res.ok) {
        revert();
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          body.error === 'slot_not_available'
            ? 'Save this item first, then you can mark that slot sold out.'
            : 'Could not change that slot. Try again in a moment.',
        );
        return;
      }
      router.refresh();
    } catch {
      revert();
      setError('Could not save that change. Check your connection and try again.');
    } finally {
      setSoldOutBusy(null);
    }
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
        setError('Photo upload failed. Try again.');
        return;
      }
      set('imageUrl', reservation.deliveryUrl);
    } catch {
      setError('Could not reach us just now, so the photo did not upload. Try again.');
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
    if (form.priceMajor.trim() === '') return setError('Price is required.');
    const priceValue = Number(form.priceMajor);
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      return setError('Enter a price greater than 0.');
    }
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
      // Currency is fixed to the restaurant's account currency — a mismatch is
      // rejected server-side and corrupts revenue rollups (P0-15).
      currency: accountCurrency,
      isActive: form.isActive,
      sortOrder,
    };

    setBusy(true);
    try {
      let id = currentId;
      const res = await fetch(
        currentId ? `/api/partner/meals/${encodeURIComponent(currentId)}` : '/api/partner/meals',
        {
          method: currentId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; expected?: string };
        setError(
          body.error === 'currency_mismatch'
            ? `This item's currency must match your restaurant (${body.expected ?? accountCurrency}).`
            : 'Could not save this item. Check the fields and try again.',
        );
        setBusy(false);
        return;
      }
      if (!id) {
        const body = (await res.json()) as { meal: { id: string } };
        id = body.meal.id;
        setCurrentId(id);
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
      setError('Could not reach us just now, so nothing was saved. Try again.');
      setBusy(false);
    }
  }

  async function softDelete() {
    if (!currentId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/partner/meals/${encodeURIComponent(currentId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        let blockerCount: number | null = null;
        try {
          blockerCount = fixedSubscriptionBlockCount((await res.json()) as unknown);
        } catch {
          // Keep the generic fallback for a proxy/non-JSON response.
        }
        if (blockerCount !== null) {
          setError(
            `${blockerCount} active or paused fixed ${blockerCount === 1 ? 'plan still uses' : 'plans still use'} this meal. ` +
              'Keep it temporarily unavailable, or ask affected members to edit their plan before removing it.',
          );
          setBusy(false);
          return;
        }
        setError('Could not remove this item.');
        setBusy(false);
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setError('Could not reach us just now, so nothing was removed. Try again.');
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={currentId ? 'Edit menu item' : 'New menu item'}
      width={480}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          {currentId ? (
            <ConfirmButton
              label="Remove from menu"
              confirmLabel="Permanently remove"
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
          <Field label={`Price (${accountCurrency === 'NPR' ? 'Rs' : '$'})`}>
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
            {/* Fixed to the restaurant's account currency — mixing currencies
                corrupts revenue rollups, so it isn't editable per item. */}
            <input
              className="gt-input"
              value={accountCurrency === 'NPR' ? 'NPR (Rs)' : 'USD ($)'}
              readOnly
              disabled
              aria-label="Currency (fixed to your restaurant)"
            />
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
          <Field label="Fiber (g), optional">
            <input className="gt-input" type="number" min={0} value={form.fiberG} onChange={(e) => set('fiberG', e.target.value)} />
          </Field>
          <Field label="Sugar (g), optional">
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {DAYS.map((d) => (
              <div
                key={d.i}
                style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
              >
                <span style={{ width: 36, fontSize: 13, color: 'var(--gt-text-dim)' }}>{d.label}</span>
                {WINDOWS.map((w) => (
                  <div key={w} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                      <input type="checkbox" checked={hasSlot(d.i, w)} onChange={() => toggleSlot(d.i, w)} />
                      {windowShort(w)}
                    </label>
                    {/* Sold out needs a saved item to write against. A dish with
                        no schedule at all is on the menu every slot, so it can
                        be flagged too. */}
                    {currentId && (hasSlot(d.i, w) || form.availability.length === 0) ? (
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 12,
                          color: isSoldOut(d.i, w) ? 'var(--gt-warning)' : 'var(--gt-text-dim)',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSoldOut(d.i, w)}
                          disabled={busy || soldOutBusy === slotKey(d.i, w)}
                          aria-label={`Sold out on ${d.label} ${windowShort(w)}`}
                          onChange={(e) => void toggleSoldOut(d.i, w, e.target.checked)}
                        />
                        Sold out
                      </label>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <span style={{ fontSize: 12, color: 'var(--gt-text-dim)', marginTop: 2 }}>
            Sold out saves straight away and takes that dish off the menu for that weekday every
            week, until you switch it back on.
            {currentId ? '' : ' Save the item first to use it.'}
          </span>
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
