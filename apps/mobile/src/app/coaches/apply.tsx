import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { COACH_SPECIALTIES } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Chip,
  EmptyState,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Stepper,
} from '../../components/ui';
import { reserveImageUpload, toApiError, uploadImageAsset } from '../../lib/api/client';
import {
  submitCoachApplication,
  toMentorshipError,
  type CoachApplication,
  type CoachCertification,
} from '../../features/mentorship/api';
import { useMyCoachApplication } from '../../features/mentorship/hooks';
import { pushPath } from '../../features/mentorship/nav';
import { pushStaff, STAFF_ROUTES } from '../../features/staff/nav';
import { useAuth } from '../../state/auth';

/**
 * /coaches/apply — self-serve coach enrollment (SCALE-UP-PLAN §1.4 / §4.2).
 * One open (pending) application per account; the form itself mirrors the
 * coach console's own profile editor (staff/coach/profile.tsx) so the fields
 * feel familiar once approved.
 *
 * States (driven by GET /api/coach-applications, any status):
 *  - none yet          → the form, blank.
 *  - pending            → a quiet "under review" card, no form.
 *  - rejected           → the reviewer's note + "Edit & reapply" reopens the
 *                         form prefilled with the rejected submission.
 *  - approved           → success card + "Open coach console" link.
 */

const HEADLINE_MAX = 120;
const BIO_MAX = 2000;
const SPECIALTIES_MAX = 6;
const ACHIEVEMENT_MAX = 120;
const ACHIEVEMENTS_MAX = 10;
const CERT_FIELD_MAX = 80;
const CERTS_MAX = 10;
const DISPLAY_NAME_MAX = 80;

interface FormState {
  displayName: string;
  headline: string;
  bio: string;
  yearsExperience: number;
  specialties: string[];
  achievements: string[];
  certifications: CoachCertification[];
}

const EMPTY_FORM: FormState = {
  displayName: '',
  headline: '',
  bio: '',
  yearsExperience: 0,
  specialties: [],
  achievements: [],
  certifications: [],
};

function fromApplication(a: CoachApplication): FormState {
  return {
    displayName: a.displayName,
    headline: a.headline,
    bio: a.bio,
    yearsExperience: a.yearsExperience,
    specialties: [...a.specialties],
    achievements: [...a.achievements],
    certifications: a.certifications.map((c) => ({ ...c })),
  };
}

export default function CoachApplyScreen() {
  const authStatus = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);
  const { application, loaded, error: loadError, reload, setApplication } =
    useMyCoachApplication();

  // Lazy-seed the display name from the account for a brand-new application —
  // `user` is a persisted store read synchronously at mount, so no effect is
  // needed. A reapply overwrites this entirely via fromApplication() instead.
  const [form, setForm] = useState<FormState>(() => ({
    ...EMPTY_FORM,
    displayName: user?.displayName?.trim() ?? '',
  }));
  const [reapplying, setReapplying] = useState(false);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [achievementDraft, setAchievementDraft] = useState('');
  const [certDraft, setCertDraft] = useState({ title: '', issuer: '', year: '' });
  const [specialtyNote, setSpecialtyNote] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function patch(next: Partial<FormState>): void {
    setSubmitError(null);
    setForm((f) => ({ ...f, ...next }));
  }

  function toggleSpecialty(s: string): void {
    if (form.specialties.includes(s)) {
      setSpecialtyNote(false);
      patch({ specialties: form.specialties.filter((v) => v !== s) });
    } else if (form.specialties.length >= SPECIALTIES_MAX) {
      setSpecialtyNote(true);
    } else {
      setSpecialtyNote(false);
      patch({ specialties: [...form.specialties, s] });
    }
  }

  function addAchievement(): void {
    const text = achievementDraft.trim().slice(0, ACHIEVEMENT_MAX);
    if (!text || form.achievements.length >= ACHIEVEMENTS_MAX) return;
    patch({ achievements: [...form.achievements, text] });
    setAchievementDraft('');
  }

  function removeAchievement(index: number): void {
    patch({ achievements: form.achievements.filter((_, i) => i !== index) });
  }

  function certYearValue(): { valid: boolean; year: number | null } {
    const text = certDraft.year.trim();
    if (!text) return { valid: true, year: null };
    const year = Number.parseInt(text, 10);
    if (Number.isNaN(year) || year < 1950 || year > 2100) return { valid: false, year: null };
    return { valid: true, year };
  }

  function addCertification(): void {
    if (form.certifications.length >= CERTS_MAX) return;
    const title = certDraft.title.trim();
    const { valid, year } = certYearValue();
    if (!title || !valid) return;
    patch({
      certifications: [...form.certifications, { title, issuer: certDraft.issuer.trim(), year }],
    });
    setCertDraft({ title: '', issuer: '', year: '' });
  }

  function removeCertification(index: number): void {
    patch({ certifications: form.certifications.filter((_, i) => i !== index) });
  }

  async function pickAvatar(): Promise<void> {
    if (!token || avatarUploading) return;
    setAvatarError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setAvatarError('Allow photo library access in Settings to add a photo.');
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
      setAvatarUrl(reservation.deliveryUrl);
    } catch (err) {
      const code = toApiError(err).code;
      setAvatarError(
        code === 'image_not_configured'
          ? 'Photo uploads are not set up yet.'
          : "Couldn't upload your photo. Try again.",
      );
    } finally {
      setAvatarUploading(false);
    }
  }

  function startReapply(): void {
    if (!application) return;
    setForm(fromApplication(application));
    setAvatarUrl(application.avatarUrl);
    setSubmitError(null);
    setReapplying(true);
  }

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/coaches');
  }

  const canSubmit =
    form.displayName.trim().length > 0 && form.bio.trim().length > 0 && !submitting;

  async function submit(): Promise<void> {
    if (!token || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const submittedDisplayName = form.displayName.trim();
      const submittedHeadline = form.headline.trim();
      const submittedBio = form.bio.trim();
      const created = await submitCoachApplication(
        {
          displayName: submittedDisplayName,
          headline: submittedHeadline,
          bio: submittedBio,
          yearsExperience: form.yearsExperience,
          specialties: form.specialties,
          certifications: form.certifications,
          achievements: form.achievements,
          ...(avatarUrl ? { avatarUrl } : {}),
        },
        token,
      );
      // The 201 itself is the confirmation — set the local snapshot straight
      // from what was just submitted rather than waiting on a follow-up GET.
      // A flaky refetch right after a resubmit must never fall back to the
      // OLD (rejected) snapshot and look like the submit silently failed.
      setApplication({
        id: created.id,
        status: created.status,
        reviewNote: null,
        createdAt: new Date().toISOString(),
        decidedAt: null,
        displayName: submittedDisplayName,
        headline: submittedHeadline,
        bio: submittedBio,
        yearsExperience: form.yearsExperience,
        specialties: form.specialties,
        certifications: form.certifications,
        achievements: form.achievements,
        avatarUrl: avatarUrl ?? null,
      });
      setReapplying(false);
      // Best-effort background refresh for eventual full consistency
      // (server-side PII masking, etc.) — the confirmation above no longer
      // depends on this succeeding.
      reload();
    } catch (err) {
      const code = toMentorshipError(err).code;
      setSubmitError(
        code === 'already_open'
          ? 'You already have an application under review.'
          : code === 'already_coach'
            ? "You're already a coach."
            : code === 'already_staff'
              ? 'Staff accounts cannot apply to become a coach.'
              : code === 'unauthorized'
                ? 'Your session expired — sign in again.'
                : "Couldn't submit that — check the fields and try again.",
      );
      if (code === 'already_open' || code === 'already_coach' || code === 'already_staff') {
        setReapplying(false);
        reload();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (authStatus !== 'signedIn') {
    return (
      <Screen scroll>
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
        <EmptyState
          icon="ribbon"
          title="Sign in to apply"
          body="Coach applications need a signed-in account."
          actionLabel="Sign in"
          onAction={() => pushPath('/auth/sign-in')}
        />
      </Screen>
    );
  }

  const showForm = application === null || reapplying;

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

      <ScreenHeader eyebrow="Coach the community" title="Become a coach" style={styles.header} />

      {!loaded && loadError ? (
        <Animated.View entering={enterUp(0)}>
          <EmptyState
            icon="cloud-offline"
            title="Couldn't load"
            body="Check your connection and try again."
            actionLabel="Retry"
            onAction={reload}
          />
        </Animated.View>
      ) : !loaded ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : !showForm && application ? (
        <Animated.View entering={enterUp(0)}>
          <StatusCard application={application} onReapply={startReapply} />
        </Animated.View>
      ) : (
        <Animated.View entering={enterUp(0)}>
          {application?.status === 'rejected' ? (
            <View style={styles.reapplyBanner}>
              <Ionicons name="refresh" size={16} color={colors.textDim} />
              <AppText variant="caption" color={colors.textDim} style={styles.reapplyText}>
                Editing your previous application — resubmitting sends it for review again.
              </AppText>
            </View>
          ) : null}

          <SectionLabel>Photo</SectionLabel>
          <View style={styles.avatarRow}>
            <View style={styles.avatarWrap}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImg} contentFit="cover" />
              ) : (
                <View style={styles.avatarFallback}>
                  <Ionicons name="person" size={32} color={colors.textDim} />
                </View>
              )}
              {avatarUploading ? (
                <View style={styles.avatarOverlay}>
                  <ActivityIndicator color={colors.onBlock} />
                </View>
              ) : null}
            </View>
            <View style={styles.avatarText}>
              <Button
                label={avatarUrl ? 'Change photo' : 'Add photo'}
                variant="secondary"
                onPress={() => void pickAvatar()}
                disabled={avatarUploading}
                loading={avatarUploading}
              />
              {avatarError ? (
                <AppText variant="caption" color={colors.error} style={styles.avatarErrorText}>
                  {avatarError}
                </AppText>
              ) : (
                <AppText variant="caption" color={colors.textFaint} style={styles.avatarErrorText}>
                  Optional — you can add this later too.
                </AppText>
              )}
            </View>
          </View>

          <SectionLabel>Display name</SectionLabel>
          <AppTextInput
            value={form.displayName}
            onChangeText={(t) => patch({ displayName: t.slice(0, DISPLAY_NAME_MAX) })}
            placeholder="Your coaching name"
            autoCapitalize="words"
            returnKeyType="done"
            maxLength={DISPLAY_NAME_MAX}
            accessibilityLabel="Display name"
          />

          <SectionLabel>Headline</SectionLabel>
          <AppTextInput
            value={form.headline}
            onChangeText={(t) => patch({ headline: t.slice(0, HEADLINE_MAX) })}
            placeholder="One line members see first, e.g. Strength coach for busy lifters"
            returnKeyType="done"
            maxLength={HEADLINE_MAX}
            accessibilityLabel="Headline"
          />

          <SectionLabel>Bio</SectionLabel>
          <AppTextInput
            value={form.bio}
            onChangeText={(t) => patch({ bio: t.slice(0, BIO_MAX) })}
            placeholder="Tell us about your coaching style, focus and experience."
            multiline
            style={styles.bio}
            maxLength={BIO_MAX}
            accessibilityLabel="Bio"
          />
          <AppText variant="caption" color={colors.textFaint} style={styles.counter}>
            {form.bio.trim().length}/{BIO_MAX}
          </AppText>

          <SectionLabel>Experience</SectionLabel>
          <View style={styles.stepperCard}>
            <Stepper
              label="Years coaching"
              value={form.yearsExperience}
              onChange={(v) => patch({ yearsExperience: v })}
              step={1}
              min={0}
              max={60}
            />
          </View>

          <SectionLabel>Specialties</SectionLabel>
          <AppText variant="caption" style={styles.hint}>
            Pick up to {SPECIALTIES_MAX} — members filter coaches by these.
          </AppText>
          <View style={styles.chips}>
            {COACH_SPECIALTIES.map((s) => (
              <Chip
                key={s}
                label={s}
                selected={form.specialties.includes(s)}
                onPress={() => toggleSpecialty(s)}
              />
            ))}
          </View>
          {specialtyNote ? (
            <AppText variant="caption" color={colors.textDim} style={styles.noteLine}>
              That&apos;s the limit of {SPECIALTIES_MAX} — deselect one to swap it.
            </AppText>
          ) : null}

          <SectionLabel>Achievements</SectionLabel>
          {form.achievements.map((a, i) => (
            <View key={`${i}-${a}`} style={styles.editRow}>
              <AppText variant="body" numberOfLines={2} style={styles.editRowText}>
                {a}
              </AppText>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Remove achievement: ${a}`}
                onPress={() => removeAchievement(i)}
                style={styles.removeBtn}
              >
                <Ionicons name="close" size={18} color={colors.textDim} />
              </PressableScale>
            </View>
          ))}
          {form.achievements.length < ACHIEVEMENTS_MAX ? (
            <View style={styles.addRow}>
              <AppTextInput
                value={achievementDraft}
                onChangeText={setAchievementDraft}
                placeholder="e.g. Coached 3 national qualifiers"
                maxLength={ACHIEVEMENT_MAX}
                returnKeyType="done"
                onSubmitEditing={addAchievement}
                style={styles.addInput}
                accessibilityLabel="New achievement"
              />
              <Button
                label="Add"
                variant="secondary"
                onPress={addAchievement}
                disabled={!achievementDraft.trim()}
              />
            </View>
          ) : (
            <AppText variant="caption" color={colors.textFaint} style={styles.noteLine}>
              Max {ACHIEVEMENTS_MAX} achievements — remove one to add another.
            </AppText>
          )}

          <SectionLabel>Certifications</SectionLabel>
          {form.certifications.map((c, i) => (
            <View key={`${i}-${c.title}`} style={styles.editRow}>
              <View style={styles.editRowText}>
                <AppText variant="bodyBold" numberOfLines={1}>
                  {c.title}
                </AppText>
                {c.issuer || c.year !== null ? (
                  <AppText variant="caption" numberOfLines={1}>
                    {[c.issuer, c.year !== null ? String(c.year) : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </AppText>
                ) : null}
              </View>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Remove certification: ${c.title}`}
                onPress={() => removeCertification(i)}
                style={styles.removeBtn}
              >
                <Ionicons name="close" size={18} color={colors.textDim} />
              </PressableScale>
            </View>
          ))}
          {form.certifications.length < CERTS_MAX ? (
            <View style={styles.certForm}>
              <AppTextInput
                value={certDraft.title}
                onChangeText={(t) => setCertDraft((d) => ({ ...d, title: t }))}
                placeholder="Certification, e.g. CSCS"
                maxLength={CERT_FIELD_MAX}
                accessibilityLabel="Certification title"
              />
              <View style={styles.addRow}>
                <AppTextInput
                  value={certDraft.issuer}
                  onChangeText={(t) => setCertDraft((d) => ({ ...d, issuer: t }))}
                  placeholder="Issuer, e.g. NSCA"
                  maxLength={CERT_FIELD_MAX}
                  style={styles.addInput}
                  accessibilityLabel="Certification issuer"
                />
                <AppTextInput
                  value={certDraft.year}
                  onChangeText={(t) =>
                    setCertDraft((d) => ({
                      ...d,
                      year: t.replace(/[^0-9]/g, '').slice(0, 4),
                    }))
                  }
                  placeholder="Year"
                  keyboardType="number-pad"
                  maxLength={4}
                  style={styles.yearInput}
                  accessibilityLabel="Certification year (optional)"
                />
              </View>
              {!certYearValue().valid ? (
                <AppText variant="caption" color={colors.error}>
                  Year must be between 1950 and 2100.
                </AppText>
              ) : null}
              <Button
                label="Add certification"
                variant="secondary"
                onPress={addCertification}
                disabled={!certDraft.title.trim() || !certYearValue().valid}
              />
            </View>
          ) : (
            <AppText variant="caption" color={colors.textFaint} style={styles.noteLine}>
              Max {CERTS_MAX} certifications — remove one to add another.
            </AppText>
          )}

          {submitError ? (
            <AppText variant="caption" color={colors.error} style={styles.submitMsg}>
              {submitError}
            </AppText>
          ) : null}

          <Button
            label={submitting ? 'Submitting…' : reapplying ? 'Resubmit application' : 'Submit application'}
            onPress={() => void submit()}
            loading={submitting}
            disabled={!canSubmit}
            style={styles.submitBtn}
          />
        </Animated.View>
      )}
    </Screen>
  );
}

function StatusCard({
  application,
  onReapply,
}: {
  application: CoachApplication;
  onReapply: () => void;
}) {
  if (application.status === 'approved') {
    return (
      <View style={styles.statusCard}>
        <View style={styles.statusHeader}>
          <Ionicons name="checkmark-circle" size={20} color={colors.success} />
          <AppText variant="bodyBold">You&apos;re a coach!</AppText>
        </View>
        <AppText variant="caption" color={colors.textDim}>
          Your application was approved. Open the coach console to set up your roster and
          share your promo code.
        </AppText>
        <Button
          label="Open coach console"
          variant="secondary"
          onPress={() => pushStaff(STAFF_ROUTES.coachInbox)}
          style={styles.statusBtn}
        />
      </View>
    );
  }

  if (application.status === 'rejected') {
    return (
      <View style={styles.statusCard}>
        <View style={styles.statusHeader}>
          <Ionicons name="close-circle" size={20} color={colors.error} />
          <AppText variant="bodyBold">Application not approved</AppText>
        </View>
        <AppText variant="caption" color={colors.textDim}>
          {application.reviewNote?.trim()
            ? application.reviewNote
            : "You're welcome to update your details and try again."}
        </AppText>
        <Button
          label="Edit & reapply"
          variant="secondary"
          onPress={onReapply}
          style={styles.statusBtn}
        />
      </View>
    );
  }

  // pending
  return (
    <View style={styles.statusCard}>
      <View style={styles.statusHeader}>
        <Ionicons name="time-outline" size={20} color={colors.warning} />
        <AppText variant="bodyBold">Application under review</AppText>
      </View>
      <AppText variant="caption" color={colors.textDim}>
        We&apos;ll let you know once an admin has reviewed it — usually within a few days.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  backRow: { marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.sm },
  centerState: {
    marginTop: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  // ── Status card (pending/rejected/approved) ──
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.sm,
  },
  statusHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusBtn: { marginTop: spacing.md },
  reapplyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: touch.min,
    marginBottom: spacing.md,
  },
  reapplyText: { flex: 1 },
  // ── Form (mirrors staff/coach/profile.tsx) ──
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginBottom: spacing.sm },
  avatarWrap: { width: 72, height: 72 },
  avatarImg: { width: 72, height: 72, borderRadius: radius.full, backgroundColor: colors.surfaceRaised },
  avatarFallback: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOverlay: {
    // absoluteFillObject spelled out — RN 0.86 types no longer export it.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { flex: 1, gap: spacing.xs, alignItems: 'flex-start' },
  avatarErrorText: { marginTop: 2 },
  bio: {
    minHeight: 120,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  counter: { alignSelf: 'flex-end', marginTop: spacing.xs },
  hint: { marginBottom: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  noteLine: { marginTop: spacing.md },
  stepperCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    minHeight: touch.min,
    marginBottom: spacing.sm,
  },
  editRowText: { flex: 1, gap: 2 },
  removeBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRow: { flexDirection: 'row', gap: spacing.sm },
  addInput: { flex: 1 },
  yearInput: { width: 96 },
  certForm: { gap: spacing.sm },
  submitMsg: { marginTop: spacing.lg },
  submitBtn: { marginTop: spacing.xl },
});
