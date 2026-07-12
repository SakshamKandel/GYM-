import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Chip,
  ConfirmDialog,
  enterUp,
  EmptyState,
  PressableScale,
  SectionLabel,
  Sheet,
  Tag,
} from '../../components/ui';
import { successHaptic } from '../../lib/haptics';
import {
  createClientDietPlan,
  deleteClientDietPlan,
  getClientDietPlans,
  MEAL_KINDS,
  toStaffError,
  updateClientDietPlan,
  type ClientDietPlan,
  type DietPlanItem,
  type DietPlanMealInput,
  type MealKind,
  type StaffErrorCode,
} from './api';

/**
 * Coach console · client screen — "Diet plan" (SCALE-UP-PLAN §4.3 / §5.2). A
 * coach builds one or more meal-based diet plans for an assigned client; the
 * client sees the ACTIVE ones (read-only) on their Food tab's "Coach diet
 * plan" card.
 *
 * The editor always works across the 4 fixed meal groups (breakfast / lunch /
 * dinner / snacks) — a meal selector chip row picks which group the quick-add
 * form feeds; only groups that end up with at least one item are sent to the
 * server (an empty group is simply omitted, not stored as a blank row).
 */

const MEAL_LABEL: Record<MealKind, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snacks: 'Snacks',
};

type ItemDraft = DietPlanItem & { key: string };
type MealDrafts = Record<MealKind, ItemDraft[]>;

function emptyMealDrafts(): MealDrafts {
  return { breakfast: [], lunch: [], dinner: [], snacks: [] };
}

let draftKeySeed = 0;
function nextKey(): string {
  draftKeySeed += 1;
  return `diet_draft_${draftKeySeed}`;
}

function errorLine(code: StaffErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired — sign in again.';
    case 'forbidden':
      return 'This client is no longer assigned to you.';
    case 'not_found':
      return 'That diet plan no longer exists.';
    case 'invalid':
      return 'That change was rejected. Check the details and retry.';
    default:
      return "Couldn't reach the server. Check your connection and retry.";
  }
}

/**
 * '' → undefined; otherwise a finite number clamped to [0, max] (and rounded
 * to an integer when `integer` is set). The diet-plans route's zod schema
 * requires kcal to be an int 0..5000 and protein/carbs/fat to be 0..500
 * (apps/web/src/app/api/coach/clients/[userId]/diet-plans/route.ts) — clamping
 * here guarantees the value we send is always one the server accepts, instead
 * of letting a decimal-pad "250.5" or a 6-digit "999999" reach the server and
 * 400 the whole plan save.
 */
function parseMacroNumber(raw: string, max: number, integer: boolean): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n)) return undefined;
  const clamped = Math.min(Math.max(n, 0), max);
  return integer ? Math.round(clamped) : clamped;
}

/** "3 meals · 9 items" / "1 meal · 2 items". */
function planSummary(plan: ClientDietPlan): string {
  const mealCount = plan.meals.length;
  const itemCount = plan.meals.reduce((sum, m) => sum + m.items.length, 0);
  return `${mealCount} meal${mealCount === 1 ? '' : 's'} · ${itemCount} item${itemCount === 1 ? '' : 's'}`;
}

export function DietPlanSection({ userId, token }: { userId: string; token: string | null }) {
  const [plans, setPlans] = useState<ClientDietPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClientDietPlan | null>(null);

  // ── Sheet (create/edit) ───────────────────────────────────────
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<ClientDietPlan | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [mealDrafts, setMealDrafts] = useState<MealDrafts>(emptyMealDrafts());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Food quick-add sub-form ───────────────────────────────────
  const [activeMeal, setActiveMeal] = useState<MealKind>('breakfast');
  const [foodName, setFoodName] = useState('');
  const [foodQty, setFoodQty] = useState('');
  const [foodKcal, setFoodKcal] = useState('');
  const [foodProtein, setFoodProtein] = useState('');
  const [foodCarbs, setFoodCarbs] = useState('');
  const [foodFat, setFoodFat] = useState('');
  const [foodNote, setFoodNote] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setPlans(await getClientDietPlans(userId, token));
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
    } finally {
      setLoading(false);
    }
  }, [token, userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; load() owns its own loading/error state.
    void load();
  }, [load]);

  const activePlans = useMemo(() => plans.filter((p) => p.status === 'active'), [plans]);
  const archivedPlans = useMemo(() => plans.filter((p) => p.status === 'archived'), [plans]);

  function resetFoodForm() {
    setFoodName('');
    setFoodQty('');
    setFoodKcal('');
    setFoodProtein('');
    setFoodCarbs('');
    setFoodFat('');
    setFoodNote('');
  }

  function openCreateSheet() {
    setEditing(null);
    setTitle('');
    setNotes('');
    setMealDrafts(emptyMealDrafts());
    setActiveMeal('breakfast');
    resetFoodForm();
    setFormError(null);
    setSheetOpen(true);
  }

  function openEditSheet(plan: ClientDietPlan) {
    setEditing(plan);
    setTitle(plan.title);
    setNotes(plan.notes);
    const drafts = emptyMealDrafts();
    for (const m of plan.meals) {
      drafts[m.meal] = m.items.map((it) => ({ ...it, key: nextKey() }));
    }
    setMealDrafts(drafts);
    setActiveMeal('breakfast');
    resetFoodForm();
    setFormError(null);
    setSheetOpen(true);
  }

  const canAddFood =
    foodName.trim().length > 0 &&
    foodName.trim().length <= 80 &&
    foodQty.trim().length > 0 &&
    foodQty.trim().length <= 40 &&
    mealDrafts[activeMeal].length < 12;

  function addFoodItem() {
    if (!canAddFood) return;
    const item: ItemDraft = {
      key: nextKey(),
      name: foodName.trim(),
      qty: foodQty.trim(),
      kcal: parseMacroNumber(foodKcal, 5000, true),
      protein: parseMacroNumber(foodProtein, 500, false),
      carbs: parseMacroNumber(foodCarbs, 500, false),
      fat: parseMacroNumber(foodFat, 500, false),
      note: foodNote.trim() || undefined,
    };
    setMealDrafts((prev) => ({ ...prev, [activeMeal]: [...prev[activeMeal], item] }));
    resetFoodForm();
  }

  function removeFoodItem(meal: MealKind, key: string) {
    setMealDrafts((prev) => ({ ...prev, [meal]: prev[meal].filter((it) => it.key !== key) }));
  }

  const save = useCallback(async () => {
    const trimmedTitle = title.trim();
    const meals: DietPlanMealInput[] = MEAL_KINDS.filter((m) => mealDrafts[m].length > 0).map(
      (m) => ({
        meal: m,
        items: mealDrafts[m].map(({ key: _key, ...rest }) => rest),
      }),
    );
    if (!token || !trimmedTitle || meals.length === 0 || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await updateClientDietPlan(editing.id, { title: trimmedTitle, notes: notes.trim(), meals }, token);
      } else {
        await createClientDietPlan(userId, { title: trimmedTitle, notes: notes.trim(), meals }, token);
      }
      successHaptic();
      setSheetOpen(false);
      await load();
    } catch (err) {
      setFormError(errorLine(toStaffError(err).code));
    } finally {
      setSaving(false);
    }
  }, [token, title, notes, mealDrafts, editing, userId, saving, load]);

  const toggleArchive = useCallback(
    async (plan: ClientDietPlan) => {
      if (!token || busyId) return;
      setBusyId(plan.id);
      try {
        await updateClientDietPlan(
          plan.id,
          { status: plan.status === 'active' ? 'archived' : 'active' },
          token,
        );
        await load();
      } catch (err) {
        setMutationError(errorLine(toStaffError(err).code));
      } finally {
        setBusyId(null);
      }
    },
    [token, busyId, load],
  );

  const confirmDelete = useCallback(async () => {
    if (!token || !deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setBusyId(target.id);
    try {
      await deleteClientDietPlan(target.id, token);
      await load();
    } catch (err) {
      setMutationError(errorLine(toStaffError(err).code));
    } finally {
      setBusyId(null);
    }
  }, [token, deleteTarget, load]);

  const totalMealItems = MEAL_KINDS.reduce((sum, m) => sum + mealDrafts[m].length, 0);

  function renderPlanCard(plan: ClientDietPlan, index: number, archivedRow: boolean) {
    const busy = busyId === plan.id;
    return (
      <Animated.View entering={enterUp(index)} key={plan.id}>
        <View style={[styles.card, archivedRow && styles.cardMuted]}>
          <View style={styles.cardTop}>
            <View style={styles.cardTitle}>
              <AppText variant="bodyBold" numberOfLines={2}>
                {plan.title}
              </AppText>
              <AppText variant="caption" color={colors.textDim}>
                {planSummary(plan)}
              </AppText>
            </View>
            {archivedRow ? <Tag label="Archived" variant="dim" /> : null}
          </View>

          <View style={styles.cardActions}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Edit ${plan.title}`}
              disabled={busy}
              onPress={() => openEditSheet(plan)}
              style={[styles.action, busy && styles.actionDisabled]}
            >
              <Ionicons name="create-outline" size={16} color={colors.text} />
              <AppText variant="caption" color={colors.text}>
                Edit
              </AppText>
            </PressableScale>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={archivedRow ? `Restore ${plan.title}` : `Archive ${plan.title}`}
              disabled={busy}
              onPress={() => void toggleArchive(plan)}
              style={[styles.action, busy && styles.actionDisabled]}
            >
              <Ionicons
                name={archivedRow ? 'arrow-undo-outline' : 'archive-outline'}
                size={16}
                color={colors.text}
              />
              <AppText variant="caption" color={colors.text}>
                {archivedRow ? 'Restore' : 'Archive'}
              </AppText>
            </PressableScale>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Delete ${plan.title}`}
              disabled={busy}
              onPress={() => setDeleteTarget(plan)}
              style={[styles.action, busy && styles.actionDisabled]}
            >
              <Ionicons name="trash-outline" size={16} color={colors.error} />
              <AppText variant="caption" color={colors.error}>
                Delete
              </AppText>
            </PressableScale>
          </View>
        </View>
      </Animated.View>
    );
  }

  return (
    <>
      <SectionLabel>Diet plan</SectionLabel>

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Retry loading diet plans"
          onPress={() => void load()}
          style={styles.centre}
        >
          <AppText variant="caption" color={colors.textDim}>
            {error} · tap to retry
          </AppText>
        </PressableScale>
      ) : plans.length === 0 ? (
        <EmptyState
          icon="restaurant-outline"
          title="No diet plan yet"
          body="Build the client's first meal plan below."
        />
      ) : (
        <>
          {activePlans.map((p, i) => renderPlanCard(p, i, false))}
          {archivedPlans.map((p, i) => renderPlanCard(p, i, true))}
        </>
      )}

      <Button label="Add diet plan" variant="secondary" onPress={openCreateSheet} style={styles.addBtn} />

      <Sheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editing ? 'Edit diet plan' : 'New diet plan'}
      >
        <AppTextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Title — e.g. Cutting phase"
          maxLength={120}
          accessibilityLabel="Diet plan title"
          style={styles.sheetInput}
        />
        <AppTextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Notes (optional)"
          maxLength={1000}
          multiline
          style={[styles.sheetInput, styles.notesInput]}
          accessibilityLabel="Diet plan notes"
        />

        <View style={styles.mealChipRow}>
          {MEAL_KINDS.map((m) => (
            <Chip
              key={m}
              label={`${MEAL_LABEL[m]}${mealDrafts[m].length ? ` (${mealDrafts[m].length})` : ''}`}
              selected={activeMeal === m}
              onPress={() => setActiveMeal(m)}
            />
          ))}
        </View>

        {mealDrafts[activeMeal].length === 0 ? (
          <AppText variant="caption" color={colors.textFaint} style={styles.mealEmptyText}>
            No items in {MEAL_LABEL[activeMeal].toLowerCase()} yet.
          </AppText>
        ) : (
          mealDrafts[activeMeal].map((it) => (
            <View key={it.key} style={styles.itemRow}>
              <View style={styles.itemText}>
                <AppText variant="bodyBold" numberOfLines={1}>
                  {it.name}
                </AppText>
                <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
                  {it.qty}
                  {it.kcal !== undefined ? ` · ${it.kcal} kcal` : ''}
                </AppText>
              </View>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Remove ${it.name}`}
                onPress={() => removeFoodItem(activeMeal, it.key)}
                style={styles.itemIconBtn}
              >
                <Ionicons name="close" size={18} color={colors.textDim} />
              </PressableScale>
            </View>
          ))
        )}

        {mealDrafts[activeMeal].length < 12 ? (
          <View style={styles.addItemForm}>
            <AppText variant="label">Add to {MEAL_LABEL[activeMeal].toLowerCase()}</AppText>
            <View style={styles.foodRow}>
              <AppTextInput
                value={foodName}
                onChangeText={setFoodName}
                placeholder="Food — e.g. Chicken breast"
                maxLength={80}
                accessibilityLabel="Food name"
                style={[styles.sheetInput, styles.foodNameInput]}
              />
              <AppTextInput
                value={foodQty}
                onChangeText={setFoodQty}
                placeholder="Qty — e.g. 200g"
                maxLength={40}
                accessibilityLabel="Quantity"
                style={[styles.sheetInput, styles.foodQtyInput]}
              />
            </View>
            <View style={styles.macroRow}>
              <AppTextInput
                value={foodKcal}
                onChangeText={setFoodKcal}
                placeholder="kcal"
                keyboardType="decimal-pad"
                maxLength={6}
                accessibilityLabel="Calories (optional)"
                style={[styles.sheetInput, styles.macroInput]}
              />
              <AppTextInput
                value={foodProtein}
                onChangeText={setFoodProtein}
                placeholder="protein g"
                keyboardType="decimal-pad"
                maxLength={5}
                accessibilityLabel="Protein grams (optional)"
                style={[styles.sheetInput, styles.macroInput]}
              />
              <AppTextInput
                value={foodCarbs}
                onChangeText={setFoodCarbs}
                placeholder="carbs g"
                keyboardType="decimal-pad"
                maxLength={5}
                accessibilityLabel="Carbs grams (optional)"
                style={[styles.sheetInput, styles.macroInput]}
              />
              <AppTextInput
                value={foodFat}
                onChangeText={setFoodFat}
                placeholder="fat g"
                keyboardType="decimal-pad"
                maxLength={5}
                accessibilityLabel="Fat grams (optional)"
                style={[styles.sheetInput, styles.macroInput]}
              />
            </View>
            <AppTextInput
              value={foodNote}
              onChangeText={setFoodNote}
              placeholder="Note (optional)"
              maxLength={200}
              accessibilityLabel="Food note (optional)"
              style={styles.sheetInput}
            />
            <Button label="Add item" variant="secondary" disabled={!canAddFood} onPress={addFoodItem} />
          </View>
        ) : (
          <AppText variant="caption" color={colors.textFaint} style={styles.mealEmptyText}>
            {MEAL_LABEL[activeMeal]} is full (12 items max).
          </AppText>
        )}

        {formError ? (
          <AppText variant="caption" color={colors.error} style={styles.formErrorText}>
            {formError}
          </AppText>
        ) : null}

        <Button
          label={saving ? 'Saving…' : editing ? 'Save changes' : 'Assign diet plan'}
          onPress={() => void save()}
          loading={saving}
          disabled={saving || !title.trim() || totalMealItems === 0}
          style={styles.saveBtn}
        />
      </Sheet>

      <ConfirmDialog
        visible={deleteTarget !== null}
        title="Delete diet plan?"
        message={
          deleteTarget
            ? `"${deleteTarget.title}" will be permanently removed from this client.`
            : undefined
        }
        confirmLabel="Delete"
        cancelLabel="Keep"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        visible={mutationError !== null}
        title="Couldn't save"
        message={mutationError ?? undefined}
        confirmLabel="OK"
        hideCancel
        onConfirm={() => setMutationError(null)}
        onCancel={() => setMutationError(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  centre: { paddingVertical: spacing.xl, alignItems: 'center' },
  addBtn: { marginTop: spacing.sm, marginBottom: spacing.xl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  cardMuted: { opacity: 0.6 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { flex: 1, gap: 3 },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touch.min,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  actionDisabled: { opacity: 0.35 },
  sheetInput: { marginBottom: spacing.md },
  notesInput: { minHeight: 64, paddingTop: 16, textAlignVertical: 'top' },
  mealChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  mealEmptyText: { marginBottom: spacing.md },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  itemText: { flex: 1, gap: 2 },
  itemIconBtn: {
    width: touch.min,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addItemForm: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  foodRow: { flexDirection: 'row', gap: spacing.sm },
  foodNameInput: { flex: 2 },
  foodQtyInput: { flex: 1 },
  macroRow: { flexDirection: 'row', gap: spacing.sm },
  macroInput: { flex: 1, paddingHorizontal: spacing.sm },
  formErrorText: { marginTop: spacing.sm },
  saveBtn: { marginTop: spacing.md },
});
