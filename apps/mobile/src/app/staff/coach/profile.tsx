import { useCallback, useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { COACH_SPECIALTIES } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Chip,
  enterDown,
  enterUp,
  PressableScale,
  SectionLabel,
  Screen,
  ScreenHeader,
  Sheet,
  Stepper,
  Tag,
} from '../../../components/ui';
import { toApiError, reserveImageUpload, uploadImageAsset } from '../../../lib/api/client';
import { useAuth } from '../../../state/auth';
import {
  createCoachTierRequest,
  getCoachProfile,
  getCoachTierRequests,
  updateCoachProfile,
  toStaffError,
  type CoachCertification,
  type CoachProfile,
  type CoachTier,
  type CoachTierRequest,
  type RequestableCoachTier,
} from '../../../features/staff/api';
import { replaceStaff, STAFF_ROUTES } from '../../../features/staff/nav';

/**
 * Coach console — the signed-in coach's own editable profile. displayName, bio,
 * an accepting-clients toggle and the reply-window (hours), plus the member-
 * visible portfolio: headline, years of experience, roster capacity, specialty
 * chips (from the fixed COACH_SPECIALTIES catalog), achievements and
 * certifications list editors. Everything saves through the ONE save flow.
 * Load = spinner, errors = a quiet retry line, and a successful save refetches
 * the fresh row.
 */

/** Reply-window presets (hours) offered as chips; the loaded value is added if
 * it isn't already one of these, so an admin-set custom value is never lost. */
const REPLY_WINDOWS = [12, 24, 48, 72] as const;
const BIO_MAX = 600;
const HEADLINE_MAX = 120;
const SPECIALTIES_MAX = 6;
const ACHIEVEMENT_MAX = 120;
const ACHIEVEMENTS_MAX = 10;
const CERT_FIELD_MAX = 80;
const CERTS_MAX = 10;
const UPGRADE_NOTE_MAX = 300;

const COACH_TIER_LABEL: Record<CoachTier, string> = {
  silver: 'Silver',
  gold: 'Gold',
  elite: 'Elite',
};
const COACH_TIER_COLOR: Record<CoachTier, string> = {
  silver: colors.blue,
  gold: colors.warning,
  elite: colors.accent,
};

/** Tiers ABOVE `current` a coach may request — silver→[gold,elite], gold→[elite], elite→[]. */
function upgradeTargetsFor(current: CoachTier): RequestableCoachTier[] {
  if (current === 'silver') return ['gold', 'elite'];
  if (current === 'gold') return ['elite'];
  return [];
}

interface FormState {
  displayName: string;
  bio: string;
  acceptingClients: boolean;
  replyWindowHours: number;
  headline: string;
  yearsExperience: number;
  capacity: number;
  specialties: string[];
  achievements: string[];
  certifications: CoachCertification[];
}

function toForm(p: CoachProfile): FormState {
  return {
    displayName: p.displayName ?? '',
    bio: p.bio ?? '',
    acceptingClients: p.acceptingClients,
    replyWindowHours: p.replyWindowHours,
    headline: p.headline ?? '',
    yearsExperience: p.yearsExperience,
    capacity: p.capacity,
    specialties: [...p.specialties],
    achievements: [...p.achievements],
    certifications: p.certifications.map((c) => ({ ...c })),
  };
}

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameCerts(a: CoachCertification[], b: CoachCertification[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (c, i) =>
        c.title === b[i].title && c.issuer === b[i].issuer && c.year === b[i].year,
    )
  );
}

function isDirty(a: FormState, b: FormState): boolean {
  return (
    a.displayName.trim() !== b.displayName.trim() ||
    a.bio.trim() !== b.bio.trim() ||
    a.acceptingClients !== b.acceptingClients ||
    a.replyWindowHours !== b.replyWindowHours ||
    a.headline.trim() !== b.headline.trim() ||
    a.yearsExperience !== b.yearsExperience ||
    a.capacity !== b.capacity ||
    !sameStrings(a.specialties, b.specialties) ||
    !sameStrings(a.achievements, b.achievements) ||
    !sameCerts(a.certifications, b.certifications)
  );
}

export default function CoachProfileScreen() {
  const token = useAuth((s) => s.token);
  const [saved, setSaved] = useState<FormState | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Portfolio editor scratch state — drafts live outside the form until Added.
  const [specialtyNote, setSpecialtyNote] = useState(false);
  const [achievementDraft, setAchievementDraft] = useState('');
  const [certDraft, setCertDraft] = useState({ title: '', issuer: '', year: '' });

  // Avatar + coach tier live OUTSIDE FormState — both save/refresh immediately
  // on their own actions rather than through the "Save changes" button.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [coachTier, setCoachTier] = useState<CoachTier>('silver');

  // Tier-upgrade request sheet.
  const [tierRequests, setTierRequests] = useState<CoachTierRequest[]>([]);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeChoice, setUpgradeChoice] = useState<RequestableCoachTier | null>(null);
  const [upgradeNote, setUpgradeNote] = useState('');
  const [upgradeSubmitting, setUpgradeSubmitting] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setLoadError('You are signed out.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setLoading(true);
    try {
      const [profile, requests] = await Promise.all([
        getCoachProfile(token),
        // Secondary data — a failure here must never blank the whole profile.
        getCoachTierRequests(token).catch(() => []),
      ]);
      const next = toForm(profile);
      setSaved(next);
      setForm(next);
      setAvatarUrl(profile.avatarUrl);
      setCoachTier(profile.coachTier);
      setTierRequests(requests);
    } catch (err) {
      const e = toStaffError(err);
      setLoadError(
        e.code === 'forbidden'
          ? "You don't have coach access."
          : e.code === 'unauthorized'
            ? 'Your session expired. Sign in again.'
            : "Couldn't load your profile.",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function patch(next: Partial<FormState>): void {
    setJustSaved(false);
    setSaveError(null);
    setForm((f) => (f ? { ...f, ...next } : f));
  }

  /** Toggle a specialty chip; taps past the max are ignored with a note. */
  function toggleSpecialty(s: string): void {
    if (!form) return;
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
    if (!form || !text || form.achievements.length >= ACHIEVEMENTS_MAX) return;
    patch({ achievements: [...form.achievements, text] });
    setAchievementDraft('');
  }

  function removeAchievement(index: number): void {
    if (!form) return;
    patch({ achievements: form.achievements.filter((_, i) => i !== index) });
  }

  /** Year is optional; when given it must be a plausible 1950–2100 value —
   * mirrors the server's validation so a typo can't fail the whole save. */
  function certYearValue(): { valid: boolean; year: number | null } {
    const text = certDraft.year.trim();
    if (!text) return { valid: true, year: null };
    const year = Number.parseInt(text, 10);
    if (Number.isNaN(year) || year < 1950 || year > 2100) return { valid: false, year: null };
    return { valid: true, year };
  }

  function addCertification(): void {
    if (!form || form.certifications.length >= CERTS_MAX) return;
    const title = certDraft.title.trim();
    const { valid, year } = certYearValue();
    if (!title || !valid) return;
    patch({
      certifications: [
        ...form.certifications,
        { title, issuer: certDraft.issuer.trim(), year },
      ],
    });
    setCertDraft({ title: '', issuer: '', year: '' });
  }

  function removeCertification(index: number): void {
    if (!form) return;
    patch({ certifications: form.certifications.filter((_, i) => i !== index) });
  }

  /**
   * Pick a photo, upload it straight to the image host (uploads/image reserves
   * the slot, uploadImageAsset ships the bytes), then PATCH avatarUrl. Saves
   * immediately — independent of the "Save changes" button below.
   */
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

    setAvatarUploading(true);
    try {
      const reservation = await reserveImageUpload(token, 'coach_avatar');
      if (!reservation.deliveryUrl) throw new Error('missing_delivery_url');
      const ext = /\.(\w{2,4})$/.exec(asset.uri)?.[1] ?? 'jpg';
      await uploadImageAsset(reservation, {
        uri: asset.uri,
        name: asset.fileName ?? `avatar.${ext}`,
        type: asset.mimeType ?? 'image/jpeg',
      });
      const fresh = await updateCoachProfile({ avatarUrl: reservation.deliveryUrl }, token);
      setAvatarUrl(fresh.avatarUrl);
    } catch (err) {
      const e = toApiError(err);
      setAvatarError(
        e.code === 'image_not_configured'
          ? 'Photo uploads are not set up yet.'
          : e.code === 'forbidden'
            ? "You don't have coach access."
            : "Couldn't update your photo. Try again.",
      );
    } finally {
      setAvatarUploading(false);
    }
  }

  const upgradeOptions = useMemo(() => upgradeTargetsFor(coachTier), [coachTier]);
  const pendingUpgrade = tierRequests.find((r) => r.status === 'pending') ?? null;

  function openUpgradeSheet(): void {
    setUpgradeError(null);
    setUpgradeNote('');
    setUpgradeChoice(upgradeOptions[0] ?? null);
    setUpgradeOpen(true);
  }

  async function submitUpgrade(): Promise<void> {
    if (!token || !upgradeChoice || upgradeSubmitting) return;
    setUpgradeSubmitting(true);
    setUpgradeError(null);
    try {
      const id = await createCoachTierRequest(
        upgradeChoice,
        upgradeNote.trim() || undefined,
        token,
      );
      setTierRequests((prev) => [
        {
          id,
          requestedTier: upgradeChoice,
          note: upgradeNote.trim(),
          status: 'pending',
          decidedAt: null,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setUpgradeOpen(false);
    } catch (err) {
      const e = toStaffError(err);
      setUpgradeError(
        e.code === 'already_pending'
          ? 'You already have a pending request.'
          : e.code === 'not_an_upgrade'
            ? "That isn't higher than your current tier."
            : "Couldn't send that request. Try again.",
      );
    } finally {
      setUpgradeSubmitting(false);
    }
  }

  const dirty = form && saved ? isDirty(form, saved) : false;

  async function save(): Promise<void> {
    if (!token || !form || !saved || !dirty || saving) return;
    setSaveError(null);
    setSaving(true);
    try {
      const fresh = await updateCoachProfile(
        {
          displayName: form.displayName.trim(),
          bio: form.bio.trim(),
          acceptingClients: form.acceptingClients,
          replyWindowHours: form.replyWindowHours,
          headline: form.headline.trim(),
          specialties: form.specialties,
          certifications: form.certifications,
          achievements: form.achievements,
          yearsExperience: form.yearsExperience,
          capacity: form.capacity,
        },
        token,
      );
      const next = toForm(fresh);
      setSaved(next);
      setForm(next);
      setJustSaved(true);
    } catch (err) {
      const e = toStaffError(err);
      setSaveError(
        e.code === 'invalid'
          ? 'Some details were rejected. Check the fields and try again.'
          : e.code === 'unauthorized'
            ? 'Your session expired. Sign in again.'
            : "Couldn't save your changes.",
      );
    } finally {
      setSaving(false);
    }
  }

  function goBack(): void {
    replaceStaff(STAFF_ROUTES.coachInbox);
  }

  const windowOptions = form
    ? Array.from(new Set([...REPLY_WINDOWS, form.replyWindowHours])).sort((a, b) => a - b)
    : [...REPLY_WINDOWS];

  return (
    <Screen scroll keyboardAware>
      <Animated.View entering={enterDown()} style={styles.backRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back to clients"
          onPress={goBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>

      <ScreenHeader
        eyebrow="How clients see you"
        title="Profile"
        style={styles.header}
        meta={
          <Tag
            label={COACH_TIER_LABEL[coachTier]}
            variant="outline"
            color={COACH_TIER_COLOR[coachTier]}
          />
        }
      />

      {loading && form === null ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : loadError ? (
        <View style={styles.centerState}>
          <AppText variant="caption" center color={colors.textFaint}>
            {loadError}
          </AppText>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Retry"
            onPress={() => void load()}
            style={styles.retryBtn}
          >
            <AppText variant="bodyBold" color={colors.accent}>
              Try again
            </AppText>
          </PressableScale>
        </View>
      ) : form ? (
        <Animated.View entering={enterUp(0)}>
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
                  Members see this on your coach card.
                </AppText>
              )}
            </View>
          </View>

          {upgradeOptions.length > 0 ? (
            <>
              <SectionLabel>Coach tier</SectionLabel>
              <View style={styles.tierRow}>
                <Tag
                  label={COACH_TIER_LABEL[coachTier]}
                  variant="outline"
                  color={COACH_TIER_COLOR[coachTier]}
                />
                {pendingUpgrade ? (
                  <AppText variant="caption" color={colors.textDim}>
                    {COACH_TIER_LABEL[pendingUpgrade.requestedTier]} upgrade pending review
                  </AppText>
                ) : (
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="Request a tier upgrade"
                    onPress={openUpgradeSheet}
                    style={styles.upgradeLink}
                  >
                    <AppText variant="bodyBold" color={colors.accent}>
                      Request upgrade
                    </AppText>
                    <Ionicons name="chevron-forward" size={16} color={colors.accent} />
                  </PressableScale>
                )}
              </View>
            </>
          ) : null}

          <SectionLabel>Display name</SectionLabel>
          <AppTextInput
            value={form.displayName}
            onChangeText={(t) => patch({ displayName: t })}
            placeholder="Your coaching name"
            autoCapitalize="words"
            returnKeyType="done"
            maxLength={80}
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
            placeholder="Tell clients about your coaching style, focus and experience."
            multiline
            style={styles.bio}
            maxLength={BIO_MAX}
          />
          <AppText variant="caption" color={colors.textFaint} style={styles.counter}>
            {form.bio.trim().length}/{BIO_MAX}
          </AppText>

          <SectionLabel>Accepting new clients</SectionLabel>
          <PressableScale
            accessibilityRole="switch"
            accessibilityState={{ checked: form.acceptingClients }}
            accessibilityLabel="Accepting new clients"
            onPress={() => patch({ acceptingClients: !form.acceptingClients })}
            style={styles.toggleRow}
          >
            <View style={styles.toggleText}>
              <AppText variant="bodyBold">
                {form.acceptingClients ? 'Open to new clients' : 'Not taking clients'}
              </AppText>
              <AppText variant="caption">
                {form.acceptingClients
                  ? 'Admins can assign new members to you.'
                  : 'You are hidden from new assignments.'}
              </AppText>
            </View>
            <View
              style={[styles.switch, form.acceptingClients && styles.switchOn]}
            >
              <View
                style={[styles.knob, form.acceptingClients && styles.knobOn]}
              />
            </View>
          </PressableScale>

          <SectionLabel>Reply window</SectionLabel>
          <AppText variant="caption" style={styles.hint}>
            The response time clients can expect from you.
          </AppText>
          <View style={styles.chips}>
            {windowOptions.map((h) => (
              <Chip
                key={h}
                label={`${h}h`}
                selected={form.replyWindowHours === h}
                onPress={() => patch({ replyWindowHours: h })}
              />
            ))}
          </View>

          <SectionLabel>Experience & capacity</SectionLabel>
          <View style={styles.stepperCard}>
            <Stepper
              label="Years coaching"
              value={form.yearsExperience}
              onChange={(v) => patch({ yearsExperience: v })}
              step={1}
              min={0}
              max={60}
            />
            <Stepper
              label="Roster capacity"
              value={form.capacity}
              onChange={(v) => patch({ capacity: v })}
              step={1}
              min={1}
              max={200}
            />
          </View>
          <AppText variant="caption" color={colors.textFaint} style={styles.noteLine}>
            Capacity caps how many active clients you can accept.
          </AppText>

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

          {saveError ? (
            <AppText variant="caption" color={colors.error} style={styles.saveMsg}>
              {saveError}
            </AppText>
          ) : justSaved && !dirty ? (
            <View style={styles.savedRow}>
              <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              <AppText variant="caption" color={colors.success}>
                Profile saved
              </AppText>
            </View>
          ) : null}

          <Button
            label={saving ? 'Saving…' : 'Save changes'}
            onPress={() => void save()}
            loading={saving}
            disabled={!dirty}
            style={styles.saveBtn}
          />
        </Animated.View>
      ) : null}

      <Sheet
        visible={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        title="Request a tier upgrade"
      >
        <AppText variant="caption" color={colors.textDim} style={styles.upgradeHint}>
          An admin reviews every request — you can have one pending at a time.
        </AppText>
        <View style={styles.chips}>
          {upgradeOptions.map((t) => (
            <Chip
              key={t}
              label={COACH_TIER_LABEL[t]}
              selected={upgradeChoice === t}
              onPress={() => setUpgradeChoice(t)}
            />
          ))}
        </View>
        <AppTextInput
          value={upgradeNote}
          onChangeText={(t) => setUpgradeNote(t.slice(0, UPGRADE_NOTE_MAX))}
          placeholder="Why should we bump your tier? (optional)"
          multiline
          style={styles.upgradeNoteInput}
        />
        {upgradeError ? (
          <AppText variant="caption" color={colors.error} style={styles.upgradeError}>
            {upgradeError}
          </AppText>
        ) : null}
        <Button
          label={upgradeSubmitting ? 'Sending…' : 'Send request'}
          onPress={() => void submitUpgrade()}
          loading={upgradeSubmitting}
          disabled={!upgradeChoice || upgradeSubmitting}
          style={styles.upgradeSubmitBtn}
        />
      </Sheet>
    </Screen>
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
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  upgradeLink: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: touch.min },
  upgradeHint: { marginBottom: spacing.md },
  upgradeNoteInput: {
    marginTop: spacing.md,
    minHeight: 80,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  upgradeError: { marginTop: spacing.sm },
  upgradeSubmitBtn: { marginTop: spacing.lg },
  bio: {
    minHeight: 120,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  counter: { alignSelf: 'flex-end', marginTop: spacing.xs },
  // Borderless charcoal row — separation by fill contrast, never strokes.
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  toggleText: { flex: 1, gap: 2 },
  // Switch track: filled, no stroke; ON = red track with a BLACK knob
  // (black-on-red law applies to controls too).
  switch: {
    width: 52,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surfacePressed,
    padding: 4,
    justifyContent: 'center',
  },
  switchOn: { backgroundColor: colors.accent },
  knob: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: colors.text,
    alignSelf: 'flex-start',
  },
  knobOn: { alignSelf: 'flex-end', backgroundColor: colors.onBlock },
  hint: { marginBottom: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  noteLine: { marginTop: spacing.md },
  // Borderless charcoal tile holding the two portfolio steppers.
  stepperCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  // One achievement/certification row — charcoal block with a trailing ✕.
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
  saveMsg: { marginTop: spacing.lg },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  saveBtn: { marginTop: spacing.xl },
  centerState: {
    marginTop: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  retryBtn: {
    minHeight: touch.min,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
});
