import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  ConfirmDialog,
  PressableScale,
  Sheet,
} from '../../components/ui';
import { successHaptic } from '../../lib/haptics';
import {
  createMessageTemplate,
  deleteMessageTemplate,
  getMessageTemplates,
  toStaffError,
  type MessageTemplate,
  type StaffErrorCode,
} from './api';

/**
 * Coach thread — saved quick replies.
 *
 * A coach answering the same question forty times a day keeps a small library
 * of canned answers. It shipped on the web console and nowhere else, so the
 * same coach on a phone retyped everything.
 *
 * The row above the composer is the fast path: one tap drops a saved reply
 * into the draft, which the coach can then edit before sending (nothing is
 * ever sent straight from a pill). The sheet behind "Manage" is where a reply
 * gets saved or deleted — the delete matters because the library caps at 40,
 * and without a way to remove one the cap is a dead end.
 *
 * Contact details are taken out of a template before it is stored, exactly as
 * they are in a real reply, so a phone number can't be smuggled in through the
 * library.
 */

/** Longest label a pill shows before it trails off. */
const PILL_LABEL_MAX = 28;

function errorLine(code: StaffErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired. Sign in again.';
    case 'forbidden':
      return "You can't manage quick replies.";
    case 'conflict':
      return 'You have 40 quick replies already. Delete one to make room.';
    case 'invalid':
      return "That message can't be saved as a quick reply.";
    default:
      return "Couldn't reach the server. Check your connection and retry.";
  }
}

/** The words shown on a pill: the title if there is one, else the opening text. */
function pillLabel(t: MessageTemplate): string {
  const title = t.title.trim();
  if (title) return title;
  const body = t.body.trim().replace(/\s+/g, ' ');
  return body.length > PILL_LABEL_MAX ? `${body.slice(0, PILL_LABEL_MAX)}…` : body;
}

export function QuickReplies({
  token,
  /** The composer's current text — what "Save this message" would store. */
  draft,
  /** Called with the template body; the screen decides how to merge it in. */
  onInsert,
}: {
  token: string | null;
  draft: string;
  onInsert: (body: string) => void;
}) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MessageTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmed = draft.trim();

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setTemplates(await getMessageTemplates(token));
    } catch {
      // Quick replies are a convenience — a load failure just leaves the row
      // empty rather than putting an error above the coach's keyboard.
    } finally {
      setLoaded(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveCurrent = useCallback(async () => {
    if (!token || saving || trimmed.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createMessageTemplate({ body: trimmed }, token);
      successHaptic();
      setTemplates((prev) => [created, ...prev]);
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
    } finally {
      setSaving(false);
    }
  }, [token, saving, trimmed]);

  const confirmDelete = useCallback(async () => {
    if (!token || !deleteTarget || deletingId) return;
    const target = deleteTarget;
    setDeletingId(target.id);
    setError(null);
    try {
      await deleteMessageTemplate(target.id, token);
      setTemplates((prev) => prev.filter((t) => t.id !== target.id));
      setDeleteTarget(null);
    } catch (err) {
      const code = toStaffError(err).code;
      // Already gone is the same outcome as a delete — drop it either way.
      if (code === 'not_found') {
        setTemplates((prev) => prev.filter((t) => t.id !== target.id));
        setDeleteTarget(null);
      } else {
        setDeleteTarget(null);
        setError(errorLine(code));
      }
    } finally {
      setDeletingId(null);
    }
  }, [token, deleteTarget, deletingId]);

  // Nothing saved and nothing worth saving: stay out of the way entirely.
  if (!token || (loaded && templates.length === 0 && trimmed.length === 0)) return null;

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.row}
        accessibilityLabel="Quick replies"
      >
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Manage quick replies"
          onPress={() => {
            setError(null);
            setSheetOpen(true);
          }}
          style={styles.manageBtn}
        >
          <Ionicons name="bookmark-outline" size={16} color={colors.accent} />
          <AppText variant="label" color={colors.accent}>
            Quick replies
          </AppText>
        </PressableScale>

        {templates.map((t) => (
          <PressableScale
            key={t.id}
            accessibilityRole="button"
            accessibilityLabel={`Use quick reply: ${pillLabel(t)}`}
            onPress={() => onInsert(t.body)}
            style={styles.pill}
          >
            <AppText variant="label" color={colors.text} numberOfLines={1}>
              {pillLabel(t)}
            </AppText>
          </PressableScale>
        ))}
      </ScrollView>

      <Sheet
        visible={sheetOpen}
        onClose={() => {
          if (!saving && !deletingId) setSheetOpen(false);
        }}
        title="Quick replies"
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.sheetScroll}
        >
          <AppText variant="caption" color={colors.textDim}>
            Tap one to drop it into your message. You can still change the words before you send.
          </AppText>

          {error ? (
            <AppText variant="caption" color={colors.error}>
              {error}
            </AppText>
          ) : null}

          {!loaded ? (
            <View style={styles.sheetQuiet}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : templates.length === 0 ? (
            <AppText variant="caption" color={colors.textFaint}>
              You haven&apos;t saved any yet. Type a message, then save it here.
            </AppText>
          ) : (
            <View style={styles.list}>
              {templates.map((t) => (
                <View key={t.id} style={styles.listRow}>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={`Use quick reply: ${pillLabel(t)}`}
                    onPress={() => {
                      onInsert(t.body);
                      setSheetOpen(false);
                    }}
                    style={styles.listText}
                  >
                    <AppText variant="body" numberOfLines={3}>
                      {t.body}
                    </AppText>
                  </PressableScale>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={`Delete quick reply: ${pillLabel(t)}`}
                    onPress={() => setDeleteTarget(t)}
                    style={styles.deleteBtn}
                  >
                    {deletingId === t.id ? (
                      <ActivityIndicator color={colors.textDim} />
                    ) : (
                      <Ionicons name="close" size={20} color={colors.textDim} />
                    )}
                  </PressableScale>
                </View>
              ))}
            </View>
          )}

          <Button
            label={saving ? 'Saving…' : 'Save this message'}
            variant="secondary"
            onPress={() => void saveCurrent()}
            loading={saving}
            disabled={saving || trimmed.length === 0}
            style={styles.saveBtn}
          />
          {trimmed.length === 0 ? (
            <AppText variant="caption" color={colors.textFaint}>
              Type a message first and it will show up here to save.
            </AppText>
          ) : null}
        </ScrollView>
      </Sheet>

      <ConfirmDialog
        visible={deleteTarget !== null}
        title="Delete this quick reply?"
        message={deleteTarget ? `“${pillLabel(deleteTarget)}” goes off your list.` : undefined}
        confirmLabel={deletingId ? 'Deleting…' : 'Delete'}
        cancelLabel="Keep"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (!deletingId) setDeleteTarget(null);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.sm,
  },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: touch.min,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.accentFaint,
  },
  pill: {
    maxWidth: 220,
    minHeight: touch.min,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  sheetScroll: { paddingBottom: spacing.xxl, gap: spacing.md },
  sheetQuiet: { paddingVertical: spacing.lg, alignItems: 'center' },
  list: { gap: spacing.sm },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    minHeight: touch.min,
  },
  listText: { flex: 1, paddingVertical: spacing.md },
  deleteBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtn: { marginTop: spacing.sm },
});
