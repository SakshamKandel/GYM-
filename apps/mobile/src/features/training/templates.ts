import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { nowIso } from '../../lib/dates';
import { uid } from '../../lib/id';
import { mmkvStorage } from '../../lib/mmkvStorage';
import { useAuth } from '../../state/auth';

/**
 * Custom workout templates — user-saved rotations that live next to the
 * catalog plans (loaded from Neon via the training catalog) on the Train tab.
 * Persisted locally so templates survive restarts and work fully offline.
 *
 * Templates are stored PER OWNER, so a shared phone never shows one member's
 * rotations to the next person to sign in. The two rules that matter:
 *
 *  - Signing out HIDES, it never deletes. A signed-out phone has no owner, not
 *    a different owner, so the account's shelf is simply not read. Sign back in
 *    and every template is exactly where it was. This is the whole point of the
 *    per-owner layout: templates work fully offline and exist nowhere else, so
 *    a silent session expiry must never be able to destroy them.
 *  - Templates saved with nobody signed in land on their own unowned shelf.
 *    They are never filed under whoever happened to be signed in last, and the
 *    next account to sign in claims them (`syncAccount`), which is also how an
 *    install from before this scoping keeps every template it already had.
 */

export interface CustomTemplateExercise {
  exerciseId: string;
  exerciseName: string;
  sets: number;
  repRange: string | null;
  restSec: number;
}

export interface CustomTemplate {
  id: string;
  name: string;
  createdAt: string; // ISO datetime
  exercises: CustomTemplateExercise[];
}

/**
 * Shelves keyed by account id, plus the one unowned shelf below. A key that
 * was never written reads as undefined, which every reader here handles.
 */
type TemplateShelves = Record<string, CustomTemplate[] | undefined>;

/**
 * Owner key for templates saved while signed out. Account ids are uuids, so the
 * '@' makes a collision with a real one impossible.
 */
const UNOWNED = '@unowned';

function ownerKey(accountId: string | null): string {
  return accountId ?? UNOWNED;
}

interface TemplatesStore {
  /** Every shelf on this device. Read one at a time, never merged on disk. */
  byOwner: TemplateShelves;

  /**
   * Hand the unowned shelf to `accountId` (see the rules above). No-op when
   * signed out or when there is nothing waiting, so it is safe to call on
   * every render pass.
   */
  syncAccount: (accountId: string | null) => void;
  /** Newest first, on the current owner's shelf. Blank names fall back. */
  saveTemplate: (name: string, exercises: CustomTemplateExercise[]) => CustomTemplate;
  renameTemplate: (id: string, name: string) => void;
  deleteTemplate: (id: string) => void;
}

/** The signed-in account id, or null when signed out. */
function currentAccountId(): string | null {
  return useAuth.getState().user?.id ?? null;
}

/** Stable empty result — a fresh [] per read would re-render on every tick. */
const NO_TEMPLATES: CustomTemplate[] = [];

/**
 * One shelf, by reference. Returning the stored array itself keeps the zustand
 * selector stable, so a read on its own never re-renders anything.
 */
function shelfFor(byOwner: TemplateShelves, accountId: string | null): CustomTemplate[] {
  return byOwner[ownerKey(accountId)] ?? NO_TEMPLATES;
}

/** Newest first. Returns an input by reference when the other side is empty. */
function mergeNewestFirst(a: CustomTemplate[], b: CustomTemplate[]): CustomTemplate[] {
  if (b.length === 0) return a;
  if (a.length === 0) return b;
  return [...a, ...b].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}

/** Shelves the current viewer can see: their own, plus anything unowned. */
function visibleKeys(accountId: string | null): string[] {
  return accountId === null ? [UNOWNED] : [accountId, UNOWNED];
}

/**
 * Apply `edit` to every shelf the viewer can see. `edit` returns its input by
 * reference when nothing matched, so untouched shelves keep their identity and
 * an edit to one list never re-renders another.
 */
function editVisible(
  byOwner: TemplateShelves,
  accountId: string | null,
  edit: (list: CustomTemplate[]) => CustomTemplate[],
): Partial<TemplatesStore> {
  const next = { ...byOwner };
  let changed = false;
  for (const key of visibleKeys(accountId)) {
    const list = next[key];
    if (list === undefined) continue;
    const edited = edit(list);
    if (edited === list) continue;
    next[key] = edited;
    changed = true;
  }
  return changed ? { byOwner: next } : {};
}

export const useTemplates = create<TemplatesStore>()(
  persist(
    (set, get) => ({
      byOwner: {},

      syncAccount: (accountId) => {
        // Signed out there is nobody to claim for, and the account's own shelf
        // stays on disk untouched — sign-out hides, it never deletes.
        if (accountId === null) return;
        const { byOwner } = get();
        const unowned = byOwner[UNOWNED];
        if (unowned === undefined || unowned.length === 0) return;
        const next = { ...byOwner, [accountId]: mergeNewestFirst(byOwner[accountId] ?? [], unowned) };
        delete next[UNOWNED];
        set({ byOwner: next });
      },

      saveTemplate: (name, exercises) => {
        const accountId = currentAccountId();
        // Claim first, so a template saved right after signing in joins the
        // same shelf as anything that was waiting unowned.
        get().syncAccount(accountId);
        const template: CustomTemplate = {
          id: uid(),
          name: name.trim() || 'My workout',
          createdAt: nowIso(),
          exercises,
        };
        const key = ownerKey(accountId);
        set((s) => ({ byOwner: { ...s.byOwner, [key]: [template, ...(s.byOwner[key] ?? [])] } }));
        return template;
      },

      renameTemplate: (id, name) =>
        set((s) =>
          editVisible(s.byOwner, currentAccountId(), (list) =>
            list.some((t) => t.id === id)
              ? list.map((t) => (t.id === id ? { ...t, name: name.trim() || t.name } : t))
              : list,
          ),
        ),

      deleteTemplate: (id) =>
        set((s) =>
          editVisible(s.byOwner, currentAccountId(), (list) => {
            const kept = list.filter((t) => t.id !== id);
            return kept.length === list.length ? list : kept;
          }),
        ),
    }),
    {
      name: 'gym-tracker-templates-v1',
      version: 2,
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (s) => ({ byOwner: s.byOwner }),
      migrate: (persisted) => migrateShelves(persisted),
    },
  ),
);

// ── Migration off the single flat list ───────────────────────────

interface LegacyPersisted {
  templates?: unknown;
  accountId?: unknown;
}

/** Structural check only: this data was written by us, never by the network. */
function isCustomTemplate(value: unknown): value is CustomTemplate {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Partial<CustomTemplate>;
  return (
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    typeof t.createdAt === 'string' &&
    Array.isArray(t.exercises)
  );
}

/**
 * Earlier installs held ONE flat list plus an optional account stamp. Move it
 * onto that account's shelf, or onto the unowned shelf when it was never
 * stamped, so an upgrading member keeps every template they had.
 */
function migrateShelves(persisted: unknown): { byOwner: TemplateShelves } {
  if (typeof persisted !== 'object' || persisted === null) return { byOwner: {} };
  const legacy = persisted as LegacyPersisted;
  const list = Array.isArray(legacy.templates) ? legacy.templates.filter(isCustomTemplate) : [];
  if (list.length === 0) return { byOwner: {} };
  const owner =
    typeof legacy.accountId === 'string' && legacy.accountId.length > 0
      ? legacy.accountId
      : UNOWNED;
  return { byOwner: { [owner]: list } };
}

/**
 * The signed-in account's templates, newest first. Their own shelf plus
 * anything still unowned, so the very first render after signing in is already
 * complete; the effect then folds the unowned shelf into theirs for good.
 */
export function useAccountTemplates(): CustomTemplate[] {
  const accountId = useAuth((s) => s.user?.id ?? null);
  const owned = useTemplates((s) => shelfFor(s.byOwner, accountId));
  const unowned = useTemplates((s) =>
    accountId === null ? NO_TEMPLATES : shelfFor(s.byOwner, null),
  );
  const templates = useMemo(() => mergeNewestFirst(owned, unowned), [owned, unowned]);

  useEffect(() => {
    useTemplates.getState().syncAccount(accountId);
  }, [accountId]);

  return templates;
}
