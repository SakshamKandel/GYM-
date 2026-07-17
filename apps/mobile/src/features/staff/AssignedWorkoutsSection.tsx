import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Exercise } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  ConfirmDialog,
  enterUp,
  EmptyState,
  PressableScale,
  SectionLabel,
  Sheet,
  Stepper,
  Tag,
} from '../../components/ui';
import { reserveImageUpload, toApiError, uploadImageAsset } from '../../lib/api/client';
import { searchExercises } from '../../lib/exercises';
import { successHaptic } from '../../lib/haptics';
import {
  createClientWorkout,
  deleteClientWorkout,
  getClientWorkouts,
  toStaffError,
  updateClientWorkout,
  type ClientWorkout,
  type StaffErrorCode,
  type WorkoutItemInput,
} from './api';

/**
 * Coach console · client screen — "Assigned workouts" (SCALE-UP-PLAN §4.3 /
 * §5.2). A coach builds one or more exercise programs for an assigned client
 * (e.g. "Push day A", "Pull day B"); the client sees the ACTIVE ones on their
 * Train tab's "From your coach" section.
 *
 * Item entries come from either the bundled 873-exercise library
 * (searchExercises) or a free-text custom name with an optional photo
 * (uploaded via POST /api/uploads/image {kind:'custom_exercise'}). Every
 * mutation reloads the list so this stays a thin, always-fresh mirror of the
 * server.
 */

type ItemDraft = WorkoutItemInput & { key: string };

let draftKeySeed = 0;
function nextKey(): string {
  draftKeySeed += 1;
  return `draft_${draftKeySeed}`;
}

function errorLine(code: StaffErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired — sign in again.';
    case 'forbidden':
      return 'This client is no longer assigned to you.';
    case 'not_found':
      return 'That workout no longer exists.';
    case 'invalid':
      return 'That change was rejected. Check the details and retry.';
    default:
      return "Couldn't reach the server. Check your connection and retry.";
  }
}

/** "6 exercises" / "1 exercise". */
function itemCountLabel(n: number): string {
  return `${n} exercise${n === 1 ? '' : 's'}`;
}

export function AssignedWorkoutsSection({
  userId,
  token,
}: {
  userId: string;
  token: string | null;
}) {
  const [workouts, setWorkouts] = useState<ClientWorkout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClientWorkout | null>(null);

  // ── Sheet (create/edit) ───────────────────────────────────────
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<ClientWorkout | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Item quick-add sub-form ───────────────────────────────────
  const [query, setQuery] = useState('');
  const [pickedExercise, setPickedExercise] = useState<Exercise | null>(null);
  const [customName, setCustomName] = useState('');
  const [sets, setSets] = useState(3);
  const [repRange, setRepRange] = useState('8-12');
  const [restSec, setRestSec] = useState(90);
  const [itemImageUrl, setItemImageUrl] = useState<string | undefined>(undefined);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setWorkouts(await getClientWorkouts(userId, token));
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

  const active = useMemo(
    () => [...workouts].filter((w) => w.status === 'active').sort((a, b) => a.position - b.position),
    [workouts],
  );
  const archived = useMemo(
    () => [...workouts].filter((w) => w.status === 'archived'),
    [workouts],
  );

  const repRangeValid = /^\d{1,3}(-\d{1,3})?$/.test(repRange.trim());
  const resolvedName = pickedExercise?.name ?? customName.trim();
  const canAddItem = resolvedName.length > 0 && resolvedName.length <= 80 && repRangeValid;

  function resetPicker() {
    setQuery('');
    setPickedExercise(null);
    setCustomName('');
    setItemImageUrl(undefined);
    setImageError(null);
    // sets/repRange/restSec stay sticky — coaches usually add several
    // exercises in a row that share the same scheme.
  }

  function openCreateSheet() {
    setEditing(null);
    setTitle('');
    setNotes('');
    setItems([]);
    resetPicker();
    setSets(3);
    setRepRange('8-12');
    setRestSec(90);
    setFormError(null);
    setSheetOpen(true);
  }

  function openEditSheet(w: ClientWorkout) {
    setEditing(w);
    setTitle(w.title);
    setNotes(w.notes);
    setItems(w.items.map((it) => ({ ...it, key: nextKey() })));
    resetPicker();
    setFormError(null);
    setSheetOpen(true);
  }

  const suggestions = useMemo(() => {
    const q = query.trim();
    if (!q || pickedExercise) return [];
    return searchExercises({ query: q }).slice(0, 6);
  }, [query, pickedExercise]);

  async function pickCustomPhoto() {
    if (!token || imageUploading) return;
    setImageError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setImageError('Allow photo library access in Settings to add a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;

    setImageUploading(true);
    try {
      const reservation = await reserveImageUpload(token, 'custom_exercise');
      if (!reservation.deliveryUrl) throw new Error('missing_delivery_url');
      const ext = /\.(\w{2,4})$/.exec(asset.uri)?.[1] ?? 'jpg';
      await uploadImageAsset(reservation, {
        uri: asset.uri,
        name: asset.fileName ?? `exercise.${ext}`,
        type: asset.mimeType ?? 'image/jpeg',
      });
      setItemImageUrl(reservation.deliveryUrl);
    } catch (err) {
      const e = toApiError(err);
      setImageError(
        e.code === 'image_not_configured'
          ? 'Photo uploads are not set up yet.'
          : "Couldn't upload that photo. Try again.",
      );
    } finally {
      setImageUploading(false);
    }
  }

  function addItem() {
    if (!canAddItem) return;
    const item: ItemDraft = {
      key: nextKey(),
      exerciseId: pickedExercise?.id ?? null,
      name: resolvedName,
      sets,
      repRange: repRange.trim(),
      restSec,
      imageUrl: itemImageUrl ?? pickedExercise?.imageUrls[0],
    };
    setItems((prev) => [...prev, item]);
    resetPicker();
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  function moveItem(key: string, dir: -1 | 1) {
    setItems((prev) => {
      const i = prev.findIndex((it) => it.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[i]!;
      next[i] = next[j]!;
      next[j] = tmp;
      return next;
    });
  }

  const save = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (!token || !trimmedTitle || items.length === 0 || saving) return;
    setSaving(true);
    setFormError(null);
    const payloadItems: WorkoutItemInput[] = items.map(({ key: _key, ...rest }) => rest);
    try {
      if (editing) {
        await updateClientWorkout(
          editing.id,
          { title: trimmedTitle, notes: notes.trim(), items: payloadItems },
          token,
        );
      } else {
        await createClientWorkout(
          userId,
          { title: trimmedTitle, notes: notes.trim(), items: payloadItems },
          token,
        );
      }
      successHaptic();
      setSheetOpen(false);
      await load();
    } catch (err) {
      setFormError(errorLine(toStaffError(err).code));
    } finally {
      setSaving(false);
    }
  }, [token, title, notes, items, editing, userId, saving, load]);

  const toggleArchive = useCallback(
    async (w: ClientWorkout) => {
      if (!token || busyId) return;
      setBusyId(w.id);
      try {
        await updateClientWorkout(w.id, { status: w.status === 'active' ? 'archived' : 'active' }, token);
        await load();
      } catch (err) {
        setMutationError(errorLine(toStaffError(err).code));
      } finally {
        setBusyId(null);
      }
    },
    [token, busyId, load],
  );

  const move = useCallback(
    async (w: ClientWorkout, dir: -1 | 1) => {
      if (!token || busyId) return;
      const idx = active.findIndex((a) => a.id === w.id);
      const neighbor = active[idx + dir];
      if (!neighbor) return;
      setBusyId(w.id);
      try {
        // Sequential, not Promise.all: a swap is two independent PATCHes (no
        // atomic reorder endpoint exists), so if the second one fails we must
        // roll the first back — otherwise a partial swap leaves two rows
        // sharing (or duplicating) a position.
        await updateClientWorkout(w.id, { position: neighbor.position }, token);
        try {
          await updateClientWorkout(neighbor.id, { position: w.position }, token);
        } catch (err) {
          await updateClientWorkout(w.id, { position: w.position }, token).catch(() => {
            // Best-effort rollback — a reload still shows the true server state.
          });
          throw err;
        }
        await load();
      } catch (err) {
        setMutationError(errorLine(toStaffError(err).code));
        // Refresh regardless so any partial/rolled-back state is reconciled
        // with what the server actually has, rather than trusting local state.
        await load();
      } finally {
        setBusyId(null);
      }
    },
    [token, busyId, active, load],
  );

  const confirmDelete = useCallback(async () => {
    if (!token || !deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setBusyId(target.id);
    try {
      await deleteClientWorkout(target.id, token);
      await load();
    } catch (err) {
      setMutationError(errorLine(toStaffError(err).code));
    } finally {
      setBusyId(null);
    }
  }, [token, deleteTarget, load]);

  function renderCard(w: ClientWorkout, index: number, archivedRow: boolean) {
    const busy = busyId === w.id;
    return (
      <Animated.View entering={enterUp(index)} key={w.id}>
        <View style={[styles.card, archivedRow && styles.cardMuted]}>
          <View style={styles.cardTop}>
            <View style={styles.cardTitle}>
              <AppText variant="bodyBold" numberOfLines={2}>
                {w.title}
              </AppText>
              <AppText variant="caption" color={colors.textDim}>
                {itemCountLabel(w.items.length)}
              </AppText>
            </View>
            {archivedRow ? <Tag label="Archived" variant="dim" /> : null}
          </View>

          <View style={styles.cardActions}>
            {archivedRow ? null : (
              <>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${w.title} up`}
                  disabled={busy || active[0]?.id === w.id}
                  onPress={() => void move(w, -1)}
                  style={[styles.iconAction, (busy || active[0]?.id === w.id) && styles.actionDisabled]}
                >
                  <Ionicons name="chevron-up" size={16} color={colors.text} />
                </PressableScale>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${w.title} down`}
                  disabled={busy || active[active.length - 1]?.id === w.id}
                  onPress={() => void move(w, 1)}
                  style={[
                    styles.iconAction,
                    (busy || active[active.length - 1]?.id === w.id) && styles.actionDisabled,
                  ]}
                >
                  <Ionicons name="chevron-down" size={16} color={colors.text} />
                </PressableScale>
              </>
            )}
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Edit ${w.title}`}
              disabled={busy}
              onPress={() => openEditSheet(w)}
              style={[styles.action, busy && styles.actionDisabled]}
            >
              <Ionicons name="create-outline" size={16} color={colors.text} />
              <AppText variant="caption" color={colors.text}>
                Edit
              </AppText>
            </PressableScale>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={archivedRow ? `Restore ${w.title}` : `Archive ${w.title}`}
              disabled={busy}
              onPress={() => void toggleArchive(w)}
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
              accessibilityLabel={`Delete ${w.title}`}
              disabled={busy}
              onPress={() => setDeleteTarget(w)}
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
      <SectionLabel>Assigned workouts</SectionLabel>

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Retry loading workouts"
          onPress={() => void load()}
          style={styles.centre}
        >
          <AppText variant="caption" color={colors.textDim}>
            {error} · tap to retry
          </AppText>
        </PressableScale>
      ) : workouts.length === 0 ? (
        <EmptyState
          icon="barbell-outline"
          title="No workouts assigned yet"
          body="Build the client's first program below."
        />
      ) : (
        <>
          {active.map((w, i) => renderCard(w, i, false))}
          {archived.map((w, i) => renderCard(w, i, true))}
        </>
      )}

      <Button label="Add workout" variant="secondary" onPress={openCreateSheet} style={styles.addBtn} />

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title={editing ? 'Edit workout' : 'New workout'}>
        <AppTextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Title — e.g. Push day A"
          maxLength={120}
          accessibilityLabel="Workout title"
          style={styles.sheetInput}
        />
        <AppTextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Notes (optional)"
          maxLength={1000}
          multiline
          style={[styles.sheetInput, styles.notesInput]}
          accessibilityLabel="Workout notes"
        />

        <AppText variant="label" style={styles.itemsLabel}>
          Exercises ({items.length}/15)
        </AppText>
        {items.map((it, i) => (
          <View key={it.key} style={styles.itemRow}>
            {it.imageUrl ? (
              <Image source={{ uri: it.imageUrl }} style={styles.itemThumb} contentFit="cover" />
            ) : null}
            <View style={styles.itemText}>
              <AppText variant="bodyBold" numberOfLines={1}>
                {it.name}
              </AppText>
              <AppText variant="caption" color={colors.textDim}>
                {it.sets} × {it.repRange} · {it.restSec}s rest
              </AppText>
            </View>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Move ${it.name} up`}
              disabled={i === 0}
              onPress={() => moveItem(it.key, -1)}
              style={[styles.itemIconBtn, i === 0 && styles.actionDisabled]}
            >
              <Ionicons name="chevron-up" size={16} color={colors.textDim} />
            </PressableScale>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Move ${it.name} down`}
              disabled={i === items.length - 1}
              onPress={() => moveItem(it.key, 1)}
              style={[styles.itemIconBtn, i === items.length - 1 && styles.actionDisabled]}
            >
              <Ionicons name="chevron-down" size={16} color={colors.textDim} />
            </PressableScale>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Remove ${it.name}`}
              onPress={() => removeItem(it.key)}
              style={styles.itemIconBtn}
            >
              <Ionicons name="close" size={18} color={colors.textDim} />
            </PressableScale>
          </View>
        ))}

        {items.length < 15 ? (
          <View style={styles.addItemForm}>
            <AppText variant="label">Add an exercise</AppText>
            {pickedExercise ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Remove ${pickedExercise.name}`}
                onPress={() => setPickedExercise(null)}
                style={styles.exerciseChip}
              >
                <AppText variant="caption" color={colors.text} numberOfLines={1} style={styles.noteText}>
                  {pickedExercise.name}
                </AppText>
                <Ionicons name="close-circle" size={18} color={colors.textDim} />
              </PressableScale>
            ) : (
              <>
                <AppTextInput
                  value={customName || query}
                  onChangeText={(v) => {
                    setQuery(v);
                    setCustomName(v);
                  }}
                  placeholder="Search library or type a custom name"
                  maxLength={80}
                  accessibilityLabel="Exercise name"
                  style={styles.sheetInput}
                />
                {suggestions.map((ex) => (
                  <PressableScale
                    key={ex.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${ex.name}`}
                    onPress={() => {
                      setPickedExercise(ex);
                      setQuery('');
                      setCustomName('');
                    }}
                    style={styles.suggestion}
                  >
                    <AppText variant="caption" color={colors.text} numberOfLines={1} style={styles.noteText}>
                      {ex.name}
                    </AppText>
                    <AppText variant="caption" color={colors.textFaint}>
                      {ex.muscleGroup}
                    </AppText>
                  </PressableScale>
                ))}
              </>
            )}

            <View style={styles.stepperRow}>
              <Stepper label="Sets" value={sets} onChange={setSets} step={1} min={1} max={10} />
              <Stepper
                label="Rest"
                value={restSec}
                onChange={setRestSec}
                step={15}
                min={15}
                max={600}
                format={(v) => `${v}s`}
              />
            </View>
            <AppTextInput
              value={repRange}
              onChangeText={setRepRange}
              placeholder="Rep range — e.g. 8-12"
              maxLength={20}
              accessibilityLabel="Rep range"
              style={styles.sheetInput}
            />
            {!repRangeValid && repRange.length > 0 ? (
              <AppText variant="caption" color={colors.error}>
                Use a number or a range, e.g. 5 or 8-12.
              </AppText>
            ) : null}

            {!pickedExercise ? (
              itemImageUrl ? (
                <View style={styles.photoPreviewRow}>
                  <Image source={{ uri: itemImageUrl }} style={styles.itemThumb} contentFit="cover" />
                  <Button
                    label="Remove photo"
                    variant="ghost"
                    onPress={() => setItemImageUrl(undefined)}
                  />
                </View>
              ) : (
                <Button
                  label={imageUploading ? 'Uploading…' : 'Add photo (optional)'}
                  variant="ghost"
                  loading={imageUploading}
                  disabled={imageUploading}
                  onPress={() => void pickCustomPhoto()}
                />
              )
            ) : null}
            {imageError ? (
              <AppText variant="caption" color={colors.error}>
                {imageError}
              </AppText>
            ) : null}

            <Button
              label="Add to workout"
              variant="secondary"
              disabled={!canAddItem}
              onPress={addItem}
            />
          </View>
        ) : null}

        {formError ? (
          <AppText variant="caption" color={colors.error} style={styles.formErrorText}>
            {formError}
          </AppText>
        ) : null}

        <Button
          label={saving ? 'Saving…' : editing ? 'Save changes' : 'Assign workout'}
          onPress={() => void save()}
          loading={saving}
          disabled={saving || !title.trim() || items.length === 0}
          style={styles.saveBtn}
        />
      </Sheet>

      <ConfirmDialog
        visible={deleteTarget !== null}
        title="Delete workout?"
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
  iconAction: {
    width: touch.min,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  actionDisabled: { opacity: 0.35 },
  sheetInput: { marginBottom: spacing.md },
  notesInput: { minHeight: 64, paddingTop: 16, textAlignVertical: 'top' },
  itemsLabel: { marginBottom: spacing.sm },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  itemThumb: { width: 40, height: 40, borderRadius: radius.md },
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
  exerciseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    height: touch.min,
  },
  noteText: { flex: 1 },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: touch.min,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    marginBottom: spacing.xs,
  },
  stepperRow: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: spacing.sm },
  photoPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  formErrorText: { marginTop: spacing.sm },
  saveBtn: { marginTop: spacing.md },
});
