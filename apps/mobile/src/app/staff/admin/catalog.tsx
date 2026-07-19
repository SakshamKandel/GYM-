import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Chip,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Sheet,
  Tag,
} from '../../../components/ui';
import {
  listCatalogExercises,
  listCatalogPlans,
  toStaffError,
  upsertCatalogExercise,
  upsertCatalogPlan,
  type CatalogExerciseInput,
  type CatalogExerciseRow,
  type CatalogPlanInput,
  type CatalogPlanRow,
  type StaffErrorCode,
  type Tier,
} from '../../../features/staff/api';
import { replaceStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Catalog — exercise + training-plan library authoring
 * (ARCHITECTURE-REVIEW §6 NEXT, mobile parity B). Mirrors the web
 * CatalogManager's two tabs, minus its whole-structure JSON plan-workout
 * editor (a deliberate scope cut — building a workout/exercise builder on a
 * phone keyboard is its own project; add/patch of top-level plan fields is
 * still fully supported here). No delete: the client layer doesn't expose
 * one (catalog rows can be referenced by plans/workouts server-side).
 *
 * IMPORTANT — this table is NOT read by the shipped app yet (mobile sources
 * its exercise/plan library from bundled JSON); it's a staging/authoring
 * tool for a future catalog sync. The banner below says so plainly so an
 * admin doesn't wonder why an edit here didn't change what members see.
 *
 * Field-clear: `equipment` / `level` / `category` are nullable columns. This
 * screen tracks each field's ORIGINAL value so clearing a filled box to
 * empty sends an explicit `null` (clears the column), while leaving an
 * already-empty box alone omits the key entirely (no-op patch) — the same
 * distinction the API type documents. The array fields (secondary muscles /
 * instructions / image URLs) are always sent as a whole replacement list.
 */

type CatalogTab = 'exercises' | 'plans';

const SEARCH_DEBOUNCE_MS = 300;

const TIER_ORDER: Tier[] = ['starter', 'silver', 'gold', 'elite'];
const TIER_LABEL: Record<Tier, string> = {
  starter: 'Starter',
  silver: 'Silver',
  gold: 'Gold',
  elite: 'Elite',
};

type GoalType = 'fat_loss' | 'muscle' | 'strength';
const GOALS: { key: GoalType; label: string }[] = [
  { key: 'fat_loss', label: 'Fat loss' },
  { key: 'muscle', label: 'Muscle' },
  { key: 'strength', label: 'Strength' },
];

function errorLine(code: StaffErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired — sign in again.';
    case 'forbidden':
      return "You don't have permission to manage the catalog.";
    case 'conflict':
      return 'That id is already in use — try another.';
    case 'invalid':
      return 'Some details were rejected. Check the fields and try again.';
    case 'not_found':
      return 'That row no longer exists.';
    default:
      return "Couldn't reach the server. Check your connection and retry.";
  }
}

function linesToArray(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
function arrayToLines(arr: string[]): string {
  return arr.join('\n');
}

/**
 * Blank-vs-clear resolution for a nullable string column: a non-empty box
 * always sends its trimmed value; an emptied box sends `null` ONLY when the
 * field actually held a value before (an explicit clear) — an already-blank
 * box on create/edit sends `undefined` so the key is dropped from the body
 * (PATCH semantics: undefined = leave unchanged, never a no-op `null`).
 */
function clearableField(
  value: string,
  original: string | null | undefined,
): string | null | undefined {
  const trimmed = value.trim();
  if (trimmed !== '') return trimmed;
  return original == null ? undefined : null;
}

function RetryLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Retry"
      onPress={onRetry}
      style={styles.retry}
    >
      <Ionicons name="refresh" size={15} color={colors.textDim} />
      <AppText variant="caption">{message} Tap to retry.</AppText>
    </PressableScale>
  );
}

function NotSyncedBanner() {
  return (
    <View style={styles.banner}>
      <Ionicons name="information-circle-outline" size={18} color={colors.textDim} />
      <AppText variant="caption" color={colors.textDim} style={styles.bannerText}>
        Staging only — the app still reads its exercise/plan library from the bundled catalog.
        Edits here don’t change what members see yet.
      </AppText>
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Exercises tab
// ════════════════════════════════════════════════════════════════

interface ExerciseFormState {
  slug: string;
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
  slug: '',
  name: '',
  muscleGroup: '',
  equipment: '',
  level: '',
  category: '',
  secondaryMuscles: '',
  instructions: '',
  imageUrls: '',
};

function ExerciseCard({
  exercise,
  index,
  onPress,
}: {
  exercise: CatalogExerciseRow;
  index: number;
  onPress: () => void;
}) {
  return (
    <Animated.View entering={enterUp(index)}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Edit ${exercise.name}`}
        onPress={onPress}
        style={styles.card}
      >
        <View style={styles.cardTitle}>
          <AppText variant="bodyBold" numberOfLines={1}>
            {exercise.name}
          </AppText>
          <AppText variant="caption" numberOfLines={1}>
            {exercise.muscleGroup}
            {exercise.equipment ? ` · ${exercise.equipment}` : ''}
            {exercise.level ? ` · ${exercise.level}` : ''}
          </AppText>
        </View>
        <View style={styles.cardRight}>
          <Tag
            label={`${exercise.usedByPlanCount} plan${exercise.usedByPlanCount === 1 ? '' : 's'}`}
            variant="dim"
          />
          <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
        </View>
      </PressableScale>
    </Animated.View>
  );
}

function ExerciseSheet({
  visible,
  editing,
  token,
  onClose,
  onSaved,
}: {
  visible: boolean;
  editing: CatalogExerciseRow | null;
  token: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<ExerciseFormState>(EMPTY_EXERCISE_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setForm(
      editing
        ? {
            slug: editing.id,
            name: editing.name,
            muscleGroup: editing.muscleGroup,
            equipment: editing.equipment ?? '',
            level: editing.level ?? '',
            category: editing.category ?? '',
            secondaryMuscles: arrayToLines(editing.secondaryMuscles),
            instructions: arrayToLines(editing.instructions),
            imageUrls: arrayToLines(editing.imageUrls),
          }
        : EMPTY_EXERCISE_FORM,
    );
  }, [visible, editing]);

  async function submit(): Promise<void> {
    if (saving) return;
    const name = form.name.trim();
    const muscleGroup = form.muscleGroup.trim();
    if (!name || !muscleGroup) {
      setError('Name and muscle group are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input: CatalogExerciseInput = editing
        ? {
            id: editing.id,
            name,
            muscleGroup,
            equipment: clearableField(form.equipment, editing.equipment),
            level: clearableField(form.level, editing.level),
            category: clearableField(form.category, editing.category),
            secondaryMuscles: linesToArray(form.secondaryMuscles),
            instructions: linesToArray(form.instructions),
            imageUrls: linesToArray(form.imageUrls),
          }
        : {
            ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
            name,
            muscleGroup,
            equipment: form.equipment.trim() || undefined,
            level: form.level.trim() || undefined,
            category: form.category.trim() || undefined,
            secondaryMuscles: linesToArray(form.secondaryMuscles),
            instructions: linesToArray(form.instructions),
            imageUrls: linesToArray(form.imageUrls),
          };
      await upsertCatalogExercise(input, token);
      setSaving(false);
      onClose();
      await onSaved();
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={saving ? () => undefined : onClose} title={editing ? 'Edit exercise' : 'New exercise'}>
      <View style={styles.sheetBody}>
        {!editing ? (
          <AppTextInput
            value={form.slug}
            onChangeText={(t) => setForm((f) => ({ ...f, slug: t }))}
            placeholder="Id (optional — generated from name if blank)"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!saving}
            accessibilityLabel="Exercise id"
          />
        ) : null}
        <AppTextInput
          value={form.name}
          onChangeText={(t) => setForm((f) => ({ ...f, name: t }))}
          placeholder="Name"
          editable={!saving}
          accessibilityLabel="Exercise name"
        />
        <AppTextInput
          value={form.muscleGroup}
          onChangeText={(t) => setForm((f) => ({ ...f, muscleGroup: t }))}
          placeholder="Muscle group"
          editable={!saving}
          accessibilityLabel="Muscle group"
        />
        <AppTextInput
          value={form.equipment}
          onChangeText={(t) => setForm((f) => ({ ...f, equipment: t }))}
          placeholder="Equipment (optional)"
          editable={!saving}
          accessibilityLabel="Equipment"
        />
        <AppTextInput
          value={form.level}
          onChangeText={(t) => setForm((f) => ({ ...f, level: t }))}
          placeholder="Level (optional)"
          editable={!saving}
          accessibilityLabel="Level"
        />
        <AppTextInput
          value={form.category}
          onChangeText={(t) => setForm((f) => ({ ...f, category: t }))}
          placeholder="Category (optional)"
          editable={!saving}
          accessibilityLabel="Category"
        />
        <AppText variant="label">Secondary muscles (one per line)</AppText>
        <AppTextInput
          value={form.secondaryMuscles}
          onChangeText={(t) => setForm((f) => ({ ...f, secondaryMuscles: t }))}
          multiline
          numberOfLines={3}
          style={styles.multiline}
          editable={!saving}
          accessibilityLabel="Secondary muscles"
        />
        <AppText variant="label">Instructions (one step per line)</AppText>
        <AppTextInput
          value={form.instructions}
          onChangeText={(t) => setForm((f) => ({ ...f, instructions: t }))}
          multiline
          numberOfLines={4}
          style={styles.multiline}
          editable={!saving}
          accessibilityLabel="Instructions"
        />
        <AppText variant="label">Image URLs (one per line)</AppText>
        <AppTextInput
          value={form.imageUrls}
          onChangeText={(t) => setForm((f) => ({ ...f, imageUrls: t }))}
          multiline
          numberOfLines={3}
          style={styles.multiline}
          editable={!saving}
          accessibilityLabel="Image URLs"
        />
        {error ? (
          <AppText variant="caption" color={colors.error}>
            {error}
          </AppText>
        ) : null}
        <View style={styles.sheetActions}>
          <Button label="Cancel" variant="secondary" disabled={saving} onPress={onClose} style={styles.sheetBtn} />
          <Button
            label={saving ? 'Saving…' : 'Save'}
            loading={saving}
            disabled={saving}
            onPress={() => void submit()}
            style={styles.sheetBtn}
          />
        </View>
      </View>
    </Sheet>
  );
}

function ExercisesTab({ token }: { token: string }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<CatalogExerciseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogExerciseRow | null>(null);
  const reqSeq = useRef(0);

  const load = useCallback(
    async (q: string) => {
      const reqId = ++reqSeq.current;
      setLoading(true);
      setError(null);
      try {
        const list = await listCatalogExercises(token, { q, limit: 100 });
        if (reqId !== reqSeq.current) return;
        setRows(list);
      } catch (err) {
        if (reqId !== reqSeq.current) return;
        setError(errorLine(toStaffError(err).code));
      } finally {
        if (reqId === reqSeq.current) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    const handle = setTimeout(() => void load(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <View style={styles.tabBody}>
      <View style={styles.searchRow}>
        <AppTextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name or muscle group"
          style={styles.searchInput}
          accessibilityLabel="Search exercises"
        />
        <Button label="New" onPress={() => { setEditing(null); setSheetOpen(true); }} style={styles.newBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.retryWrap}>
          <RetryLine message={error} onRetry={() => void load(query)} />
        </View>
      ) : rows.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.empty}>
          No exercises match — try a different search, or add one.
        </AppText>
      ) : (
        rows.map((row, i) => (
          <ExerciseCard
            key={row.id}
            exercise={row}
            index={i}
            onPress={() => {
              setEditing(row);
              setSheetOpen(true);
            }}
          />
        ))
      )}

      <ExerciseSheet
        visible={sheetOpen}
        editing={editing}
        token={token}
        onClose={() => setSheetOpen(false)}
        onSaved={() => load(query)}
      />
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Plans tab
// ════════════════════════════════════════════════════════════════

interface PlanFormState {
  name: string;
  tierRequired: Tier;
  goalType: GoalType;
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

function PlanCard({ plan, index, onPress }: { plan: CatalogPlanRow; index: number; onPress: () => void }) {
  return (
    <Animated.View entering={enterUp(index)}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Edit ${plan.name}`}
        onPress={onPress}
        style={styles.card}
      >
        <View style={styles.cardTitle}>
          <AppText variant="bodyBold" numberOfLines={1}>
            {plan.name}
          </AppText>
          <View style={styles.tagRow}>
            <Tag label={TIER_LABEL[plan.tierRequired]} variant="outline" />
            <Tag label={plan.goalType.replace('_', ' ')} variant="dim" />
            {plan.isBranded ? <Tag label="Branded" variant="filled" color={colors.success} /> : null}
          </View>
          <AppText variant="caption" color={colors.textFaint}>
            {plan.weeks}w · {plan.daysPerWeek}d/wk · {plan.workoutCount} workout
            {plan.workoutCount === 1 ? '' : 's'}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
      </PressableScale>
    </Animated.View>
  );
}

function PlanSheet({
  visible,
  editing,
  token,
  onClose,
  onSaved,
}: {
  visible: boolean;
  editing: CatalogPlanRow | null;
  token: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<PlanFormState>(EMPTY_PLAN_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setForm(
      editing
        ? {
            name: editing.name,
            tierRequired: editing.tierRequired,
            goalType: editing.goalType as GoalType,
            weeks: String(editing.weeks),
            daysPerWeek: String(editing.daysPerWeek),
            description: editing.description ?? '',
            isBranded: editing.isBranded,
          }
        : EMPTY_PLAN_FORM,
    );
  }, [visible, editing]);

  async function submit(): Promise<void> {
    if (saving) return;
    const name = form.name.trim();
    const weeks = Number(form.weeks);
    const daysPerWeek = Number(form.daysPerWeek);
    if (!name) {
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
      const input: CatalogPlanInput = {
        ...(editing ? { id: editing.id } : {}),
        name,
        tierRequired: form.tierRequired,
        goalType: form.goalType,
        weeks,
        daysPerWeek,
        description: form.description.trim(),
        isBranded: form.isBranded,
      };
      await upsertCatalogPlan(input, token);
      setSaving(false);
      onClose();
      await onSaved();
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={saving ? () => undefined : onClose} title={editing ? 'Edit plan' : 'New plan'}>
      <View style={styles.sheetBody}>
        <AppTextInput
          value={form.name}
          onChangeText={(t) => setForm((f) => ({ ...f, name: t }))}
          placeholder="Name"
          editable={!saving}
          accessibilityLabel="Plan name"
        />

        <AppText variant="label">Tier required</AppText>
        <View style={styles.chipRow}>
          {TIER_ORDER.map((t) => (
            <Chip
              key={t}
              label={TIER_LABEL[t]}
              selected={t === form.tierRequired}
              onPress={() => !saving && setForm((f) => ({ ...f, tierRequired: t }))}
            />
          ))}
        </View>

        <AppText variant="label">Goal</AppText>
        <View style={styles.chipRow}>
          {GOALS.map((g) => (
            <Chip
              key={g.key}
              label={g.label}
              selected={g.key === form.goalType}
              onPress={() => !saving && setForm((f) => ({ ...f, goalType: g.key }))}
            />
          ))}
        </View>

        <View style={styles.rowFields}>
          <AppTextInput
            value={form.weeks}
            onChangeText={(t) => setForm((f) => ({ ...f, weeks: t }))}
            placeholder="Weeks"
            keyboardType="number-pad"
            editable={!saving}
            style={styles.rowField}
            accessibilityLabel="Weeks"
          />
          <AppTextInput
            value={form.daysPerWeek}
            onChangeText={(t) => setForm((f) => ({ ...f, daysPerWeek: t }))}
            placeholder="Days/week"
            keyboardType="number-pad"
            editable={!saving}
            style={styles.rowField}
            accessibilityLabel="Days per week"
          />
        </View>

        <AppTextInput
          value={form.description}
          onChangeText={(t) => setForm((f) => ({ ...f, description: t }))}
          placeholder="Description (optional)"
          multiline
          numberOfLines={3}
          style={styles.multiline}
          editable={!saving}
          accessibilityLabel="Description"
        />

        <PressableScale
          accessibilityRole="switch"
          accessibilityState={{ checked: form.isBranded }}
          accessibilityLabel="Branded plan"
          onPress={() => !saving && setForm((f) => ({ ...f, isBranded: !f.isBranded }))}
          style={styles.brandedRow}
        >
          <AppText variant="body">Branded (GM Method flagship plan)</AppText>
          <View style={[styles.switchTrack, form.isBranded && styles.switchOn]} />
        </PressableScale>

        {editing ? (
          <AppText variant="caption" color={colors.textFaint}>
            Workout structure isn’t editable from the app yet — use the web console for that.
          </AppText>
        ) : null}

        {error ? (
          <AppText variant="caption" color={colors.error}>
            {error}
          </AppText>
        ) : null}
        <View style={styles.sheetActions}>
          <Button label="Cancel" variant="secondary" disabled={saving} onPress={onClose} style={styles.sheetBtn} />
          <Button
            label={saving ? 'Saving…' : 'Save'}
            loading={saving}
            disabled={saving}
            onPress={() => void submit()}
            style={styles.sheetBtn}
          />
        </View>
      </View>
    </Sheet>
  );
}

function PlansTab({ token }: { token: string }) {
  const [rows, setRows] = useState<CatalogPlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogPlanRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listCatalogPlans(token));
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.tabBody}>
      <View style={styles.searchRow}>
        <View style={styles.searchInput} />
        <Button label="New" onPress={() => { setEditing(null); setSheetOpen(true); }} style={styles.newBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.retryWrap}>
          <RetryLine message={error} onRetry={() => void load()} />
        </View>
      ) : rows.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.empty}>
          No plans yet — add the first one.
        </AppText>
      ) : (
        rows.map((row, i) => (
          <PlanCard
            key={row.id}
            plan={row}
            index={i}
            onPress={() => {
              setEditing(row);
              setSheetOpen(true);
            }}
          />
        ))
      )}

      <PlanSheet
        visible={sheetOpen}
        editing={editing}
        token={token}
        onClose={() => setSheetOpen(false)}
        onSaved={load}
      />
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Screen
// ════════════════════════════════════════════════════════════════

export default function AdminCatalogScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = staffCan(staffPermissions, 'catalog.manage');
  const [tab, setTab] = useState<CatalogTab>('exercises');

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replaceStaff(STAFF_ROUTES.adminHome);
  }

  if (!allowed || !token) {
    return (
      <Screen>
        <BackRow onBack={goBack} />
        <Animated.View entering={enterUp(0)} style={styles.locked}>
          <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textFaint}>
            Only a catalog admin, main admin or super admin can author the catalog.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen scroll keyboardAware>
      <BackRow onBack={goBack} />
      <NotSyncedBanner />

      <View style={styles.chipRow}>
        <Chip label="Exercises" selected={tab === 'exercises'} onPress={() => setTab('exercises')} />
        <Chip label="Plans" selected={tab === 'plans'} onPress={() => setTab('plans')} />
      </View>

      {tab === 'exercises' ? <ExercisesTab token={token} /> : <PlansTab token={token} />}
    </Screen>
  );
}

function BackRow({ onBack }: { onBack: () => void }) {
  return (
    <>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>
      <ScreenHeader eyebrow="Admin console" title="Catalog" style={styles.header} />
    </>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.md },
  locked: {
    marginTop: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: { flex: 1 },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tabBody: { gap: spacing.md },
  searchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  searchInput: { flex: 1 },
  newBtn: { paddingHorizontal: spacing.lg },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  retryWrap: { marginTop: spacing.sm },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  empty: { paddingVertical: spacing.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },
  cardTitle: { flex: 1, gap: spacing.xs },
  cardRight: { alignItems: 'center', gap: spacing.xs, flexDirection: 'row' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  sheetBody: { gap: spacing.md, paddingBottom: spacing.md },
  multiline: { minHeight: 84, paddingTop: spacing.md, textAlignVertical: 'top' },
  rowFields: { flexDirection: 'row', gap: spacing.sm },
  rowField: { flex: 1 },
  brandedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: touch.min,
  },
  switchTrack: {
    width: 44,
    height: 26,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  switchOn: { backgroundColor: colors.accent },
  sheetActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  sheetBtn: { flex: 1 },
});
