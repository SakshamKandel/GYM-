import { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, PressableScale } from '../../../components/ui';

/**
 * Real interactive Dark-Mode Location Map — renders real CartoDB Dark Matter
 * vector/raster map tiles (with real street names, building footprints, and
 * landmarks) centered at `{lat, lng}`. On Web, renders an `<iframe>` Leaflet map;
 * on native mobile, renders a `<WebView>` Leaflet map. Overlaid with a sleek
 * glassmorphic address badge and directions trigger button.
 */

interface Props {
  lat: number;
  lng: number;
  addressText?: string;
  city?: string;
  gymName?: string;
  height?: number;
  onPress?: () => void;
  /** Describes the tap action (e.g. "Open directions to <gym name>"). */
  accessibilityLabel: string;
}

function buildMapHtml(lat: number, lng: number, title?: string): string {
  const safeTitle = (title ?? 'Gym Location').replace(/'/g, "\\'");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body, #map { width:100%; height:100%; background:#0B0C0D; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow:hidden; }
    .leaflet-container { background: #0B0C0D; }
    .leaflet-control-attribution { display: none !important; }
    .leaflet-control-zoom { border: none !important; margin: 8px !important; }
    .leaflet-control-zoom a { background: rgba(28, 29, 34, 0.9) !important; color: #FFFFFF !important; border: 1px solid rgba(255,255,255,0.12) !important; border-radius: 6px !important; backdrop-filter: blur(8px); }
    .marker-container { position: relative; width: 32px; height: 32px; }
    .pulse-ring {
      position: absolute;
      width: 52px;
      height: 52px;
      left: -10px;
      top: -10px;
      border-radius: 50%;
      background: rgba(255, 59, 48, 0.35);
      animation: pulse 2s infinite ease-out;
      pointer-events: none;
    }
    .custom-marker {
      width: 32px;
      height: 32px;
      background: #FF3B30;
      border: 3px solid #FFFFFF;
      border-radius: 50%;
      box-shadow: 0 0 16px rgba(255, 59, 48, 0.8), 0 4px 12px rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .custom-marker::after {
      content: '';
      width: 10px;
      height: 10px;
      background: #FFFFFF;
      border-radius: 50%;
    }
    @keyframes pulse {
      0% { transform: scale(0.6); opacity: 0.85; }
      100% { transform: scale(1.6); opacity: 0; }
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', { zoomControl: false, attributionControl: false, scrollWheelZoom: false }).setView([${lat}, ${lng}], 15);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd'
    }).addTo(map);
    var icon = L.divIcon({
      className: '',
      html: '<div class="marker-container"><div class="pulse-ring"></div><div class="custom-marker"></div></div>',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    L.marker([${lat}, ${lng}], { icon: icon }).addTo(map).bindPopup('${safeTitle}');
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
  accessibilityLabel,
}: Props) {
  const mapHtml = useMemo(() => buildMapHtml(lat, lng, gymName), [lat, lng, gymName]);
  const isWeb = Platform.OS === 'web';
  const displayAddress = [addressText, city].filter(Boolean).join(', ') || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

  const mapContent = (
    <View style={[styles.mapContainer, { height }]}>
      {isWeb ? (
        <iframe
          srcDoc={mapHtml}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            pointerEvents: 'auto',
          }}
          title={accessibilityLabel}
        />
      ) : (
        <WebView
          source={{ html: mapHtml }}
          scrollEnabled={false}
          style={{ width: '100%', height: '100%', backgroundColor: colors.bg }}
          originWhitelist={['*']}
        />
      )}

      {/* Glassmorphic Address Overlay */}
      <View style={styles.overlayBar} pointerEvents="none">
        <View style={styles.addressBit}>
          <Ionicons name="location" size={14} color={colors.accent} />
          <AppText variant="caption" color={colors.text} numberOfLines={1} style={{ flex: 1 }}>
            {displayAddress}
          </AppText>
        </View>
        <View style={styles.directionsPill}>
          <Ionicons name="navigate" size={11} color={colors.onAccent} />
          <AppText variant="caption" color={colors.onAccent} style={{ fontWeight: '600' }}>
            Directions
          </AppText>
        </View>
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
