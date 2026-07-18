import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { type Exercise } from '@gym/shared';
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
  ScreenHeader,
  SectionLabel,
  Sheet,
  Tag,
} from '../../../components/ui';
import {
  createVideo,
  deleteVideo,
  getModerationQueue,
  getVideos,
  removeModerationItem,
  StaffApiError,
  toStaffError,
  updateVideo,
  type VideoCreateResult,
  type StaffErrorCode,
  type Tier,
  type VideoRow,
  type VideoStatus,
} from '../../../features/staff/api';
import { pushStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { searchExercises } from '../../../lib/exercises';
import { useAuth } from '../../../state/auth';

/**
 * P1-9 client contract (M2 owns features/staff/api.ts — coded against the
 * EXACT export names from its brief; the row shape below is this screen's
 * best-effort guess and may need reconciling at the integration gate):
 *   getModerationQueue(kind, token) => Promise<ModerationItem[]>
 *   removeModerationItem(kind, id, token) => Promise<void>
 * Gated `moderation.manage` — independent of `content.manage` (org-wide
 * video CRUD), so a content_admin sees both, but the two are separate keys.
 */
type ModerationKind = 'milestones' | 'custom-foods' | 'progress-photos';

interface ModerationItem {
  id: string;
  accountId: string;
  accountDisplayName: string;
  /** Milestone title / food name / photo caption — the item's headline. */
  title: string;
  /** Secondary line — milestone note / food brand-macros / photo date. */
  detail: string;
  /** Populated only for progress-photos. */
  imageUrl?: string | null;
  createdAt: string;
}

const MODERATION_TABS: { key: ModerationKind; label: string }[] = [
  { key: 'milestones', label: 'Milestones' },
  { key: 'custom-foods', label: 'Custom foods' },
  { key: 'progress-photos', label: 'Progress photos' },
];

/**
 * Admin · Content — the plan-video library.
 *
 * Lets a content admin upload a new plan video from the phone, scan the
 * catalog, retier a video (which tier unlocks it) and soft-remove a video.
 *
 * The upload mirrors the web console handshake — two guarded server round
 * trips plus one direct upload to the configured video host (bytes never pass
 * through our API):
 *   1. createVideo() reserves a direct-creator-upload slot and inserts the row
 *      in status='processing', returning { video, upload:{url, fields?} }.
 *   2. The file is POSTed straight to upload.url as multipart/form-data: every
 *      upload.fields entry (Cloudinary signed fields), then the picked file
 *      under `file`. Cloudflare Stream one-time URLs carry no fields.
 *   3. updateVideo(id, { status:'ready' }) confirms. thumbnailUrl/durationSec
 *      are owned by the server, so the host's JSON response is only drained.
 *
 * Every mutation refetches so the list always reflects the server. Loading is
 * a spinner; failures surface as one quiet retry line.
 *
 * Block language (REVAMP-BRIEF): back row → ScreenHeader → charcoal upload
 * panel and video cards (no borders, fill-contrast separation); sheet options
 * are raised rows with gaps instead of hairlines; Remove reads in red.
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

// ── Upload helpers ───────────────────────────────────────────────

/**
 * Multipart file name for the picked asset. Prefer the library's own name,
 * else derive the extension from the uri; the host only uses it as a hint.
 */
function uploadFileName(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.fileName) return asset.fileName;
  const ext = /\.(\w{2,4})$/.exec(asset.uri)?.[1];
  return `video.${ext ?? 'mp4'}`;
}

/** Map an upload-flow StaffApiError code to a short, human line. */
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

/**
 * Owns the pick → details → upload flow. Collapsed to a single button until a
 * video is picked; then an inline form (title, tier, optional exercise). All
 * quiet feedback (permission denial, errors, success) is one caption line.
 */
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
  // One quiet line under the panel: permission denial, error, or success.
  const [line, setLine] = useState<{ text: string; tone: 'dim' | 'error' | 'success' } | null>(
    null,
  );
  // The host keys are absent server-side — uploads can't work at all.
  const [notConfigured, setNotConfigured] = useState(false);
  // G11: the {video, upload} reservation from a successful createVideo() —
  // held across retries so a failed host-upload/confirm step re-tries THAT
  // same processing row instead of calling createVideo again and orphaning a
  // duplicate. Cleared on final success or on an explicit Cancel/abandon.
  const [reservation, setReservation] = useState<VideoCreateResult | null>(null);

  // Bundled library lookup — no network. Hidden once an exercise is chosen.
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
    setReservation(null);
  }, []);

  // G11: abandoning the form while a reservation is outstanding (the row was
  // already created server-side but never confirmed 'ready') best-effort
  // removes that orphaned 'processing' row instead of leaving it forever.
  const abandon = useCallback(() => {
    const stale = reservation;
    reset();
    if (stale && token) {
      void deleteVideo(stale.video.id, token).catch(() => {
        // Best-effort only — worst case the row stays 'processing' and an
        // admin removes it later from the library list below.
      });
    }
  }, [reservation, reset, token]);

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
    if (result.canceled) return; // user backed out — nothing to say
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
      // 1. Reserve the upload slot + create the row (status='processing') —
      //    reuse an existing reservation on retry (G11) rather than calling
      //    createVideo again, which would orphan a second 'processing' row.
      const created =
        reservation ??
        (await createVideo(
          {
            title: trimmed,
            tierRequired: tier,
            ...(exercise ? { exerciseId: exercise.id } : {}),
          },
          token,
        ));
      if (!reservation) setReservation(created);
      const { video, upload } = created;

      // 2. Push the bytes straight to the host (never through our API). RN's
      //    FormData takes a { uri, name, type } descriptor for the file part;
      //    no manual Content-Type — fetch sets the multipart boundary.
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
      // Drain the host's JSON so the connection closes cleanly. We persist
      // nothing from it: thumbnailUrl/durationSec are owned by the server,
      // and the confirm below only flips status.
      await hostRes.json().catch(() => null);

      // 3. Confirm — flip the row to 'ready'.
      await updateVideo(video.id, { status: 'ready' }, token);

      reset();
      setLine({ text: `"${trimmed}" uploaded and live in the library.`, tone: 'success' });
      await onUploaded();
    } catch (err) {
      const staffErr = toStaffError(err);
      if (staffErr.code === 'not_configured') {
        // Match the web console: a banner, not a transient error line.
        setNotConfigured(true);
        reset();
        return;
      }
      // Keep the form so the admin can retry without re-picking.
      setPhase('details');
      setLine({ text: uploadErrorLine(staffErr.code), tone: 'error' });
    }
  }, [token, asset, title, tier, exercise, reservation, reset, onUploaded]);

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
            <AppText variant="caption" color={colors.textDim} numberOfLines={1} style={styles.noteText}>
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
              <AppText variant="caption" color={colors.text} numberOfLines={1} style={styles.noteText}>
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

          <View style={styles.uploadActions}>
            <Button
              label="Cancel"
              variant="ghost"
              disabled={uploading}
              onPress={() => {
                abandon();
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
  video: VideoRow;
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
            <View style={styles.tagRow}>
              <Tag label={`Tier · ${TIER_LABEL[video.tierRequired]}`} variant="outline" />
              <Tag label={tag.label} variant="outline" color={tag.color} />
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

// ── Moderation tabs (P1-9) ──────────────────────────────────────

function ModerationRow({
  item,
  kind,
  busy,
  onRemovePress,
}: {
  item: ModerationItem;
  kind: ModerationKind;
  busy: boolean;
  onRemovePress: () => void;
}) {
  return (
    <View style={styles.modRow}>
      {kind === 'progress-photos' && item.imageUrl ? (
        <Image
          source={{ uri: item.imageUrl }}
          style={styles.modThumb}
          contentFit="cover"
          transition={100}
        />
      ) : (
        <View style={[styles.modThumb, styles.modThumbPlaceholder]}>
          <Ionicons
            name={kind === 'milestones' ? 'trophy-outline' : 'nutrition-outline'}
            size={18}
            color={colors.textFaint}
          />
        </View>
      )}
      <View style={styles.modRowText}>
        <AppText variant="bodyBold" numberOfLines={1}>
          {item.title}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {item.accountDisplayName} · {item.detail}
        </AppText>
      </View>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.title}`}
        disabled={busy}
        onPress={onRemovePress}
        style={[styles.modRemoveBtn, busy && styles.actionDisabled]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.error} />
        ) : (
          <Ionicons name="trash-outline" size={18} color={colors.error} />
        )}
      </PressableScale>
    </View>
  );
}

function ModerationTabs({ token }: { token: string }) {
  const [kind, setKind] = useState<ModerationKind>('milestones');
  const [items, setItems] = useState<ModerationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Tracked separately from the display line so 'not_configured' (an unbuilt
  // route, not a connectivity problem) can hide the Retry affordance —
  // retrying a client-side stub error deterministically fails the same way
  // every time and would otherwise read as a real network glitch.
  const [errorCode, setErrorCode] = useState<StaffErrorCode | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ModerationItem | null>(null);

  const load = useCallback(
    async (k: ModerationKind) => {
      setLoading(true);
      setError(null);
      setErrorCode(null);
      try {
        setItems(await getModerationQueue(k, token));
      } catch (err) {
        const code = toStaffError(err).code;
        setErrorCode(code);
        setError(errorLine(code));
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void load(kind);
  }, [kind, load]);

  async function doRemove(): Promise<void> {
    if (!removeTarget) return;
    const target = removeTarget;
    setRemoveTarget(null);
    setBusyId(target.id);
    try {
      await removeModerationItem(kind, target.id, token);
      await load(kind);
    } catch (err) {
      const code = toStaffError(err).code;
      setErrorCode(code);
      setError(errorLine(code));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Animated.View entering={enterUp(0)} style={styles.modBlock}>
      <SectionLabel>Moderation</SectionLabel>
      <View style={styles.chipRow}>
        {MODERATION_TABS.map((t) => (
          <Chip
            key={t.key}
            label={t.label}
            selected={kind === t.key}
            onPress={() => setKind(t.key)}
          />
        ))}
      </View>

      {loading ? (
        <View style={styles.modCentre}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.modCentre}>
          <AppText variant="caption" center color={colors.textDim}>
            {error}
          </AppText>
          {errorCode !== 'not_configured' ? (
            <Button label="Retry" variant="secondary" onPress={() => void load(kind)} />
          ) : null}
        </View>
      ) : items.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.modEmpty}>
          Nothing to review here.
        </AppText>
      ) : (
        items.map((item) => (
          <ModerationRow
            key={item.id}
            item={item}
            kind={kind}
            busy={busyId === item.id}
            onRemovePress={() => setRemoveTarget(item)}
          />
        ))
      )}

      <ConfirmDialog
        visible={removeTarget !== null}
        title="Remove this item?"
        message={
          removeTarget
            ? `"${removeTarget.title}" will be removed from ${removeTarget.accountDisplayName}'s account. This can't be undone.`
            : undefined
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        danger
        onConfirm={() => void doRemove()}
        onCancel={() => setRemoveTarget(null)}
      />
    </Animated.View>
  );
}

// ── Screen ───────────────────────────────────────────────────────

export default function AdminContentScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  // Org-wide content CRUD needs 'content.manage' (content_admin + super/main).
  // A plain coach holds only 'content.video.own' and uses the separate
  // staff/coach/videos.tsx screen — this console is not their route.
  const allowed = staffCan(staffPermissions, 'content.manage');
  // P1-9: moderation queues (milestones/custom foods/progress photos) are a
  // SEPARATE key from content.manage — a moderator without video-publish
  // rights should still reach this section.
  const canModerate = staffCan(staffPermissions, 'moderation.manage');

  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The video currently under a mutation (disables its row actions).
  const [busyId, setBusyId] = useState<string | null>(null);

  // Tier picker sheet state.
  const [tierTarget, setTierTarget] = useState<VideoRow | null>(null);
  // Remove confirm state.
  const [removeTarget, setRemoveTarget] = useState<VideoRow | null>(null);
  // A transient mutation error surfaced through the branded dialog.
  const [mutationError, setMutationError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await getVideos(token);
      setVideos(rows);
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const changeTier = useCallback(
    async (video: VideoRow, tier: Tier) => {
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
    async (video: VideoRow) => {
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

  if (!allowed) {
    return (
      <Screen scroll={canModerate}>
        <Animated.View entering={enterDown()} style={styles.headerRow}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Back to admin console"
            onPress={() => pushStaff(STAFF_ROUTES.adminHome)}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </PressableScale>
        </Animated.View>
        <ScreenHeader eyebrow="Admin console" title="Content" style={styles.header} />
        {canModerate && token ? (
          <ModerationTabs token={token} />
        ) : (
          <Animated.View entering={enterUp(0)} style={styles.locked}>
            <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
            <AppText variant="caption" center color={colors.textFaint}>
              Only a content admin, main admin or super admin can manage the video library.
            </AppText>
          </Animated.View>
        )}
      </Screen>
    );
  }

  return (
    <Screen scroll keyboardAware>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back to admin console"
          onPress={() => pushStaff(STAFF_ROUTES.adminHome)}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>

      <ScreenHeader eyebrow="Admin console" title="Content" style={styles.header} />

      {canModerate && token ? <ModerationTabs token={token} /> : null}

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
      return "You don't have permission to manage content.";
    case 'not_found':
      return 'That video no longer exists.';
    case 'invalid':
      return 'That change was rejected. Try again.';
    case 'not_configured':
      return "Custom food moderation isn't built yet — check back in a future update.";
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
  header: { marginBottom: spacing.gutter },
  locked: {
    marginTop: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  // Borderless notice: the warning icon carries the tone, not a stroke.
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  noteText: { flex: 1 },
  modBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  modCentre: { paddingVertical: spacing.lg, alignItems: 'center', gap: spacing.md },
  modEmpty: { paddingVertical: spacing.sm },
  modRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 64,
  },
  modThumb: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  modThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  modRowText: { flex: 1, gap: 2, minWidth: 0 },
  modRemoveBtn: {
    width: touch.min,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadPanel: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  // Charcoal upload panel — flat fill, no border (no-border card law).
  uploadForm: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
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
  // Raised suggestion rows with gaps replace hairline separators.
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: touch.min,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    marginBottom: spacing.xs,
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
  // Charcoal video card (brief §11c): fill contrast, no hairline borders.
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  cardRemoved: { opacity: 0.55 },
  cardTop: { flexDirection: 'row' },
  cardTitle: { flex: 1, gap: spacing.sm },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
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
  // Raised option rows with gaps replace hairline separators (brief §11c).
  tierOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: touch.primary,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
});
