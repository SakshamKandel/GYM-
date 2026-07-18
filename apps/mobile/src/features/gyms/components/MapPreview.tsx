import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, PressableScale } from '../../../components/ui';

/**
 * Static map preview for a gym's coordinates — a single OSM standard tile
 * (documented XYZ scheme: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`) at
 * a fixed ~15 zoom, no stitching/panning. The pin is placed at the point's
 * exact fractional pixel position WITHIN that tile (standard slippy-map
 * projection math), so it lands on the real spot rather than at a
 * hard-coded frame-center that would drift from the actual coordinate.
 *
 * expo-image caches the tile (memory+disk) so repeat visits to the same gym
 * don't re-fetch. Tap hands off to the caller (existing Directions link) —
 * this component draws, it doesn't navigate.
 */

const ZOOM = 15;
const TILE_PX = 256;
/** Rendered box — square so the tile scales uniformly (no stretch/distortion). */
const BOX_PX = 200;
const PIN_SIZE = 28;

interface Projected {
  x: number;
  y: number;
  /** Pixel offset of the point within the tile, scaled to BOX_PX. */
  pinX: number;
  pinY: number;
}

/** Standard Web Mercator slippy-map tile projection (OSM wiki "Slippy map
 * tilenames"). Returns the tile x/y containing the point plus the point's
 * fractional pixel offset inside that tile, scaled to the rendered box size. */
function project(lat: number, lng: number): Projected {
  const n = 2 ** ZOOM;
  const xTileF = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yTileF = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(xTileF);
  const y = Math.floor(yTileF);
  const scale = BOX_PX / TILE_PX;
  return {
    x,
    y,
    pinX: (xTileF - x) * TILE_PX * scale,
    pinY: (yTileF - y) * TILE_PX * scale,
  };
}

const styles = StyleSheet.create({
  wrap: {
    width: BOX_PX,
    alignSelf: 'flex-start',
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  box: { width: BOX_PX, height: BOX_PX },
  tile: { width: BOX_PX, height: BOX_PX },
  pin: { position: 'absolute' },
  attribution: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
  },
});

interface Props {
  lat: number;
  lng: number;
  onPress?: () => void;
  /** Describes the tap action (e.g. "Open directions to <gym name>"). */
  accessibilityLabel: string;
}

export function MapPreview({ lat, lng, onPress, accessibilityLabel }: Props) {
  const { x, y, pinX, pinY } = useMemo(() => project(lat, lng), [lat, lng]);
  const tileUrl = `https://tile.openstreetmap.org/${ZOOM}/${x}/${y}.png`;

  const inner = (
    <View style={styles.box}>
      <Image
        source={{ uri: tileUrl }}
        style={styles.tile}
        cachePolicy="disk"
        recyclingKey={tileUrl}
        accessibilityIgnoresInvertColors
        accessible={false}
      />
      <View
        pointerEvents="none"
        style={[styles.pin, { left: pinX - PIN_SIZE / 2, top: pinY - PIN_SIZE }]}
      >
        <Ionicons name="location" size={PIN_SIZE} color={colors.accent} />
      </View>
      <View pointerEvents="none" style={styles.attribution}>
        <AppText variant="caption" color={colors.onAccent}>
          © OpenStreetMap
        </AppText>
      </View>
    </View>
  );

  if (!onPress) {
    return (
      <View style={styles.wrap} accessibilityLabel={accessibilityLabel} accessible>
        {inner}
      </View>
    );
  }

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={styles.wrap}
    >
      {inner}
    </PressableScale>
  );
}
