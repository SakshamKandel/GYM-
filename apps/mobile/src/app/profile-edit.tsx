import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
} from '../components/ui';
import { reserveImageUpload, toApiError, uploadImageAsset } from '../lib/api/client';
import { syncProfileNow } from '../lib/profileSync';
import { useAuth } from '../state/auth';
import { useProfile } from '../state/profile';

/**
 * /profile-edit — full profile editor (Pack P): avatar photo + display name.
 * Avatar reuses the SAME direct-to-Cloudinary handshake as the coach profile
 * photo (`reserveImageUpload` → `uploadImageAsset`), under the
 * `application_avatar` kind — the one image kind already open to ANY
 * signed-in member (apps/web/src/app/api/uploads/image/route.ts), not just
 * coaches. The result is stored in the LOCAL profile blob's `avatarUrl`
 * field and pushed immediately via `syncProfileNow()` (same whole-blob
 * `PUT /api/profile` profileSync already uses), so it survives a reinstall.
 *
 * Email/phone change is intentionally NOT here: there is no account
 * email/phone-change route in this backend yet (only sign-in identity),
 * so promising an editable field with nowhere for it to go would be a
 * silent-failure trap (CLAUDE.md rule 5's spirit) — the email row below is
 * read-only with a route to Support instead.
 */

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export default function ProfileEditScreen() {
  const token = useAuth((s) => s.token);
  const authUser = useAuth((s) => s.user);
  const displayName = useProfile((s) => s.displayName);
  const avatarUrl = useProfile((s) => s.avatarUrl);
  const update = useProfile((s) => s.update);

  const [nameDraft, setNameDraft] = useState(displayName);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }

  async function pickAvatar(): Promise<void> {
    if (!token || avatarUploading) return;
    setAvatarError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setAvatarError('Allow photo library access in Settings to change your photo.');
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
    if (typeof asset.fileSize === 'number' && asset.fileSize > MAX_PHOTO_BYTES) {
      setAvatarError('That photo is too large — pick one under 10 MB.');
      return;
    }

    setAvatarUploading(true);
    try {
      const reservation = await reserveImageUpload(token, 'application_avatar');
      if (!reservation.deliveryUrl) throw new Error('missing_delivery_url');
      const ext = /\.(\w{2,4})$/.exec(asset.uri)?.[1] ?? 'jpg';
      await uploadImageAsset(reservation, {
        uri: asset.uri,
        name: asset.fileName ?? `avatar.${ext}`,
        type: asset.mimeType ?? 'image/jpeg',
      });
      update({ avatarUrl: reservation.deliveryUrl });
      syncProfileNow();
    } catch (err) {
      const e = toApiError(err);
      setAvatarError(
        e.code === 'image_not_configured'
          ? 'Photo uploads are not set up yet.'
          : "Couldn't update your photo. Try again.",
      );
    } finally {
      setAvatarUploading(false);
    }
  }

  function removeAvatar(): void {
    if (avatarUploading || !avatarUrl) return;
    update({ avatarUrl: null });
    syncProfileNow();
  }

  function save(): void {
    const trimmed = nameDraft.trim();
    if (trimmed) update({ displayName: trimmed });
    syncProfileNow();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Screen scroll keyboardAware>
      <Animated.View entering={enterDown()} style={styles.backRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={goBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>

      <ScreenHeader eyebrow="Your account" title="Edit profile" style={styles.header} />

      <Animated.View entering={enterUp(0)} style={styles.avatarSection}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={avatarUrl ? 'Change profile photo' : 'Add profile photo'}
          onPress={() => void pickAvatar()}
          disabled={avatarUploading}
          style={styles.avatarWrap}
        >
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImg} contentFit="cover" />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <AppText variant="display" color={colors.textFaint}>
                {(nameDraft.trim() || 'A').charAt(0).toUpperCase()}
              </AppText>
            </View>
          )}
          {avatarUploading ? (
            <View style={styles.avatarOverlay}>
              <ActivityIndicator color={colors.onBlock} />
            </View>
          ) : (
            <View style={styles.avatarBadge}>
              <Ionicons name="camera" size={16} color={colors.onBlock} />
            </View>
          )}
        </PressableScale>
        <View style={styles.avatarActions}>
          <Button
            label={avatarUrl ? 'Change photo' : 'Add photo'}
            variant="secondary"
            onPress={() => void pickAvatar()}
            disabled={avatarUploading}
          />
          {avatarUrl && !avatarUploading ? (
            <Button label="Remove" variant="secondary" onPress={removeAvatar} />
          ) : null}
        </View>
        {avatarError ? (
          <AppText variant="caption" color={colors.error} center>
            {avatarError}
          </AppText>
        ) : null}
      </Animated.View>

      <Animated.View entering={enterUp(1)}>
        <SectionLabel>Name</SectionLabel>
        <AppTextInput
          value={nameDraft}
          onChangeText={setNameDraft}
          placeholder="Your name"
          maxLength={24}
          accessibilityLabel="Your name"
        />
      </Animated.View>

      {authUser?.email ? (
        <Animated.View entering={enterUp(2)} style={styles.readOnlyBlock}>
          <SectionLabel>Email</SectionLabel>
          <AppText variant="body" color={colors.textDim}>
            {authUser.email}
          </AppText>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Contact support to change your email"
            onPress={() => router.push('/support')}
          >
            <AppText variant="caption" color={colors.accent} style={styles.emailChangeLink}>
              Need to change it? Contact support.
            </AppText>
          </PressableScale>
        </Animated.View>
      ) : null}

      <Animated.View entering={enterUp(3)} style={styles.saveRow}>
        <Button label={saved ? 'Saved' : 'Save changes'} onPress={save} disabled={!nameDraft.trim()} />
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  backRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.gutter },
  avatarSection: { alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl },
  avatarWrap: { width: 96, height: 96 },
  avatarImg: { width: 96, height: 96, borderRadius: radius.full, backgroundColor: colors.surface },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarActions: { flexDirection: 'row', gap: spacing.sm },
  readOnlyBlock: { marginTop: spacing.lg },
  emailChangeLink: { marginTop: spacing.xs, minHeight: touch.min, textAlignVertical: 'center' },
  saveRow: { marginTop: spacing.xl, marginBottom: spacing.xl },
});
