import { useCallback, useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
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
  SectionLabel,
  Screen,
} from '../../../components/ui';
import { useAuth } from '../../../state/auth';
import {
  getCoachProfile,
  updateCoachProfile,
  toStaffError,
  type CoachProfile,
} from '../../../features/staff/api';
import { replaceStaff, STAFF_ROUTES } from '../../../features/staff/nav';

/**
 * Coach console — the signed-in coach's own editable profile. displayName, bio,
 * an accepting-clients toggle and the reply-window (hours). Load = spinner,
 * errors = a quiet retry line, and a successful save refetches the fresh row.
 */

/** Reply-window presets (hours) offered as chips; the loaded value is added if
 * it isn't already one of these, so an admin-set custom value is never lost. */
const REPLY_WINDOWS = [12, 24, 48, 72] as const;
const BIO_MAX = 600;

interface FormState {
  displayName: string;
  bio: string;
  acceptingClients: boolean;
  replyWindowHours: number;
}

function toForm(p: CoachProfile): FormState {
  return {
    displayName: p.displayName ?? '',
    bio: p.bio ?? '',
    acceptingClients: p.acceptingClients,
    replyWindowHours: p.replyWindowHours,
  };
}

function isDirty(a: FormState, b: FormState): boolean {
  return (
    a.displayName.trim() !== b.displayName.trim() ||
    a.bio.trim() !== b.bio.trim() ||
    a.acceptingClients !== b.acceptingClients ||
    a.replyWindowHours !== b.replyWindowHours
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

  const load = useCallback(async () => {
    if (!token) {
      setLoadError('You are signed out.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setLoading(true);
    try {
      const profile = await getCoachProfile(token);
      const next = toForm(profile);
      setSaved(next);
      setForm(next);
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
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back to clients"
          onPress={goBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
        <View style={styles.headerText}>
          <AppText variant="heading">Profile</AppText>
          <AppText variant="caption">How clients see you</AppText>
        </View>
      </Animated.View>

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
          <SectionLabel>Display name</SectionLabel>
          <AppTextInput
            value={form.displayName}
            onChangeText={(t) => patch({ displayName: t })}
            placeholder="Your coaching name"
            autoCapitalize="words"
            returnKeyType="done"
            maxLength={80}
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerText: { flex: 1, gap: 2 },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bio: {
    minHeight: 120,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  counter: { alignSelf: 'flex-end', marginTop: spacing.xs },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  toggleText: { flex: 1, gap: 2 },
  switch: {
    width: 52,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
    justifyContent: 'center',
  },
  switchOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  knob: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: colors.text,
    alignSelf: 'flex-start',
  },
  knobOn: { alignSelf: 'flex-end', backgroundColor: colors.onAccent },
  hint: { marginBottom: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
