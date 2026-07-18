'use client';

import type * as Leaflet from 'leaflet';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { Button } from './Button';

/**
 * Interactive OpenStreetMap location picker (maps-web). Vanilla Leaflet in a
 * client-only component — every CONSUMER must load it via
 * `dynamic(() => import('.../LocationPicker'), { ssr: false })` so the module,
 * and Leaflet's `window`-touching internals, never evaluate during SSR.
 *
 * Two modes:
 *  - `pin`    — a single draggable marker (gyms, order address view).
 *  - `radius` — a draggable center marker + a radius circle whose size is driven
 *               by a km slider (partner service areas).
 *
 * The map is progressive enhancement: keyboard-accessible number inputs for
 * lat / lng (and radius) sit beside it and stay in sync both ways, so the whole
 * thing is usable with the map collapsed or JS-disabled tiles. Coordinates are
 * validated to WGS-84 bounds before they ever reach `onChange`.
 *
 * `readOnly` renders a non-interactive display (partner portal): pin + circle
 * shown, no dragging/clicking/inputs, no search box.
 */

export interface LocationValue {
  lat: number;
  lng: number;
  /** Present in `radius` mode only. Kilometres. */
  radiusKm?: number;
}

export interface LocationPickerProps {
  mode?: 'pin' | 'radius';
  /** Controlled value. `null` = nothing placed yet. */
  value: LocationValue | null;
  onChange?: (value: LocationValue | null) => void;
  /** Where to centre the map when there is no value yet. Defaults to Kathmandu. */
  defaultCenter?: { lat: number; lng: number };
  defaultRadiusKm?: number;
  minRadiusKm?: number;
  maxRadiusKm?: number;
  /** Display-only: no dragging, clicking, inputs, or search. */
  readOnly?: boolean;
  /** Hide the geocoder search box (kept on by default for editors). */
  searchEnabled?: boolean;
  disabled?: boolean;
  height?: number;
  /** Accessible label for the map region. */
  ariaLabel?: string;
}

/** Kathmandu — the app's home region; a sensible empty-state centre. */
export const DEFAULT_MAP_CENTER = { lat: 27.7172, lng: 85.324 } as const;

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function inLatRange(n: number): boolean {
  return Number.isFinite(n) && n >= -90 && n <= 90;
}
function inLngRange(n: number): boolean {
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

function pinIconHtml(): string {
  // Inline SVG teardrop — no external marker image (Leaflet's default icon URLs
  // break under bundlers and would need asset copying). Uses the danger token.
  return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M12 1.5c-4.3 0-7.8 3.4-7.8 7.7 0 5.5 7 12.6 7.3 12.9.3.3.7.3 1 0 .3-.3 7.3-7.4 7.3-12.9 0-4.3-3.5-7.7-7.8-7.7z" fill="var(--gt-danger, #e5484d)" stroke="#fff" stroke-width="1.4"/>
    <circle cx="12" cy="9.2" r="2.8" fill="#fff"/>
  </svg>`;
}

interface GeoResult {
  label: string;
  lat: number;
  lng: number;
}

export function LocationPicker({
  mode = 'pin',
  value,
  onChange,
  defaultCenter = DEFAULT_MAP_CENTER,
  defaultRadiusKm = 3,
  minRadiusKm = 0.5,
  maxRadiusKm = 30,
  readOnly = false,
  searchEnabled = true,
  disabled = false,
  height = 320,
  ariaLabel = 'Location map',
}: LocationPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markerRef = useRef<Leaflet.Marker | null>(null);
  const circleRef = useRef<Leaflet.Circle | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  // Latest onChange / mode / value kept in refs so map event handlers created
  // once at mount always see current props without re-binding.
  const onChangeRef = useRef<LocationPickerProps['onChange']>(onChange);
  const valueRef = useRef<LocationValue | null>(value);
  const modeRef = useRef(mode);
  const interactiveRef = useRef(!readOnly && !disabled);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    interactiveRef.current = !readOnly && !disabled;
  }, [readOnly, disabled]);

  const fieldId = useId();
  const [ready, setReady] = useState(false);

  // Draft text for the inputs so a user can clear/edit freely without the
  // controlled value snapping mid-keystroke.
  const [latText, setLatText] = useState(value ? String(value.lat) : '');
  const [lngText, setLngText] = useState(value ? String(value.lng) : '');
  const [radiusKm, setRadiusKm] = useState<number>(
    value?.radiusKm ?? defaultRadiusKm,
  );

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Keep local input drafts in sync when the parent value changes externally.
  useEffect(() => {
    valueRef.current = value;
    setLatText(value ? String(value.lat) : '');
    setLngText(value ? String(value.lng) : '');
    if (value?.radiusKm != null) setRadiusKm(value.radiusKm);
  }, [value]);

  const emit = useCallback(
    (next: LocationValue | null) => {
      valueRef.current = next;
      onChangeRef.current?.(next);
    },
    [],
  );

  // ── Map lifecycle ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    void (async () => {
      const mod = await import('leaflet');
      // Leaflet's ESM build exposes the namespace both as named exports and a
      // default; normalise to a single `L` regardless of interop shape.
      const L = ((mod as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;
      const Lref = leafletRef.current;

      const start = valueRef.current ?? defaultCenter;
      const map = Lref.map(containerRef.current, {
        center: [start.lat, start.lng],
        zoom: valueRef.current ? 14 : 12,
        zoomControl: !readOnly,
        dragging: true,
        scrollWheelZoom: false,
        attributionControl: true,
        keyboard: true,
      });
      mapRef.current = map;

      Lref.tileLayer(TILE_URL, {
        maxZoom: 19,
        attribution: TILE_ATTRIBUTION,
      }).addTo(map);

      // Click-to-place (editors only).
      map.on('click', (e: Leaflet.LeafletMouseEvent) => {
        if (!interactiveRef.current) return;
        placeAt(e.latlng.lat, e.latlng.lng);
      });

      // Render any initial value.
      if (valueRef.current) {
        renderPoint(valueRef.current.lat, valueRef.current.lng, valueRef.current.radiusKm);
      }

      // The map often mounts inside a just-opened modal/drawer; force a resize
      // pass once it's laid out and whenever the container resizes.
      resizeObserver = new ResizeObserver(() => map.invalidateSize());
      resizeObserver.observe(containerRef.current);
      setTimeout(() => map.invalidateSize(), 60);

      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      markerRef.current = null;
      circleRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Mount once. Prop-driven updates are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draw / move the marker (+ circle) at a point without re-emitting.
  const renderPoint = useCallback(
    (lat: number, lng: number, r?: number) => {
      const L = leafletRef.current;
      const map = mapRef.current;
      if (!L || !map) return;

      if (!markerRef.current) {
        const icon = L.divIcon({
          className: 'gt-map-pin',
          html: pinIconHtml(),
          iconSize: [28, 28],
          iconAnchor: [14, 28],
        });
        const marker = L.marker([lat, lng], {
          icon,
          draggable: interactiveRef.current,
          keyboard: false,
        }).addTo(map);
        marker.on('drag', () => {
          const p = marker.getLatLng();
          circleRef.current?.setLatLng(p);
        });
        marker.on('dragend', () => {
          const p = marker.getLatLng();
          setLatText(String(round6(p.lat)));
          setLngText(String(round6(p.lng)));
          emit(buildValue(round6(p.lat), round6(p.lng)));
        });
        markerRef.current = marker;
      } else {
        markerRef.current.setLatLng([lat, lng]);
        markerRef.current.dragging?.[interactiveRef.current ? 'enable' : 'disable']();
      }

      if (modeRef.current === 'radius') {
        const radiusMeters = Math.max(0, (r ?? radiusKm)) * 1000;
        if (!circleRef.current) {
          circleRef.current = L.circle([lat, lng], {
            radius: radiusMeters,
            color: 'var(--gt-danger, #e5484d)',
            weight: 2,
            fillColor: 'var(--gt-danger, #e5484d)',
            fillOpacity: 0.12,
          }).addTo(map);
        } else {
          circleRef.current.setLatLng([lat, lng]);
          circleRef.current.setRadius(radiusMeters);
        }
      } else if (circleRef.current) {
        circleRef.current.remove();
        circleRef.current = null;
      }
    },
    [emit, radiusKm],
  );

  // Compose a LocationValue from a point, folding in the current radius in
  // radius mode.
  const buildValue = useCallback(
    (lat: number, lng: number): LocationValue =>
      modeRef.current === 'radius' ? { lat, lng, radiusKm } : { lat, lng },
    [radiusKm],
  );

  // Place at a point (editor gestures): render + recentre + emit.
  const placeAt = useCallback(
    (lat: number, lng: number) => {
      if (!inLatRange(lat) || !inLngRange(lng)) return;
      const rlat = round6(lat);
      const rlng = round6(lng);
      renderPoint(rlat, rlng);
      mapRef.current?.panTo([rlat, rlng]);
      setLatText(String(rlat));
      setLngText(String(rlng));
      emit(buildValue(rlat, rlng));
    },
    [buildValue, emit, renderPoint],
  );

  // React to controlled value changes (e.g. parent reset / edit open).
  useEffect(() => {
    if (!ready) return;
    if (value) {
      renderPoint(value.lat, value.lng, value.radiusKm);
      mapRef.current?.setView(
        [value.lat, value.lng],
        Math.max(mapRef.current.getZoom(), 13),
      );
    } else if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
      circleRef.current?.remove();
      circleRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ready]);

  // React to radius slider / mode changes.
  useEffect(() => {
    if (!ready) return;
    const v = valueRef.current;
    if (v && modeRef.current === 'radius') {
      renderPoint(v.lat, v.lng, radiusKm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radiusKm, mode, ready]);

  // ── Keyboard field commits ───────────────────────────────────────────────
  function commitCoords() {
    const lat = Number(latText.trim());
    const lng = Number(lngText.trim());
    if (!latText.trim() && !lngText.trim()) {
      emit(null);
      return;
    }
    if (!inLatRange(lat) || !inLngRange(lng)) return;
    placeAt(lat, lng);
  }

  function onRadiusChange(next: number) {
    const clamped = Math.min(maxRadiusKm, Math.max(minRadiusKm, next));
    setRadiusKm(clamped);
    const v = valueRef.current;
    if (v) emit({ lat: v.lat, lng: v.lng, radiusKm: clamped });
  }

  // ── Search ───────────────────────────────────────────────────────────────
  async function runSearch(q: string) {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/geo/search?q=${encodeURIComponent(trimmed)}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        setResults([]);
        setSearchError(res.status === 429 ? 'Too many searches — wait a moment.' : 'Search unavailable.');
        return;
      }
      const data = (await res.json()) as { results?: GeoResult[] };
      setResults(Array.isArray(data.results) ? data.results : []);
    } catch {
      setResults([]);
      setSearchError('Search unavailable.');
    } finally {
      setSearching(false);
    }
  }

  function selectResult(r: GeoResult) {
    setSearch(r.label);
    setResults([]);
    placeAt(r.lat, r.lng);
    mapRef.current?.setView([r.lat, r.lng], 15);
  }

  const editable = !readOnly && !disabled;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {editable && searchEnabled ? (
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="gt-input"
              type="search"
              placeholder="Search a place or address…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runSearch(search);
                }
              }}
              aria-label="Search for a location"
              style={{ flex: 1 }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void runSearch(search)}
              disabled={searching || search.trim().length < 2}
            >
              {searching ? 'Searching…' : 'Search'}
            </Button>
          </div>
          {searchError ? (
            <div style={{ fontSize: 12, color: 'var(--gt-danger)', marginTop: 4 }}>{searchError}</div>
          ) : null}
          {results.length > 0 ? (
            <ul
              style={{
                position: 'absolute',
                zIndex: 1000,
                top: '100%',
                left: 0,
                right: 0,
                marginTop: 4,
                listStyle: 'none',
                padding: 4,
                background: 'var(--gt-surface, #fff)',
                border: '1px solid var(--gt-border)',
                borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                maxHeight: 220,
                overflowY: 'auto',
              }}
            >
              {results.map((r, i) => (
                <li key={`${r.lat},${r.lng},${i}`}>
                  <button
                    type="button"
                    onClick={() => selectResult(r)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      fontSize: 13,
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--gt-text)',
                      cursor: 'pointer',
                      borderRadius: 6,
                    }}
                  >
                    {r.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div
        ref={containerRef}
        role="application"
        aria-label={ariaLabel}
        style={{
          height,
          width: '100%',
          borderRadius: 10,
          border: '1px solid var(--gt-border)',
          overflow: 'hidden',
          background: 'var(--gt-surface-sunken, #eef1f4)',
        }}
      />

      {editable ? (
        <p style={{ fontSize: 12, color: 'var(--gt-text-dim)', margin: 0 }}>
          Click the map or drag the pin to set the location. You can also type exact coordinates below.
        </p>
      ) : null}

      {/* Keyboard-accessible fallback / exact-entry inputs. */}
      {editable ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 120px' }}>
            <FieldMicroLabel htmlFor={`${fieldId}-lat`}>Latitude</FieldMicroLabel>
            <input
              id={`${fieldId}-lat`}
              className="gt-input"
              type="number"
              inputMode="decimal"
              step="0.000001"
              min={-90}
              max={90}
              value={latText}
              onChange={(e) => setLatText(e.target.value)}
              onBlur={commitCoords}
              placeholder="27.7172"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 120px' }}>
            <FieldMicroLabel htmlFor={`${fieldId}-lng`}>Longitude</FieldMicroLabel>
            <input
              id={`${fieldId}-lng`}
              className="gt-input"
              type="number"
              inputMode="decimal"
              step="0.000001"
              min={-180}
              max={180}
              value={lngText}
              onChange={(e) => setLngText(e.target.value)}
              onBlur={commitCoords}
              placeholder="85.3240"
            />
          </label>
          {mode === 'radius' ? (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px' }}>
              <FieldMicroLabel htmlFor={`${fieldId}-radius`}>
                Delivery radius — {radiusKm.toFixed(1)} km
              </FieldMicroLabel>
              <input
                id={`${fieldId}-radius`}
                type="range"
                min={minRadiusKm}
                max={maxRadiusKm}
                step={0.5}
                value={radiusKm}
                onChange={(e) => onRadiusChange(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </label>
          ) : null}
        </div>
      ) : (
        <ReadOnlyReadout value={value} showRadius={mode === 'radius'} />
      )}
    </div>
  );
}

function ReadOnlyReadout({
  value,
  showRadius,
}: {
  value: LocationValue | null;
  showRadius: boolean;
}) {
  if (!value) {
    return (
      <p style={{ fontSize: 13, color: 'var(--gt-text-dim)', margin: 0 }}>
        No service-area map has been set yet.
      </p>
    );
  }
  return (
    <p style={{ fontSize: 13, color: 'var(--gt-text-dim)', margin: 0 }}>
      Centre {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
      {showRadius && value.radiusKm != null ? ` · ${value.radiusKm.toFixed(1)} km radius` : ''}
    </p>
  );
}

function FieldMicroLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        fontSize: 11,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        color: 'var(--gt-text-dim)',
        fontFamily: 'var(--font-heading)',
      }}
    >
      {children}
    </label>
  );
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
