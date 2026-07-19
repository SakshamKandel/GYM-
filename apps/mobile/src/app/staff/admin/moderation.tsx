import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Chip,
  ConfirmDialog,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
} from '../../../components/ui';
import {
  getModerationQueue,
  removeModerationItem,
  toStaffError,
  type ModerationItem,
  type ModerationItemType,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { replaceStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Moderation — three-tab member-content queue (milestones /
 * custom-foods / progress photos), gated on `moderation.manage`
 * (ARCHITECTURE-REVIEW §6 NEXT, mobile parity B). Its own route — the nav
 * hub already links here separately from Content (`content.manage` owns
 * the video library only; the two permission keys are independent, per
 * P1-9). Each item removes with a confirm; the list refetches after.
 */

const TABS: { key: ModerationItemType; label: string }[] = [
  { key: 'milestones', label: 'Milestones' },
  { key: 'custom-foods', label: 'Custom foods' },
  { key: 'progress-photos', label: 'Progress photos' },
];

function errorLine(code: StaffErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired — sign in again.';
    case 'forbidden':
      return "You don't have permission to moderate content.";
    case 'not_found':
      return 'That item no longer exists.';
    case 'not_configured':
      return "Custom food moderation isn't built yet — check back in a future update.";
    default:
      return "Couldn't reach the server. Check your connection and retry.";
  }
}

function ModerationRow({
  item,
  kind,
  busy,
  onRemovePress,
}: {
  item: ModerationItem;
  kind: ModerationItemType;
  busy: boolean;
  onRemovePress: () => void;
}) {
  return (
    <View style={styles.row}>
      {kind === 'progress-photos' && item.imageUrl ? (
        <Image source={{ uri: item.imageUrl }} style={styles.thumb} contentFit="cover" transition={100} />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <Ionicons
            name={kind === 'milestones' ? 'trophy-outline' : 'nutrition-outline'}
            size={18}
            color={colors.textFaint}
          />
        </View>
      )}
      <View style={styles.rowText}>
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
        style={[styles.removeBtn, busy && styles.removeBtnDisabled]}
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

export default function AdminModerationScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = staffCan(staffPermissions, 'moderation.manage');

  const [kind, setKind] = useState<ModerationItemType>('milestones');
  const [items, setItems] = useState<ModerationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Separate from the display line so 'not_configured' (an unbuilt route, not
  // a connectivity problem) can hide the Retry affordance — retrying a
  // client-side stub error fails the same way every time.
  const [errorCode, setErrorCode] = useState<StaffErrorCode | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ModerationItem | null>(null);

  const load = useCallback(
    async (k: ModerationItemType) => {
      if (!token) return;
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
    if (allowed) void load(kind);
  }, [allowed, kind, load]);

  async function doRemove(): Promise<void> {
    if (!removeTarget || !token) return;
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

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replaceStaff(STAFF_ROUTES.adminHome);
  }

  if (!allowed || !token) {
    return (
      <Screen>
        <BackRow onBack={goBack} />
        <Animated.View entering={enterUp(0)} style={styles.locked}>
          <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textFaint}>
            Only a moderator, main admin or super admin can review member content.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <BackRow onBack={goBack} />

      <View style={styles.chipRow}>
        {TABS.map((t) => (
          <Chip key={t.key} label={t.label} selected={kind === t.key} onPress={() => setKind(t.key)} />
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <AppText variant="caption" center color={colors.textDim}>
            {error}
          </AppText>
          {errorCode !== 'not_configured' ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Retry"
              onPress={() => void load(kind)}
              style={styles.retry}
            >
              <Ionicons name="refresh" size={15} color={colors.textDim} />
              <AppText variant="caption">Tap to retry.</AppText>
            </PressableScale>
          ) : null}
        </View>
      ) : items.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.empty}>
          Nothing to review here.
        </AppText>
      ) : (
        items.map((item, i) => (
          <Animated.View key={item.id} entering={enterUp(i)}>
            <ModerationRow
              item={item}
              kind={kind}
              busy={busyId === item.id}
              onRemovePress={() => setRemoveTarget(item)}
            />
          </Animated.View>
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
    </Screen>
  );
}

function BackRow({ onBack }: { onBack: () => void }) {
  return (
    <>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>
      <ScreenHeader eyebrow="Admin console" title="Moderation" style={styles.header} />
    </>
  );
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  center: { paddingVertical: spacing.xl, alignItems: 'center', gap: spacing.md },
  retry: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  empty: { paddingVertical: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 64,
    marginBottom: spacing.md,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2, minWidth: 0 },
  removeBtn: {
    width: touch.min,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnDisabled: { opacity: 0.4 },
});
