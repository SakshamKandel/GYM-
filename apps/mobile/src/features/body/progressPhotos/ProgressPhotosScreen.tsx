import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { hasEntitlement, minTierFor } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { RefreshControl, StyleSheet, View } from 'react-native';
import {
  AppText,
  AppTextInput,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ProgressBar,
  Screen,
  SectionLabel,
  Skeleton,
  UpgradePrompt,
} from '../../../components/ui';
import {
  reserveImageUpload,
  toApiError,
  uploadImageAsset,
} from '../../../lib/api/client';
import { posterDate, todayIso, toIsoDate } from '../../../lib/dates';
import { successHaptic } from '../../../lib/haptics';
import { useEffectiveTier } from '../../../lib/tier';
import { useAuth } from '../../../state/auth';
import { BackHeader } from '../components/BackHeader';
import {
  createProgressPhoto,
  deleteProgressPhoto,
  listProgressPhotos,
  ProgressPhotoApiError,
  type CreatedProgressPhoto,
  type ProgressPhoto,
} from './api';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

type UploadStage = 'idle' | 'reserving' | 'uploading' | 'saving';
type LoadState = 'idle' | 'loading' | 'ready' | 'error';

const styles = StyleSheet.create({
  heading: { gap: spacing.sm, marginBottom: spacing.xl },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  privacyIcon: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyCopy: { flex: 1, gap: spacing.xs },
  composer: { gap: spacing.lg },
  sourceButtons: { flexDirection: 'row', gap: spacing.md },
  sourceButton: { flex: 1, paddingHorizontal: spacing.md },
  preview: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
  },
  field: { gap: spacing.sm },
  noteInput: { minHeight: 112, paddingTop: spacing.lg, textAlignVertical: 'top' },
  fieldMeta: { alignSelf: 'flex-end' },
  progress: { gap: spacing.sm },
  statusLine: { gap: spacing.sm },
  error: { color: colors.error },
  success: { color: colors.success },
  skeletons: { gap: spacing.md },
  gallery: { gap: spacing.lg },
  photoCard: { gap: spacing.lg },
  photoImageWrap: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  photoImage: { width: '100%', height: '100%' },
  brokenImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    backgroundColor: colors.surfaceRaised,
  },
  photoCopy: { gap: spacing.sm },
  deleteError: { marginTop: -spacing.sm },
  staleError: { marginBottom: spacing.lg, gap: spacing.md },
  upgrade: { marginTop: spacing.md },
});

function pickerFileName(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.fileName) return asset.fileName;
  const extension = /\.(jpe?g|png|webp|heic)$/i.exec(asset.uri)?.[1] ?? 'jpg';
  return `progress-photo.${extension}`;
}

function validPhotoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > todayIso()) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && toIsoDate(parsed) === value;
}

function uploadStageLabel(stage: UploadStage): string {
  if (stage === 'reserving') return 'Preparing your private upload…';
  if (stage === 'uploading') return 'Uploading securely…';
  if (stage === 'saving') return 'Adding it to your timeline…';
  return '';
}

function uploadStageProgress(stage: UploadStage): number {
  if (stage === 'reserving') return 0.12;
  if (stage === 'uploading') return 0.6;
  if (stage === 'saving') return 0.9;
  return 0;
}

function loadErrorMessage(error: unknown): string {
  if (error instanceof ProgressPhotoApiError) {
    if (error.code === 'unauthorized') return 'Your session expired. Sign in again to continue.';
    if (error.code === 'image_not_configured') {
      return 'Private photo storage is temporarily unavailable.';
    }
  }
  return "Can't reach your private gallery. Check your connection and try again.";
}

function saveErrorMessage(error: unknown): string {
  if (error instanceof ProgressPhotoApiError) {
    if (error.code === 'unauthorized') return 'Your session expired. Sign in again to continue.';
    if (error.code === 'locked') return 'Your current plan no longer includes progress photos.';
    if (error.code === 'invalid') return 'Check the date and note, then try again.';
    if (error.code === 'image_not_configured') {
      return 'Private photo storage is temporarily unavailable.';
    }
  }
  const apiError = toApiError(error);
  if (apiError.code === 'unauthorized') return 'Your session expired. Sign in again to continue.';
  if (apiError.code === 'image_not_configured') {
    return 'Private photo storage is temporarily unavailable.';
  }
  return "Couldn't upload while offline. Check your connection, then retry.";
}

function deleteErrorMessage(error: unknown): string {
  if (error instanceof ProgressPhotoApiError) {
    if (error.code === 'unauthorized') return 'Your session expired. Sign in again to continue.';
    if (error.code === 'image_not_configured' || error.code === 'image_delete_failed') {
      return "Couldn't remove the private image yet. Try again shortly.";
    }
  }
  return "Couldn't delete this photo. Check your connection and try again.";
}

function GalleryLoading() {
  return (
    <View style={styles.skeletons} accessibilityLabel="Loading progress photos">
      <Skeleton height={320} radius={radius.lg} />
      <Skeleton width="55%" height={20} />
      <Skeleton width="80%" height={16} />
    </View>
  );
}

function createdToPhoto(created: CreatedProgressPhoto): ProgressPhoto | null {
  return created.url ? { ...created, url: created.url } : null;
}

export function ProgressPhotosScreen() {
  const token = useAuth((state) => state.token);
  const accountId = useAuth((state) => state.user?.id ?? null);
  const tier = useEffectiveTier();
  const unlocked = hasEntitlement({ tier }, 'progress_photos');

  const [photos, setPhotos] = useState<ProgressPhoto[]>([]);
  const [galleryOwnerId, setGalleryOwnerId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [serverLocked, setServerLocked] = useState(false);

  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [takenOn, setTakenOn] = useState(todayIso());
  const [note, setNote] = useState('');
  const [pendingUid, setPendingUid] = useState<string | null>(null);
  const [uploadStage, setUploadStage] = useState<UploadStage>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  const [deleteCandidate, setDeleteCandidate] = useState<ProgressPhoto | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let active = true;
    if (!token || !accountId || !unlocked) {
      return () => {
        active = false;
      };
    }

    void listProgressPhotos(token)
      .then((rows) => {
        if (!active) return;
        setPhotos(rows);
        setGalleryOwnerId(accountId);
        setBrokenImages(new Set());
        setLoadError(null);
        setLoadState('ready');
        setServerLocked(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        // Never let an old account's in-memory gallery become visible after an
        // account switch, even if the new account's first request is offline.
        if (galleryOwnerId !== accountId) setPhotos([]);
        setGalleryOwnerId(accountId);
        if (error instanceof ProgressPhotoApiError && error.code === 'locked') {
          setServerLocked(true);
        }
        setLoadError(loadErrorMessage(error));
        setLoadState('error');
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });

    return () => {
      active = false;
    };
  }, [token, accountId, unlocked, refreshKey, galleryOwnerId]);

  function refresh(): void {
    if (!token || !unlocked) return;
    setRefreshing(true);
    setRefreshKey((value) => value + 1);
  }

  function acceptAsset(picked: ImagePicker.ImagePickerAsset): void {
    if (typeof picked.fileSize === 'number' && picked.fileSize > MAX_PHOTO_BYTES) {
      setUploadError('That photo is too large. Choose one under 10 MB.');
      return;
    }
    setAsset(picked);
    setPendingUid(null);
    setUploadError(null);
    setUploadSuccess(null);
  }

  async function takePhoto(): Promise<void> {
    if (uploadStage !== 'idle' || pendingUid) return;
    setUploadError(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setUploadError('Allow camera access in Settings to take a progress photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.85,
      });
      if (!result.canceled && result.assets[0]) acceptAsset(result.assets[0]);
    } catch {
      setUploadError("Couldn't open the camera. Try again or choose a photo instead.");
    }
  }

  async function choosePhoto(): Promise<void> {
    if (uploadStage !== 'idle' || pendingUid) return;
    setUploadError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setUploadError('Allow photo library access in Settings to choose a progress photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.85,
      });
      if (!result.canceled && result.assets[0]) acceptAsset(result.assets[0]);
    } catch {
      setUploadError("Couldn't open your photo library. Try again.");
    }
  }

  async function upload(): Promise<void> {
    if (!token || !asset || uploadStage !== 'idle') return;
    if (!validPhotoDate(takenOn)) {
      setUploadError('Use a real date in YYYY-MM-DD format, no later than today.');
      return;
    }
    if (note.trim().length > 300) {
      setUploadError('Keep your note to 300 characters or fewer.');
      return;
    }

    setUploadError(null);
    setUploadSuccess(null);
    let uid = pendingUid;
    try {
      if (!uid) {
        setUploadStage('reserving');
        const reservation = await reserveImageUpload(token, 'progress_photo');
        setUploadStage('uploading');
        await uploadImageAsset(reservation, {
          uri: asset.uri,
          name: pickerFileName(asset),
          type: asset.mimeType ?? 'image/jpeg',
        });
        uid = reservation.uid;
        setPendingUid(uid);
      }

      setUploadStage('saving');
      const created = await createProgressPhoto(token, {
        takenOn,
        uid,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      const shown = createdToPhoto(created);
      if (shown) {
        setGalleryOwnerId(accountId);
        setPhotos((current) =>
          [shown, ...(galleryOwnerId === accountId ? current : [])].sort((a, b) => {
            const byDate = b.takenOn.localeCompare(a.takenOn);
            return byDate !== 0 ? byDate : b.createdAt.localeCompare(a.createdAt);
          }),
        );
      } else {
        refresh();
      }
      setAsset(null);
      setPendingUid(null);
      setTakenOn(todayIso());
      setNote('');
      setUploadSuccess('Photo added to your private timeline.');
      successHaptic();
    } catch (error) {
      setUploadError(saveErrorMessage(error));
    } finally {
      setUploadStage('idle');
    }
  }

  async function confirmDelete(): Promise<void> {
    const candidate = deleteCandidate;
    setDeleteCandidate(null);
    if (!token || !candidate || deletingId) return;
    setDeletingId(candidate.id);
    setDeleteError(null);
    try {
      await deleteProgressPhoto(token, candidate.id);
      setPhotos((current) => current.filter((photo) => photo.id !== candidate.id));
      successHaptic();
    } catch (error) {
      setDeleteError({ id: candidate.id, message: deleteErrorMessage(error) });
    } finally {
      setDeletingId(null);
    }
  }

  const gated = !unlocked || serverLocked;
  const busy = uploadStage !== 'idle';
  const visiblePhotos = galleryOwnerId === accountId ? photos : [];
  const visibleLoadState = galleryOwnerId === accountId ? loadState : 'loading';

  return (
    <Screen
      scroll
      keyboardAware
      bottomInset={spacing.xxl}
      refreshControl={
        token && !gated ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        ) : undefined
      }
    >
      <BackHeader />
      <View style={styles.heading}>
        <AppText variant="label">Body timeline</AppText>
        <AppText variant="display">Progress photos</AppText>
        <AppText variant="body" color={colors.textDim}>
          Use the same pose and lighting each time for a clearer comparison.
        </AppText>
      </View>

      {gated ? (
        <View style={styles.upgrade}>
          <UpgradePrompt
            title="Private progress photos"
            description="Save a dated visual timeline alongside your body measurements."
            requiredTier={minTierFor('progress_photos')}
          />
        </View>
      ) : !token ? (
        <EmptyState
          icon="lock-closed-outline"
          title="Sign in to keep photos private"
          body="Progress photos are tied to your account and never stored in the shared device gallery by this app."
          actionLabel="Sign in"
          actionVariant="primary"
          onAction={() => router.push('/auth/sign-in')}
        />
      ) : (
        <>
          <View style={styles.privacyRow}>
            <View style={styles.privacyIcon}>
              <Ionicons name="shield-checkmark-outline" size={24} color={colors.success} />
            </View>
            <View style={styles.privacyCopy}>
              <AppText variant="bodyBold">Private by default</AppText>
              <AppText variant="body" color={colors.textDim}>
                Only your signed-in account can request these images. This screen does not keep
                persistent copies of the private links.
              </AppText>
            </View>
          </View>

          <SectionLabel>Add a photo</SectionLabel>
          <Card style={styles.composer}>
            <View style={styles.sourceButtons}>
              <Button
                label="Take photo"
                variant="secondary"
                disabled={busy || pendingUid !== null}
                accessibilityLabel="Take a progress photo with the camera"
                onPress={() => void takePhoto()}
                style={styles.sourceButton}
              />
              <Button
                label="Choose photo"
                variant="secondary"
                disabled={busy || pendingUid !== null}
                accessibilityLabel="Choose a progress photo from your photo library"
                onPress={() => void choosePhoto()}
                style={styles.sourceButton}
              />
            </View>

            {asset ? (
              <>
                <Image
                  source={{ uri: asset.uri }}
                  cachePolicy="none"
                  contentFit="cover"
                  style={styles.preview}
                  accessibilityLabel="Selected progress photo preview"
                />
                <View style={styles.field}>
                  <AppText variant="bodyBold">Date taken</AppText>
                  <AppTextInput
                    value={takenOn}
                    onChangeText={setTakenOn}
                    editable={!busy}
                    maxLength={10}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="YYYY-MM-DD"
                    accessibilityLabel="Date this progress photo was taken, in year month day format"
                  />
                </View>
                <View style={styles.field}>
                  <AppText variant="bodyBold">Note (optional)</AppText>
                  <AppTextInput
                    value={note}
                    onChangeText={setNote}
                    editable={!busy}
                    maxLength={300}
                    multiline
                    placeholder="Pose, lighting, milestone, or how you felt"
                    accessibilityLabel="Optional progress photo note"
                    style={styles.noteInput}
                  />
                  <AppText variant="body" color={colors.textDim} style={styles.fieldMeta}>
                    {note.length}/300
                  </AppText>
                </View>
              </>
            ) : (
              <AppText variant="body" color={colors.textDim}>
                Choose a clear full-body photo. You can add a date and private note before upload.
              </AppText>
            )}

            {busy ? (
              <View style={styles.progress}>
                <ProgressBar
                  value={uploadStageProgress(uploadStage)}
                  accessibilityLabel={`${uploadStageLabel(uploadStage)} ${Math.round(
                    uploadStageProgress(uploadStage) * 100,
                  )} percent`}
                />
                <AppText variant="body" color={colors.textDim}>
                  {uploadStageLabel(uploadStage)}
                </AppText>
              </View>
            ) : null}

            {uploadError ? (
              <View style={styles.statusLine} accessibilityRole="alert">
                <AppText variant="body" style={styles.error}>
                  {uploadError}
                </AppText>
                {pendingUid ? (
                  <AppText variant="body" color={colors.textDim}>
                    The image upload finished. Retry to save it without uploading the image again.
                  </AppText>
                ) : null}
              </View>
            ) : null}
            {uploadSuccess ? (
              <View accessibilityRole="alert">
                <AppText variant="body" style={styles.success}>
                  {uploadSuccess}
                </AppText>
              </View>
            ) : null}

            {asset ? (
              <Button
                label={uploadError ? 'Retry upload' : 'Add to timeline'}
                loading={busy}
                disabled={busy}
                accessibilityLabel={uploadError ? 'Retry progress photo upload' : 'Add photo to private timeline'}
                onPress={() => void upload()}
              />
            ) : null}
          </Card>

          <SectionLabel>Your private gallery</SectionLabel>
          {loadError && visiblePhotos.length > 0 ? (
            <Card style={styles.staleError}>
              <View accessibilityRole="alert">
                <AppText variant="body" style={styles.error}>
                  {loadError}
                </AppText>
              </View>
              <Button label="Try refresh again" variant="secondary" onPress={refresh} />
            </Card>
          ) : null}

          {visibleLoadState === 'loading' && visiblePhotos.length === 0 ? (
            <GalleryLoading />
          ) : visibleLoadState === 'error' && visiblePhotos.length === 0 ? (
            <EmptyState
              icon="cloud-offline-outline"
              title="Gallery unavailable offline"
              body={loadError ?? "Can't load your private photos right now."}
              actionLabel="Try again"
              actionVariant="primary"
              onAction={refresh}
            />
          ) : visiblePhotos.length === 0 ? (
            <EmptyState
              icon="images-outline"
              title="Your timeline starts here"
              body="Add your first photo above. Future photos will appear newest first."
            />
          ) : (
            <View style={styles.gallery}>
              {visiblePhotos.map((photo) => {
                const broken = brokenImages.has(photo.id);
                return (
                  <Card key={photo.id} style={styles.photoCard}>
                    <View style={styles.photoImageWrap}>
                      <Image
                        source={{ uri: photo.url }}
                        cachePolicy="none"
                        contentFit="cover"
                        style={styles.photoImage}
                        accessibilityLabel={`Private progress photo from ${posterDate(photo.takenOn)}`}
                        onError={() =>
                          setBrokenImages((current) => new Set(current).add(photo.id))
                        }
                      />
                      {broken ? (
                        <View style={styles.brokenImage}>
                          <Ionicons name="refresh-outline" size={28} color={colors.textDim} />
                          <AppText variant="body" color={colors.textDim} center>
                            This private link expired. Refresh the gallery to renew it.
                          </AppText>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.photoCopy}>
                      <AppText variant="title">{posterDate(photo.takenOn)}</AppText>
                      {photo.note ? <AppText variant="body">{photo.note}</AppText> : null}
                    </View>
                    <Button
                      label="Delete photo"
                      variant="danger"
                      loading={deletingId === photo.id}
                      disabled={deletingId !== null}
                      accessibilityLabel={`Delete progress photo from ${posterDate(photo.takenOn)}`}
                      onPress={() => setDeleteCandidate(photo)}
                    />
                    {deleteError?.id === photo.id ? (
                      <View accessibilityRole="alert">
                        <AppText variant="body" style={[styles.error, styles.deleteError]}>
                          {deleteError.message}
                        </AppText>
                      </View>
                    ) : null}
                  </Card>
                );
              })}
            </View>
          )}
        </>
      )}

      <ConfirmDialog
        visible={deleteCandidate !== null}
        title="Delete this progress photo?"
        message="This permanently removes the private image and its note. This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Keep photo"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteCandidate(null)}
      />
    </Screen>
  );
}
