import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, AppTextInput, Button, PressableScale, SectionLabel } from '../../components/ui';
import { successHaptic } from '../../lib/haptics';
import {
  getClientNote,
  saveClientNote,
  toStaffError,
  type StaffErrorCode,
} from './api';

/**
 * Coach console · client screen — the coach's own private note about a client.
 *
 * One note per coach per client, never shown to the member and never shown to
 * another coach: the server scopes every read and write to the signed-in
 * coach. It existed only on the web console, so a coach working from a phone
 * couldn't read what they had written at a desk, let alone add to it.
 *
 * Contact details are taken out before the note is stored (the same rule that
 * binds every other line a coach types), and the saved text comes back from
 * the server, so what shows here after a save is exactly what was kept.
 */

const NOTE_MAX_LEN = 4000;

function errorLine(code: StaffErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired. Sign in again.';
    case 'forbidden':
      return 'This client is no longer assigned to you.';
    case 'invalid':
      return 'That note is too long. Shorten it and try again.';
    default:
      return "Couldn't reach the server. Check your connection and retry.";
  }
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** ISO stamp → "12 Mar 2026". Empty when unparseable. */
function formatDay(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''} ${d.getFullYear()}`;
}

export function ClientNotesSection({
  userId,
  token,
  /** Hidden entirely without `coach.message.user` — the write key the server enforces. */
  canWrite,
}: {
  userId: string;
  token: string | null;
  canWrite: boolean;
}) {
  const [draft, setDraft] = useState('');
  /** The last text the server confirmed, so "unsaved" is honest. */
  const [saved, setSaved] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  /** True when the server stored something different from what was typed. */
  const [contactHidden, setContactHidden] = useState(false);

  const load = useCallback(async () => {
    if (!token || !userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const row = await getClientNote(userId, token);
      setDraft(row.note);
      setSaved(row.note);
      setUpdatedAt(row.updatedAt);
    } catch (err) {
      setLoadError(errorLine(toStaffError(err).code));
    } finally {
      setLoading(false);
    }
  }, [token, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!token || !userId || saving) return;
    setSaving(true);
    setSaveError(null);
    setJustSaved(false);
    try {
      const typed = draft.trim();
      const row = await saveClientNote(userId, typed, token);
      successHaptic();
      setDraft(row.note);
      setSaved(row.note);
      setUpdatedAt(row.updatedAt);
      setContactHidden(row.note !== typed);
      setJustSaved(true);
    } catch (err) {
      setSaveError(errorLine(toStaffError(err).code));
    } finally {
      setSaving(false);
    }
  }, [token, userId, saving, draft]);

  const dirty = draft !== saved;

  return (
    <>
      <SectionLabel>Private note</SectionLabel>

      {loading ? (
        <View style={styles.quiet}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : loadError ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Retry loading your note"
          onPress={() => void load()}
          style={styles.quiet}
        >
          <AppText variant="caption" color={colors.textDim}>
            {loadError} Tap to retry.
          </AppText>
        </PressableScale>
      ) : canWrite ? (
        <View style={styles.form}>
          <AppText variant="caption" color={colors.textFaint}>
            Only you can see this. Your client never does.
          </AppText>
          <AppTextInput
            value={draft}
            onChangeText={(v) => {
              setDraft(v);
              setJustSaved(false);
              setContactHidden(false);
            }}
            placeholder="What to remember about this client"
            multiline
            maxLength={NOTE_MAX_LEN}
            editable={!saving}
            style={styles.input}
            accessibilityLabel="Private note about this client"
          />
          {saveError ? (
            <AppText variant="caption" color={colors.error}>
              {saveError}
            </AppText>
          ) : null}
          {contactHidden ? (
            <AppText variant="caption" color={colors.textDim}>
              Saved, but we hid the contact details in it. Coaching stays in the app.
            </AppText>
          ) : null}
          {justSaved && !dirty && !contactHidden ? (
            <AppText variant="caption" color={colors.textDim}>
              Saved{updatedAt ? ` · ${formatDay(updatedAt)}` : ''}.
            </AppText>
          ) : !dirty && updatedAt ? (
            <AppText variant="caption" color={colors.textFaint}>
              Last written {formatDay(updatedAt)}.
            </AppText>
          ) : null}
          <Button
            label={saving ? 'Saving…' : 'Save note'}
            variant="secondary"
            onPress={() => void save()}
            loading={saving}
            disabled={saving || !dirty}
          />
        </View>
      ) : saved ? (
        <View style={styles.readOnly}>
          <AppText variant="body">{saved}</AppText>
          {updatedAt ? (
            <AppText variant="label" color={colors.textFaint}>
              Last written {formatDay(updatedAt)}
            </AppText>
          ) : null}
        </View>
      ) : (
        <View style={styles.lockedRow}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.textDim} />
          <AppText variant="caption" color={colors.textDim} style={styles.lockedText}>
            You don&apos;t have permission to write notes about clients.
          </AppText>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  quiet: {
    minHeight: touch.min,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  form: { gap: spacing.sm },
  input: { minHeight: 112, paddingTop: spacing.md, textAlignVertical: 'top' },
  readOnly: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  lockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: touch.min,
  },
  lockedText: { flex: 1 },
});
