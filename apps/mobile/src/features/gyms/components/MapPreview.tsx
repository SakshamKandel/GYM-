import { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, PressableScale } from '../../../components/ui';

/**
 * Dark-mode location preview — real CARTO Dark Matter map tiles (real street
 * names, building footprints and landmarks) centred on `{lat, lng}`, with a
 * marker, the address badge and a Directions cue on top. Web renders it in an
 * `<iframe>`, native in a `<WebView>`; on web the frame runs
 * `sandbox="allow-scripts"` so it has no access to the app origin.
 *
 * Two deliberate choices:
 *
 * 1. No map library. This used to pull Leaflet from a public code host at
 *    runtime, which meant every member's device announced itself to a third
 *    party we have no relationship with, and a blank square whenever that host
 *    was slow, down or blocked. The preview only ever needed a grid of tiles
 *    and a pin, which is the handful of lines below. Nothing is fetched but
 *    the map tiles themselves, which can only come from a map host.
 *
 * 2. The tile makers are credited on the card (`ATTRIBUTION`). OpenStreetMap's
 *    licence and CARTO's terms both require it, and the old build hid the
 *    credit with CSS. It's drawn in React Native rather than inside the map
 *    document so it uses our type tokens, respects the member's text size, and
 *    still shows if the tiles never load.
 *
 * The preview is a single tap target (details, or directions), so the map
 * surface itself takes no touches — the whole card responds instead of the
 * gesture disappearing into a scrollable map.
 */

/** Required by OpenStreetMap's licence and CARTO's basemap terms. */
const ATTRIBUTION = '© OpenStreetMap contributors, © CARTO';

/** Fixed neighbourhood-level zoom — close enough to read the street layout. */
const ZOOM = 15;

interface Props {
  lat: number;
  lng: number;
  addressText?: string;
  city?: string;
  gymName?: string;
  height?: number;
  onPress?: () => void;
  /**
   * What the tap actually does, so the cue on the card says the truth. A card
   * that opens the gym page must not offer "Directions". Defaults to
   * directions, which is what the gym page's own map does.
   */
  action?: 'directions' | 'details';
  /** Describes the tap action (e.g. "Open directions to <gym name>"). */
  accessibilityLabel: string;
}

/**
 * Coordinates are spliced into the document as bare numbers, so never let a
 * non-finite one through. Latitude is also clamped to the range Web Mercator
 * can actually project.
 */
function safeLatitude(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(85.05112878, Math.max(-85.05112878, value));
}

function safeLongitude(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(180, Math.max(-180, value));
}

/**
 * A self-contained map document: a grid of CARTO tiles laid out around the
 * point, plus the pin. Nothing operator-supplied reaches it (only the two
 * numbers above), and it loads no code from anywhere.
 */
function buildMapHtml(lat: number, lng: number): string {
  const safeLat = safeLatitude(lat);
  const safeLng = safeLongitude(lng);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { width:100%; height:100%; background:${colors.bg}; overflow:hidden; }
    #tiles { position:absolute; inset:0; }
    #tiles img { position:absolute; width:256px; height:256px; }
    .pin {
      position:absolute; left:50%; top:50%;
      width:32px; height:32px; margin:-16px 0 0 -16px;
      background:${colors.accent};
      border:3px solid #FFFFFF;
      border-radius:50%;
      box-shadow: 0 0 16px rgba(255, 59, 48, 0.8), 0 4px 12px rgba(0,0,0,0.6);
      display:flex; align-items:center; justify-content:center;
    }
    .pin::after { content:''; width:10px; height:10px; background:#FFFFFF; border-radius:50%; }
    .pulse {
      position:absolute; left:50%; top:50%;
      width:52px; height:52px; margin:-26px 0 0 -26px;
      border-radius:50%;
      background: rgba(255, 59, 48, 0.35);
      animation: pulse 2s infinite ease-out;
    }
    @keyframes pulse {
      0% { transform: scale(0.6); opacity: 0.85; }
      100% { transform: scale(1.6); opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) { .pulse { animation: none; opacity: 0.5; } }
  </style>
</head>
<body>
  <div id="tiles"></div>
  <div class="pulse"></div>
  <div class="pin"></div>
  <script>
    (function () {
      var LAT = ${safeLat}, LNG = ${safeLng}, Z = ${ZOOM}, SIZE = 256;
      var host = document.getElementById('tiles');
      var count = Math.pow(2, Z);
      var latRad = LAT * Math.PI / 180;
      // Web Mercator: where the point sits on the world tile grid at this zoom.
      var worldX = (LNG + 180) / 360 * count;
      var worldY = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * count;
      var retina = (window.devicePixelRatio || 1) > 1.5 ? '@2x' : '';

      function draw() {
        var width = host.clientWidth || window.innerWidth;
        var height = host.clientHeight || window.innerHeight;
        // World pixel under the top-left corner of the view, so only the
        // tiles actually on screen get fetched.
        var originX = worldX * SIZE - width / 2;
        var originY = worldY * SIZE - height / 2;
        var firstX = Math.floor(originX / SIZE), lastX = Math.floor((originX + width) / SIZE);
        var firstY = Math.floor(originY / SIZE), lastY = Math.floor((originY + height) / SIZE);
        var frag = document.createDocumentFragment();
        for (var tx = firstX; tx <= lastX; tx++) {
          for (var ty = firstY; ty <= lastY; ty++) {
            if (ty < 0 || ty >= count) continue;
            var wrappedX = ((tx % count) + count) % count;
            var img = document.createElement('img');
            img.alt = '';
            img.draggable = false;
            img.onerror = function () { this.style.display = 'none'; };
            img.src = 'https://' + 'abcd'.charAt((wrappedX + ty) % 4) +
              '.basemaps.cartocdn.com/dark_all/' + Z + '/' + wrappedX + '/' + ty + retina + '.png';
            img.style.left = (tx * SIZE - originX) + 'px';
            img.style.top = (ty * SIZE - originY) + 'px';
            frag.appendChild(img);
          }
        }
        host.textContent = '';
        host.appendChild(frag);
      }

      draw();
      window.addEventListener('resize', draw);
    })();
  </script>
</body>
</html>`;
}

export function MapPreview({
  lat,
  lng,
  addressText,
  city,
  gymName,
  height = 200,
  onPress,
  action = 'directions',
  accessibilityLabel,
}: Props) {
  const mapHtml = useMemo(() => buildMapHtml(lat, lng), [lat, lng]);
  const isWeb = Platform.OS === 'web';
  // Never fall back to raw coordinates — a pair of decimals means nothing to
  // the person reading the card.
  const displayAddress =
    [addressText, city].filter(Boolean).join(', ') || gymName || 'Shown on the map';

  const mapContent = (
    <View style={[styles.mapContainer, { height }]}>
      {/* The card is the tap target, so the map takes no touches: on a phone a
          scrollable map inside a scrolling list eats the gesture either way. */}
      <View style={styles.mapSurface} pointerEvents={onPress ? 'none' : 'auto'}>
        {isWeb ? (
          <iframe
            srcDoc={mapHtml}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
            }}
            title={accessibilityLabel}
            // Same fence as the 3D anatomy viewer: the map document is
            // self-contained and needs scripts, but it gets no same-origin
            // access to the app.
            sandbox="allow-scripts"
          />
        ) : (
          <WebView
            source={{ html: mapHtml }}
            scrollEnabled={false}
            style={{ width: '100%', height: '100%', backgroundColor: colors.bg }}
            originWhitelist={['*']}
          />
        )}
      </View>

      {/* Credit for the map data and tiles. Both licences ask for it, and it
          rides on the card so it survives even when the tiles don't load. */}
      <View style={styles.creditBar} pointerEvents="none">
        <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
          {ATTRIBUTION}
        </AppText>
      </View>

      {/* Glassmorphic Address Overlay */}
      <View style={styles.overlayBar} pointerEvents="none">
        <View style={styles.addressBit}>
          <Ionicons name="location" size={14} color={colors.accent} />
          <AppText variant="caption" color={colors.text} numberOfLines={1} style={{ flex: 1 }}>
            {displayAddress}
          </AppText>
        </View>
        {onPress ? (
          <View style={styles.directionsPill}>
            <Ionicons
              name={action === 'details' ? 'chevron-forward' : 'navigate'}
              size={11}
              color={colors.onAccent}
            />
            <AppText variant="caption" color={colors.onAccent} style={{ fontWeight: '600' }}>
              {action === 'details' ? 'Details' : 'Directions'}
            </AppText>
          </View>
        ) : null}
      </View>
    </View>
  );

  if (!onPress) {
    return (
      <View style={styles.wrap} accessibilityLabel={accessibilityLabel} accessible>
        {mapContent}
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
      {mapContent}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    borderRadius: radius.block,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mapContainer: {
    width: '100%',
    position: 'relative',
    backgroundColor: colors.bg,
  },
  mapSurface: { flex: 1 },
  creditBar: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: 'rgba(11, 12, 13, 0.75)',
    maxWidth: '92%',
  },
  overlayBar: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    backgroundColor: 'rgba(11, 12, 13, 0.85)',
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  addressBit: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  directionsPill: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
