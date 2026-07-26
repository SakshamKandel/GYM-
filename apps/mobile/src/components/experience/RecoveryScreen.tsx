import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';

/**
 * The plain screen shown when a part of the app has fallen over.
 *
 * Deliberately assembled from React Native primitives and design tokens ONLY:
 * no shared components, no animation, no image, no data access, no custom font
 * family. This is the screen that has to render at the exact moment everything
 * around it has just thrown, so nothing in it may be able to throw as well. An
 * unregistered font family is one of the few things that can still fail at the
 * native layer, so the system face is used here, and only here.
 */

interface Props {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  /** Optional second way out, shown quietly under the main action. */
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function RecoveryScreen({
  title,
  body,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: Props) {
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <Text style={styles.body}>{body}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
        >
          <Text style={styles.actionLabel}>{actionLabel}</Text>
        </Pressable>
        {secondaryLabel !== undefined && onSecondary !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={secondaryLabel}
            onPress={onSecondary}
            style={styles.secondary}
          >
            <Text style={styles.secondaryLabel}>{secondaryLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: spacing.gutter,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    gap: spacing.md,
    padding: spacing.xxl,
    borderRadius: radius.block,
    backgroundColor: colors.surface,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textDim,
  },
  action: {
    minHeight: touch.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    marginTop: spacing.xs,
  },
  actionPressed: { opacity: 0.8 },
  actionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.onAccent,
  },
  secondary: {
    minHeight: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: {
    fontSize: 16,
    color: colors.textDim,
  },
});
