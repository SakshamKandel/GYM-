import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '@gym/ui-tokens';

/**
 * Meal thumbnail treatment for order rows. Meal photos are optional — the
 * order item snapshot carries none, and only some partner-uploaded menu meals
 * have an `imageUrl` — so when there's no photo we fall back to a branded meal
 * glyph (accent-tinted rounded tile) instead of an empty grey box, keeping the
 * list visually anchored the same way IconChip anchors other rows.
 */
interface Props {
  /** Partner-uploaded meal photo, when one exists. */
  imageUrl?: string | null;
  size?: number;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentFaint,
  },
  photo: { width: '100%', height: '100%' },
});

export function MealThumb({ imageUrl, size = 56 }: Props) {
  const box = { width: size, height: size };
  if (imageUrl) {
    return (
      <View style={[styles.base, box]}>
        <Image
          source={{ uri: imageUrl }}
          style={styles.photo}
          contentFit="cover"
          transition={160}
          accessibilityIgnoresInvertColors
        />
      </View>
    );
  }
  return (
    <View style={[styles.base, box]} accessible={false} importantForAccessibility="no-hide-descendants">
      <Ionicons name="fast-food" size={size * 0.46} color={colors.accent} />
    </View>
  );
}
