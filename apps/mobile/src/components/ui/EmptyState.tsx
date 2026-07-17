import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from './AppText';
import { Button } from './Button';

/**
 * Centered, muted empty state: icon in a rounded surface square, a short
 * title, an optional one-line explanation, and an optional action Button.
 * The action defaults to `secondary` — red stays reserved for THE screen CTA.
 *
 * Pass `art` (usually `<EmptyArt variant="…"/>` from components/visual) to
 * replace the icon square with a small illustration — purely decorative,
 * the title/body still carry the meaning.
 */
interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  /** Decorative illustration rendered instead of the icon square. */
  art?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: 'primary' | 'secondary';
  style?: StyleProp<ViewStyle>;
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  iconWrap: {
    width: 64,
    height: 64,
    // Nested-tile radius (brief §3) — matches IconChip's rounded square.
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  body: { maxWidth: 300 },
  action: { marginTop: spacing.md },
  artWrap: { marginBottom: spacing.sm },
});

export function EmptyState({
  icon,
  title,
  body,
  art,
  actionLabel,
  onAction,
  actionVariant = 'secondary',
  style,
}: Props) {
  return (
    <View style={[styles.wrap, style]}>
      {art ? (
        <View style={styles.artWrap}>{art}</View>
      ) : (
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={28} color={colors.textFaint} />
        </View>
      )}
      <AppText variant="title" center>
        {title}
      </AppText>
      {body ? (
        <AppText variant="body" color={colors.textDim} center style={styles.body}>
          {body}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          onPress={onAction}
          variant={actionVariant}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}
