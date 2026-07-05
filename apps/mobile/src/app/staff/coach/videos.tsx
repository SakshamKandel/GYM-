import Ionicons from '@expo/vector-icons/Ionicons';
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
  Chip,
  ConfirmDialog,
  enterDown,
  enterFade,
  enterUp,
  PressableScale,
  Screen,
  Sheet,
  Tag,
} from '../../../components/ui';
import {
  createVideo,
  deleteVideo,
  getCoachVideos,
  StaffApiError,
  toStaffError,
  updateVideo,
  type CoachVideoRow,
  type Tier,
  type VideoStatus,
} from '../../../features/staff/api';
import { pushStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { searchExercises } from '../../../lib/exercises';
import { useAuth } from '../../../state/auth';

/**
 * Coach · Videos — the plan-video library from the coach's phone.
 *
 * Greece holds `content.video.publish`, the same permission content_admin has,
 * so she can browse the whole library AND add / retier / remove clips. This
 * screen is the coach-console twin of admin/content.tsx with two extras the
 * coach read model carries: a playback `views` count per clip and the attached
 * exercise name. The upload + mutation flows are identical (they reuse the same
 * admin video routes, which are gated on the permission she holds).
 *
 * Upload handshake (bytes never touch our API):
 *   1. createVideo() reserves a direct-creator-upload slot, inserts the row
 *      in status='processing', returns { video, upload:{url, fields?} }.
 *   2. The file POSTs straight to upload.url as multipart/form-data (every
 *      upload.fields entry first, then the file under `file`).
 *   3. updateVideo(id, { status:'ready' }) confirms.
 * Every mutation refetches so the list mirrors the server.
 */

const TIER_ORDER: Tier[] = ['starter', 'silver', 'gold', 'elite'];

const TIER_LABEL: Record<Tier, string> = {
  starter: 'Starter',
  silver: 'Silver',
  gold: 'Gold',
  elite: 'Elite',
};

/** Status → tag styling. Ready is the healthy state; the rest read as muted. */
function statusTag(status: VideoStatus): { label: string; color: string } {
  switch (status) {
    case 'ready':
      return { label: 'Ready', color: colors.success };
    case 'processing':
      return { label: 'Processing', color: colors.warning };
    case 'removed':
      return { label: 'Removed', color: colors.textFaint };
  }
}

/** "1 view" / "12 views" / "1.2k views" — compact, never jittery. */
function viewsLabel(views: number): string {
  if (views < 1000) return `${views} view${views === 1 ? '' : 's'}`;
  const k = views / 1000;
  return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k views`;
}

// ── Upload helpers ───────────────────────────────────────────────

function uploadFileName(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.fileName) return asset.fileName;
  const ext = /\.(\w{2,4})$/.exec(asset.uri)?.[1];
  return `video.${ext ?? 'mp4'}`;
}

function uploadErrorLine(code: string): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired. Sign in again to continue.';
    case 'forbidden':
      return "You don't have permission to publish videos.";
    case 'invalid':
      return 'The server rejected those details. Check the title and retry.';
    default:
      return "The upload didn't go through. Check your connection and retry.";
  }
}

// ── Upload panel ─────────────────────────────────────────────────

type UploadPhase = 'idle' | 'details' | 'uploading';

function UploadPanel({
  token,
  onUploaded,
}: {
  token: string | null;
  onUploaded: () => Promise<void>;
}) {
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [title, setTitle] = useState('');
  const [tier, setTier] = useState<Tier>('gold');
  const [exerciseQuery, setExerciseQuery] = useState('');
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [line, setLine] = useState<{ text: string; tone: 'dim' | 'error' | 'success' } | null>(
    null,
  );
  const [notConfigured, setNotConfigured] = useState(false);

  const suggestions = useMemo(() => {
    const q = exerciseQuery.trim();
    if (!q || exercise) return [];
    return searchExercises({ query: q }).slice(0, 6);
  }, [exerciseQuery, exercise]);

  const reset = useCallback(() => {
    setPhase('idle');
    setAsset(null);
    setTitle('');
    setTier('gold');
    setExerciseQuery('');
    setExercise(null);
  }, []);

  const pick = useCallback(async () => {
    setLine(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setLine({
        text: 'Allow photo library access in Settings to pick a video.',
        tone: 'dim',
      });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled) return;
    const picked = result.assets[0];
    if (!picked) return;
    setAsset(picked);
    setPhase('details');
  }, []);

  const submit = useCallback(async () => {
    const trimmed = title.trim();
    if (!token || !asset || !trimmed) return;
    setPhase('uploading');
    setLine(null);
    try {
      const { video, upload } = await createVideo(
        {
          title: trimmed,
          tierRequired: tier,
          ...(exercise ? { exerciseId: exercise.id } : {}),
        },
        token,
      );

      const form = new FormData();
      if (upload.fields) {
        for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
      }
      form.append('file', {
        uri: asset.uri,
        name: uploadFileName(asset),
        type: asset.mimeType ?? 'video/mp4',
      } as unknown as Blob);
      let hostRes: Response;
      try {
        hostRes = await fetch(upload.url, { method: 'POST', body: form });
      } catch {
        throw new StaffApiError('network', "Couldn't reach the video host");
      }
      if (!hostRes.ok) {
        throw new StaffApiError('network', 'The file upload to the video host failed');
      }
      await hostRes.json().catch(() => null);

      await updateVideo(video.id, { status: 'ready' }, token);

      reset();
      setLine({ text: `"${trimmed}" uploaded and live in the library.`, tone: 'success' });
      await onUploaded();
    } catch (err) {
      const staffErr = toStaffError(err);
      if (staffErr.code === 'not_configured') {
        setNotConfigured(true);
        reset();
        return;
      }
      setPhase('details');
      setLine({ text: uploadErrorLine(staffErr.code), tone: 'error' });
    }
  }, [token, asset, title, tier, exercise, reset, onUploaded]);

  const uploading = phase === 'uploading';

  if (notConfigured) {
    return (
      <Animated.View entering={enterUp(0)} style={styles.banner}>
        <Ionicons name="videocam-off-outline" size={18} color={colors.warning} />
        <AppText variant="caption" style={styles.noteText} color={colors.textDim}>
          Video hosting not configured — add Cloudinary keys.
        </AppText>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={enterUp(0)} style={styles.uploadPanel}>
      {phase === 'idle' ? (
        <Button label="Upload video" onPress={() => void pick()} />
      ) : (
        <View style={styles.uploadForm}>
          <View style={styles.fileRow}>
            <Ionicons name="videocam-outline" size={18} color={colors.textDim} />
            <AppText
              variant="caption"
              color={colors.textDim}
              numberOfLines={1}
              style={styles.noteText}
            >
              {asset ? uploadFileName(asset) : ''}
            </AppText>
          </View>

          <AppTextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Title — e.g. Barbell back squat"
            maxLength={200}
            editable={!uploading}
            accessibilityLabel="Video title"
          />

          <AppText variant="label">Unlocks at tier</AppText>
          <View style={styles.chipRow}>
            {TIER_ORDER.map((t) => (
              <Chip
                key={t}
                label={TIER_LABEL[t]}
                selected={t === tier}
                onPress={() => {
                  if (!uploading) setTier(t);
                }}
              />
            ))}
          </View>

          <AppText variant="label">Attach to exercise (optional)</AppText>
          {exercise ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Remove attached exercise ${exercise.name}`}
              disabled={uploading}
              onPress={() => setExercise(null)}
              style={styles.exerciseChip}
            >
              <AppText
                variant="caption"
                color={colors.text}
                numberOfLines={1}
                style={styles.noteText}
              >
                {exercise.name}
              </AppText>
              <Ionicons name="close-circle" size={18} color={colors.textDim} />
            </PressableScale>
          ) : (
            <>
              <AppTextInput
                value={exerciseQuery}
                onChangeText={setExerciseQuery}
                placeholder="Search exercises by name"
                editable={!uploading}
                accessibilityLabel="Search exercises"
              />
              {suggestions.map((ex) => (
                <PressableScale
                  key={ex.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Attach ${ex.name}`}
                  disabled={uploading}
                  onPress={() => {
                    setExercise(ex);
                    setExerciseQuery('');
                  }}
                  style={styles.suggestion}
                >
                  <AppText
                    variant="caption"
                    color={colors.text}
                    numberOfLines={1}
                    style={styles.noteText}
                  >
                    {ex.name}
                  </AppText>
                  <AppText variant="caption" color={colors.textFaint}>
                    {ex.muscleGroup}
                  </AppText>
                </PressableScale>
              ))}
            </>
          )}

          <View style={styles.uploadActions}>
            <Button
              label="Cancel"
              variant="ghost"
              disabled={uploading}
              onPress={() => {
                reset();
                setLine(null);
              }}
              style={styles.uploadAction}
            />
            <Button
              label={uploading ? 'Uploading…' : 'Upload'}
              loading={uploading}
              disabled={uploading || title.trim().length === 0}
              onPress={() => void submit()}
              style={styles.uploadAction}
            />
          </View>
        </View>
      )}

      {line ? (
        <Animated.View entering={enterFade()}>
          <AppText
            variant="caption"
            color={
              line.tone === 'error'
                ? colors.error
                : line.tone === 'success'
                  ? colors.success
                  : colors.textDim
            }
          >
            {line.text}
          </AppText>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

// ── One video row ────────────────────────────────────────────────

function VideoCard({
  video,
  index,
  busy,
  onRetierPress,
  onRemovePress,
}: {
  video: CoachVideoRow;
  index: number;
  busy: boolean;
  onRetierPress: () => void;
  onRemovePress: () => void;
}) {
  const tag = statusTag(video.status);
  const removed = video.status === 'removed';
  return (
    <Animated.View entering={enterUp(index)}>
      <View style={[styles.card, removed && styles.cardRemoved]}>
        <View style={styles.cardTop}>
          <View style={styles.cardTitle}>
            <AppText variant="bodyBold" numberOfLines={2}>
              {video.title}
            </AppText>
            {video.exercise?.name ? (
              <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
                {video.exercise.name}
              </AppText>
            ) : null}
            <View style={styles.tagRow}>
              <Tag label={`Tier · ${TIER_LABEL[video.tierRequired]}`} variant="outline" />
              <Tag label={tag.label} variant="outline" color={tag.color} />
            </View>
            <View style={styles.metaRow}>
              <Ionicons name="eye-outline" size={14} color={colors.textFaint} />
              <AppText variant="caption" color={colors.textFaint}>
                {viewsLabel(video.views)}
              </AppText>
            </View>
          </View>
        </View>

        {removed ? null : (
          <View style={styles.cardActions}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Change tier for ${video.title}`}
              disabled={busy}
              onPress={onRetierPress}
              style={[styles.action, busy && styles.actionDisabled]}
            >
              <Ionicons name="pricetag-outline" size={16} color={colors.text} />
              <AppText variant="caption" color={colors.text}>
                Change tier
              </AppText>
            </PressableScale>

            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Remove ${video.title}`}
              disabled={busy}
              onPress={onRemovePress}
              style={[styles.action, busy && styles.actionDisabled]}
            >
              <Ionicons name="trash-outline" size={16} color={colors.error} />
              <AppText variant="caption" color={colors.error}>
                Remove
              </AppText>
            </PressableScale>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

// ── Screen ───────────────────────────────────────────────────────

export default function CoachVideosScreen() {
  const token = useAuth((s) => s.token);

  const [videos, setVideos] = useState<CoachVideoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [tierTarget, setTierTarget] = useState<CoachVideoRow | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CoachVideoRow | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await getCoachVideos(token);
      setVideos(rows);
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeTier = useCallback(
    async (video: CoachVideoRow, tier: Tier) => {
      setTierTarget(null);
      if (!token || tier === video.tierRequired) return;
      setBusyId(video.id);
      try {
        await updateVideo(video.id, { tierRequired: tier }, token);
        await load();
      } catch (err) {
        setMutationError(errorLine(toStaffError(err).code));
      } finally {
        setBusyId(null);
      }
    },
    [token, load],
  );

  const removeVideo = useCallback(
    async (video: CoachVideoRow) => {
      setRemoveTarget(null);
      if (!token) return;
      setBusyId(video.id);
      try {
        await deleteVideo(video.id, token);
        await load();
      } catch (err) {
        setMutationError(errorLine(toStaffError(err).code));
      } finally {
        setBusyId(null);
      }
    },
    [token, load],
  );

  return (
    <Screen scroll>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back to inbox"
          onPress={() => pushStaff(STAFF_ROUTES.coachInbox)}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
        <AppText variant="heading">Videos</AppText>
      </Animated.View>

      {/* Native upload — pick a video, fill the details, push to the host. */}
      <UploadPanel token={token} onUploaded={load} />

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centre}>
          <AppText variant="caption" center color={colors.textDim}>
            {error}
          </AppText>
          <Button label="Retry" variant="secondary" onPress={() => void load()} />
        </View>
      ) : videos.length === 0 ? (
        <View style={styles.centre}>
          <AppText variant="caption" center color={colors.textFaint}>
            No videos in the library yet. Upload the first one above.
          </AppText>
        </View>
      ) : (
        videos.map((video, i) => (
          <VideoCard
            key={video.id}
            video={video}
            index={i}
            busy={busyId === video.id}
            onRetierPress={() => setTierTarget(video)}
            onRemovePress={() => setRemoveTarget(video)}
          />
        ))
      )}

      {/* Tier picker */}
      <Sheet
        visible={tierTarget !== null}
        onClose={() => setTierTarget(null)}
        title="Unlock at tier"
      >
        {tierTarget
          ? TIER_ORDER.map((tier) => {
              const current = tier === tierTarget.tierRequired;
              return (
                <PressableScale
                  key={tier}
                  accessibilityRole="button"
                  accessibilityState={{ selected: current }}
                  accessibilityLabel={TIER_LABEL[tier]}
                  onPress={() => void changeTier(tierTarget, tier)}
                  style={styles.tierOption}
                >
                  <AppText variant="body" color={current ? colors.text : colors.textDim}>
                    {TIER_LABEL[tier]}
                  </AppText>
                  {current ? (
                    <Ionicons name="checkmark" size={20} color={colors.accent} />
                  ) : null}
                </PressableScale>
              );
            })
          : null}
      </Sheet>

      {/* Remove confirm */}
      <ConfirmDialog
        visible={removeTarget !== null}
        title="Remove video?"
        message={
          removeTarget
            ? `"${removeTarget.title}" will be hidden from members. This can be undone from the web console.`
            : undefined
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        danger
        onConfirm={() => {
          if (removeTarget) void removeVideo(removeTarget);
        }}
        onCancel={() => setRemoveTarget(null)}
      />

      {/* Mutation error (network / permission) — branded, dismissable. */}
      <ConfirmDialog
        visible={mutationError !== null}
        title="Couldn't save"
        message={mutationError ?? undefined}
        confirmLabel="OK"
        hideCancel
        onConfirm={() => setMutationError(null)}
        onCancel={() => setMutationError(null)}
      />
    </Screen>
  );
}

/** Map a StaffApiError code to a short, human line. */
function errorLine(code: string): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired. Sign in again to continue.';
    case 'forbidden':
      return "You don't have permission to manage videos.";
    case 'not_found':
      return 'That video no longer exists.';
    case 'invalid':
      return 'That change was rejected. Try again.';
    default:
      return "Couldn't reach the server. Check your connection and retry.";
  }
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
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  noteText: { flex: 1 },
  uploadPanel: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  uploadForm: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
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
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: touch.min,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  uploadActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  uploadAction: { flex: 1 },
  centre: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    gap: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  cardRemoved: { opacity: 0.55 },
  cardTop: { flexDirection: 'row' },
  cardTitle: { flex: 1, gap: spacing.sm },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: touch.min,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  actionDisabled: { opacity: 0.4 },
  tierOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: touch.primary,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
