import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, PressableScale } from '../../../components/ui';
import { disputeReasonLabel } from '../logic';
import { pushPath } from '../nav';
import type { FiledDispute } from './disputeRecord';

/**
 * "You reported this order" — the standing record of a report, on the order it
 * belongs to. Shown from the moment the member files it, so the report never
 * disappears the second the panel closes.
 *
 * It says only what this device can honestly say: what was reported, when, and
 * where the answer will arrive. The decision itself is made by a person and
 * comes back as a notification, so the notice hands the member straight to
 * their notifications instead of naming a status screen that does not exist.
 */

interface Props {
  dispute: FiledDispute;
}

function filedOn(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function DisputeNotice({ dispute }: Props) {
  const date = filedOn(dispute.filedAt);
  const reason = disputeReasonLabel(dispute.reason);

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Ionicons name="flag" size={18} color={colors.warning} />
        <AppText variant="bodyBold" color={colors.warning} style={styles.headline}>
          You reported this order
        </AppText>
      </View>
      <AppText variant="caption" color={colors.textDim}>
        {reason}
        {date ? ` · ${date}` : ''}
      </AppText>
      <AppText variant="caption" color={colors.textDim}>
        Someone is looking at it. We&apos;ll write to you with what we can do, and it lands in your
        notifications.
      </AppText>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Open your notifications"
        onPress={() => pushPath('/notifications')}
        style={styles.btn}
      >
        <AppText variant="bodyBold">Open notifications</AppText>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 3,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headline: { flex: 1, minWidth: 0 },
  btn: {
    marginTop: spacing.sm,
    minHeight: touch.min,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
});
