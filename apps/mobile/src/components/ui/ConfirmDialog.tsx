import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { warnHaptic } from '../../lib/haptics';
import { AppText } from './AppText';
import { Button } from './Button';

/**
 * Branded yes/no popup — replaces system alerts (which look foreign on
 * Android and don't render at all on web). Charcoal card, one question,
 * two pill buttons. Backdrop tap = cancel.
 */
interface Props {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive styling for the confirm button. */
  danger?: boolean;
  /** Info mode: single OK-style button (confirm only). */
  hideCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 330,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  btn: { flex: 1 },
});

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Yes',
  cancelLabel = 'No',
  danger = false,
  hideCancel = false,
  onConfirm,
  onCancel,
}: Props) {
  // Destructive prompts get a physical warning the moment they appear —
  // the same cue used elsewhere for errors/irreversible actions.
  useEffect(() => {
    if (visible && danger) warnHaptic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, danger]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
      <Animated.View entering={FadeIn.duration(120)} style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="Dismiss">
          <Animated.View entering={FadeIn.duration(120)}>
            {/* Stop backdrop presses from falling through the card. */}
            <Pressable onPress={() => undefined} style={styles.card}>
              <AppText variant="title">{title}</AppText>
              {message ? (
                <AppText variant="body" color={colors.textDim}>
                  {message}
                </AppText>
              ) : null}
              <View style={styles.buttons}>
                {hideCancel ? null : (
                  <Button
                    label={cancelLabel}
                    variant="secondary"
                    style={styles.btn}
                    onPress={onCancel}
                  />
                )}
                <Button
                  label={confirmLabel}
                  variant={danger ? 'danger' : 'primary'}
                  style={styles.btn}
                  onPress={onConfirm}
                />
              </View>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}
