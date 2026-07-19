import { useState } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';

/**
 * Swipeable photo gallery for the gym detail page (brief §2). A paging
 * horizontal ScrollView with index dots; degrades gracefully to a single
 * static photo (no dots) or, with no photos, a branded initial hero so the
 * page never opens on a blank frame. Self-contained — no network beyond the
 * already-loaded photo URLs.
 */

const HEIGHT = 268;

interface Props {
  photos: { id: string; deliveryUrl: string }[];
  name: string;
  /** Rendered under the big initial on the no-photo fallback. */
  category: string;
}

const styles = StyleSheet.create({
  wrap: {
    height: HEIGHT,
    borderRadius: radius.block,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  page: { height: HEIGHT },
  image: { height: HEIGHT },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 96 },
  dots: {
    position: 'absolute',
    bottom: spacing.md,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  dot: { height: 6, borderRadius: radius.full, backgroundColor: colors.text },
  counter: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(11,12,13,0.62)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  fallback: {
    height: HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
    gap: spacing.sm,
  },
  fallbackInitial: {
    fontFamily: type.display,
    fontSize: 140,
    lineHeight: 150,
    color: colors.surfacePressed,
  },
  fallbackTag: {
    position: 'absolute',
    top: '50%',
    marginTop: -26,
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.accentFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export function GymGallery({ photos, name, category }: Props) {
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const initial = name.trim().charAt(0).toUpperCase() || '#';

  function onLayout(e: LayoutChangeEvent): void {
    setWidth(e.nativeEvent.layout.width);
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>): void {
    if (width <= 0) return;
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== index) setIndex(next);
  }

  if (photos.length === 0) {
    return (
      <View style={styles.wrap} onLayout={onLayout} accessible accessibilityLabel={`${name}. No photos available`}>
        <View style={styles.fallback}>
          <AppText tabular={false} style={styles.fallbackInitial} numberOfLines={1}>
            {initial}
          </AppText>
        </View>
        <View style={styles.fallbackTag} pointerEvents="none">
          <Ionicons name="business" size={26} color={colors.accent} />
        </View>
      </View>
    );
  }

  const single = photos.length === 1;

  return (
    <View
      style={styles.wrap}
      onLayout={onLayout}
      accessible
      accessibilityLabel={`${name} photo gallery, ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`}
    >
      <ScrollView
        horizontal
        pagingEnabled={!single}
        scrollEnabled={!single}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {photos.map((p) => (
          <View key={p.id} style={[styles.page, { width: width || undefined }]}>
            {width > 0 ? (
              <Image
                source={{ uri: p.deliveryUrl }}
                style={[styles.image, { width }]}
                contentFit="cover"
                transition={150}
                accessible={false}
              />
            ) : null}
          </View>
        ))}
      </ScrollView>

      {/* Top scrim keeps the overlaid back button + counter legible. */}
      <LinearGradient
        colors={['rgba(0,0,0,0.55)', 'transparent']}
        style={styles.topScrim}
        pointerEvents="none"
      />

      {!single ? (
        <>
          <View style={styles.counter} pointerEvents="none">
            <AppText variant="label" color={colors.text}>
              {index + 1} / {photos.length}
            </AppText>
          </View>
          <View style={styles.dots} pointerEvents="none">
            {photos.map((p, i) => (
              <View
                key={p.id}
                style={[
                  styles.dot,
                  {
                    width: i === index ? 20 : 6,
                    opacity: i === index ? 1 : 0.5,
                    backgroundColor: i === index ? colors.accent : colors.text,
                  },
                ]}
              />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}
