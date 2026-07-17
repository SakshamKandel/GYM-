import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, type } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';

/**
 * Coach avatar tile — the profile photo when one exists, otherwise the
 * coach's initials in condensed Oswald caps on a raised tile. Rounded-square
 * `radius.md` (the nested-tile motif), never a circle, matching IconChip.
 *
 * `tone`:
 * - 'surface' (default) — raised charcoal tile for charcoal rows/cards.
 * - 'onBlock'           — near-black tile for use INSIDE red/cream blocks.
 */
interface Props {
  name: string;
  url: string | null;
  size?: number;
  tone?: 'surface' | 'onBlock';
}

/** "Alex Grivas" → "AG"; single word → first letter; empty → "C"(oach). */
export function coachInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  const first = words[0]?.[0] ?? 'C';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: {
    fontFamily: type.display,
    letterSpacing: 1,
  },
});

export function CoachAvatar({ name, url, size = 52, tone = 'surface' }: Props) {
  const bg = tone === 'onBlock' ? colors.onBlock : colors.surfaceRaised;

  if (url !== null) {
    return (
      <Image
        source={{ uri: url }}
        style={{
          width: size,
          height: size,
          borderRadius: radius.md,
          backgroundColor: bg,
        }}
        contentFit="cover"
        transition={150}
        accessibilityElementsHidden
      />
    );
  }

  return (
    <View
      style={[styles.tile, { width: size, height: size, backgroundColor: bg }]}
      accessibilityElementsHidden
    >
      <AppText
        tabular={false}
        style={[styles.initials, { fontSize: Math.round(size * 0.36), color: colors.text }]}
      >
        {coachInitials(name)}
      </AppText>
    </View>
  );
}
