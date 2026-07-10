import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { spacing, type } from '@gym/ui-tokens';
import { AppText } from './AppText';
import { enterDown } from './motion';

/**
 * The standard revamp header block (brief §5): optional uppercase eyebrow →
 * huge Oswald title (auto-uppercased, wraps to two lines — never clipped) →
 * optional meta-chips row. An optional right-side `action` slot sits beside
 * the title for icon buttons / avatars.
 *
 * No horizontal padding of its own — the `Screen` shell already provides the
 * 20px gutter. Fades in with the shared `enterDown` preset.
 */
interface Props {
  title: string;
  /** Uppercase letterspaced micro-label above the title. */
  eyebrow?: string;
  /** Right-side slot beside the title (icon button, avatar…). */
  action?: ReactNode;
  /** Meta chips row rendered under the title (MetaChip / Tag pills). */
  meta?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: {
    flex: 1,
    fontSize: type.size.heroTitle,
    lineHeight: 54,
    textTransform: 'uppercase',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});

export function ScreenHeader({ title, eyebrow, action, meta, style }: Props) {
  return (
    <Animated.View entering={enterDown()} style={[styles.wrap, style]}>
      {eyebrow ? <AppText variant="label">{eyebrow}</AppText> : null}
      <View style={styles.titleRow}>
        <AppText variant="display" style={styles.title}>
          {title}
        </AppText>
        {action ? <View>{action}</View> : null}
      </View>
      {meta ? <View style={styles.metaRow}>{meta}</View> : null}
    </Animated.View>
  );
}
