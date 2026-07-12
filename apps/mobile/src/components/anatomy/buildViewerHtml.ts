import { colors } from '@gym/ui-tokens';
import { MUSCLE_GROUPS } from '../../lib/exercises';
import type { MuscleGroup } from '../../lib/muscleMap';
import { MUSCLES_GLB_B64 } from './muscleModel.b64';
import { DRACO_DECODER_B64, VIEWER_RUNTIME_B64 } from './viewerRuntime.b64';

/**
 * Builds the self-contained HTML document that renders the true-3D body map.
 *
 * The document hosts a clean outer body surface, 17 fitted heat-map regions,
 * and detailed anatomical meshes kept hidden as a fallback picking layer. It
 * runs identically inside a web `<iframe>` and a native
 * `react-native-webview`, so both platforms share one renderer.
 *
 * Theme tokens can't cross the iframe/WebView boundary, so the palette is baked
 * into the HTML at build time from `@gym/ui-tokens`.
 *
 * Bridge protocol (JSON messages, both directions):
 *   viewer → host:  { type: 'ready' }
 *                   { type: 'select', muscle: <group> }
 *   host   → viewer: { type: 'highlight', muscle: <group|null>, side?: 'front'|'back' }
 *
 * On native, RN WebView delivers host→viewer messages to `document` (Android)
 * or `window` (iOS); the viewer listens on both. viewer→host uses
 * `window.ReactNativeWebView.postMessage` when present, else `parent.postMessage`.
 *
 * Three.js, its Draco decoder, and the licensed Z-Anatomy derivative model are
 * generated into local base64 modules by `pnpm --filter mobile
 * anatomy:build-viewer`. The viewer therefore makes no network requests and
 * works in a gym with no signal. The procedural figure remains a last-resort
 * fallback if the GLB cannot be decoded.
 */

export type ViewerSide = 'front' | 'back';

export interface BuildViewerOptions {
  /** Muscle group key to highlight on first paint (null = none). */
  selected?: MuscleGroup | null;
  /** Which face to present on first paint. */
  side?: ViewerSide;
  /** Gentle idle spin until the first interaction (signals "this rotates"). */
  autoRotate?: boolean;
}

const PALETTE = {
  panel: colors.bg,
  bg: colors.bg,
  body: colors.anatomySkin,
  skin: colors.anatomySkin,
  muscle: colors.anatomyMuscle,
  muscleEdge: colors.border,
  modesty: colors.surfaceRaised,
  selected: colors.accent,
  selectedEmissive: colors.accentDim,
  heatWarm: colors.orange,
  emissiveOff: colors.bg,
  muted: colors.textDim,
  light: colors.onAccent,
  lightFill: colors.textDim,
  eyeWhite: colors.blockCream,
  eyeDark: colors.bg,
};

export function buildViewerHtml(opts: BuildViewerOptions = {}): string {
  const cfg = {
    selected: opts.selected ?? null,
    side: opts.side ?? 'front',
    autoRotate: opts.autoRotate ?? true,
    palette: PALETTE,
    groups: [...MUSCLE_GROUPS],
  };
  const cfgJson = JSON.stringify(cfg);

  // NOTE: the inner viewer script deliberately avoids template literals and
  // `${}` so it can sit inside this outer template literal without escaping.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: ${PALETTE.panel}; overflow: hidden; }
  #stage { position: fixed; inset: 0; touch-action: none; }
  canvas { display: block; width: 100%; height: 100%; outline: none; }
  #err {
    position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
    padding: 24px; box-sizing: border-box; text-align: center;
    color: ${PALETTE.muted}; font: 16px/1.5 -apple-system, system-ui, sans-serif;
  }
</style>
</head>
<body>
<div id="stage"></div>
<div id="err">3D view unavailable on this device.</div>
<script>
window.__ANATOMY_CFG__ = ${cfgJson};
window.__MUSCLES_B64__ = "${MUSCLES_GLB_B64}";
window.__VIEWER_RUNTIME_B64__ = "${VIEWER_RUNTIME_B64}";
window.__DRACO_DECODER_B64__ = "${DRACO_DECODER_B64}";
window.__ANATOMY_SEND__ = function (msg) {
  var s = JSON.stringify(msg);
  if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
    window.ReactNativeWebView.postMessage(s);
  } else if (window.parent) {
    window.parent.postMessage(s, '*');
  }
};
window.__ANATOMY_FAIL__ = function (error) {
  document.getElementById('err').style.display = 'flex';
  window.__ANATOMY_SEND__({ type: 'error', message: String(error && error.message || error) });
};
window.addEventListener('error', function (event) { window.__ANATOMY_FAIL__(event.error || event.message); });
window.addEventListener('unhandledrejection', function (event) { window.__ANATOMY_FAIL__(event.reason); });
try {
  var runtimeScript = document.createElement('script');
  runtimeScript.text = atob(window.__VIEWER_RUNTIME_B64__);
  document.head.appendChild(runtimeScript);
  window.__VIEWER_RUNTIME_B64__ = '';
} catch (error) {
  window.__ANATOMY_FAIL__(error);
}
</script>
<script>
var Runtime = window.__GYM_ANATOMY_RUNTIME__ || {};
var THREE = Runtime.THREE || {};
var OrbitControls = Runtime.OrbitControls;
var GLTFLoader = Runtime.GLTFLoader;
var DRACOLoader = Runtime.DRACOLoader;

var CFG = window.__ANATOMY_CFG__;
var P = CFG.palette;
var handleHighlight = null;

// ---- bridge --------------------------------------------------------------
function send(msg) {
  window.__ANATOMY_SEND__(msg);
}
function onHostMessage(ev) {
  var d = ev && ev.data;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
  if (!d || typeof d !== 'object' || !d.type) return;
  if (d.type === 'highlight' && handleHighlight) {
    handleHighlight(d.muscle || null, d.side || null);
  }
}
window.addEventListener('message', onHostMessage);      // web iframe + iOS WebView
document.addEventListener('message', onHostMessage);     // Android WebView

function fail(error) { window.__ANATOMY_FAIL__(error); }

try {
  main();
} catch (e) {
  fail(e);
}

function main() {
  var stage = document.getElementById('stage');
  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, stage.clientWidth < 600 ? 1.5 : 2));
  renderer.setSize(stage.clientWidth, stage.clientHeight, false);
  renderer.setClearColor(P.panel, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);

  var scene = new THREE.Scene();

  var camera = new THREE.PerspectiveCamera(32, stage.clientWidth / stage.clientHeight, 0.1, 100);
  camera.position.set(0, 1.02, 3.15);

  var controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.enablePan = false;
  controls.minDistance = 1.9;
  controls.maxDistance = 4.6;
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = 2.35;
  controls.rotateSpeed = 0.9;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.7;
  controls.update();

  // ---- lighting: soft studio separation against the app's black canvas ----
  var hemi = new THREE.HemisphereLight(P.light, P.lightFill, 0.72);
  scene.add(hemi);
  var key = new THREE.DirectionalLight(P.light, 1.35);
  key.position.set(2.2, 3.4, 2.6);
  scene.add(key);
  var fill = new THREE.DirectionalLight(P.lightFill, 0.55);
  fill.position.set(-3.0, 1.4, 1.6);
  scene.add(fill);
  var rim = new THREE.DirectionalLight(P.light, 0.65);
  rim.position.set(-2.0, 2.2, -3.0);
  scene.add(rim);

  // ---- materials ----
  var bodyMat = new THREE.MeshStandardMaterial({ color: P.body, roughness: 0.95, metalness: 0.0 });
  function skinMat() {
    return new THREE.MeshStandardMaterial({
      color: P.skin,
      roughness: 0.92,
      metalness: 0.0,
      side: THREE.DoubleSide
    });
  }
  function fabricMat() {
    return new THREE.MeshStandardMaterial({
      color: P.modesty,
      roughness: 0.85,
      metalness: 0.0,
      side: THREE.DoubleSide
    });
  }
  function eyeMat(color) {
    return new THREE.MeshStandardMaterial({ color: color, roughness: 0.42, metalness: 0.0 });
  }
  function restingMat() {
    return new THREE.MeshStandardMaterial({
      color: P.muscle,
      roughness: 0.68,
      metalness: 0.0,
      side: THREE.DoubleSide
    });
  }
  function highlightMat() {
    // Lit + emissive: scene lighting shades the glow with the body's
    // curvature so the zone reads as heated muscle, not a flat decal.
    return new THREE.MeshStandardMaterial({
      color: P.light,
      side: THREE.DoubleSide,
      vertexColors: true,
      transparent: true,
      opacity: 0.0,
      roughness: 0.5,
      metalness: 0.0,
      emissive: P.selected,
      emissiveIntensity: 0.16,
      depthTest: true,
      depthWrite: false,
      dithering: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
  }
  // Heat is the surface distance from the zone's own boundary, so the glow
  // follows the muscle region's true silhouette: a hot, near-opaque core that
  // feathers out only at the rim. Vertices are welded by position first so
  // patch seams and normal splits do not create false boundaries.
  function computeBoundaryHeat(geometry) {
    var position = geometry.getAttribute('position');
    var count = position.count;
    var indexAttr = geometry.getIndex();
    var tri = indexAttr ? indexAttr.array : null;
    var cornerCount = tri ? tri.length : count;

    var keyToCanon = {};
    var canonOf = new Int32Array(count);
    var canonX = [], canonY = [], canonZ = [];
    for (var vi = 0; vi < count; vi++) {
      var px = position.getX(vi), py = position.getY(vi), pz = position.getZ(vi);
      var key = Math.round(px * 5000) + '_' + Math.round(py * 5000) + '_' + Math.round(pz * 5000);
      var canon = keyToCanon[key];
      if (canon == null) {
        canon = canonX.length;
        keyToCanon[key] = canon;
        canonX.push(px); canonY.push(py); canonZ.push(pz);
      }
      canonOf[vi] = canon;
    }
    var canonCount = canonX.length;

    var edgeUse = {};
    var adjacency = [];
    for (var ai = 0; ai < canonCount; ai++) adjacency.push([]);
    for (var ti = 0; ti < cornerCount; ti += 3) {
      var ia = canonOf[tri ? tri[ti] : ti];
      var ib = canonOf[tri ? tri[ti + 1] : ti + 1];
      var ic = canonOf[tri ? tri[ti + 2] : ti + 2];
      var corners = [ia, ib, ic];
      for (var ei = 0; ei < 3; ei++) {
        var ea = corners[ei], eb = corners[(ei + 1) % 3];
        if (ea === eb) continue;
        var ek = ea < eb ? ea + '_' + eb : eb + '_' + ea;
        var used = edgeUse[ek] || 0;
        edgeUse[ek] = used + 1;
        if (used === 0) {
          adjacency[ea].push(eb);
          adjacency[eb].push(ea);
        }
      }
    }

    // Collect boundary edges, then drop small boundary loops (slits and pin
    // holes inside a patch) so only the region's real outline seeds the
    // field — otherwise every tiny tear draws a cold line through the glow.
    var boundaryEdges = [];
    for (var bk in edgeUse) {
      if (edgeUse[bk] !== 1) continue;
      var parts = bk.split('_');
      boundaryEdges.push([+parts[0], +parts[1]]);
    }
    if (boundaryEdges.length === 0) return null;
    var loopOf = {};
    var loopLength = [];
    function loopRoot(v) {
      var r = v;
      while (loopOf[r] !== r) r = loopOf[r];
      while (loopOf[v] !== r) { var nv = loopOf[v]; loopOf[v] = r; v = nv; }
      return r;
    }
    for (var bi = 0; bi < boundaryEdges.length; bi++) {
      var ba = boundaryEdges[bi][0], bb = boundaryEdges[bi][1];
      if (loopOf[ba] == null) loopOf[ba] = ba;
      if (loopOf[bb] == null) loopOf[bb] = bb;
      var ra = loopRoot(ba), rb = loopRoot(bb);
      if (ra !== rb) loopOf[ra] = rb;
    }
    var lengthOfRoot = {};
    var maxLoopLength = 0;
    for (bi = 0; bi < boundaryEdges.length; bi++) {
      ba = boundaryEdges[bi][0]; bb = boundaryEdges[bi][1];
      var lx = canonX[ba] - canonX[bb];
      var ly = canonY[ba] - canonY[bb];
      var lz = canonZ[ba] - canonZ[bb];
      var root = loopRoot(ba);
      var acc = (lengthOfRoot[root] || 0) + Math.sqrt(lx * lx + ly * ly + lz * lz);
      lengthOfRoot[root] = acc;
      if (acc > maxLoopLength) maxLoopLength = acc;
    }
    var minLoop = maxLoopLength * 0.3;

    var INF = 1e9;
    var dist = new Float64Array(canonCount);
    var queued = new Uint8Array(canonCount);
    var queue = [];
    for (var di = 0; di < canonCount; di++) dist[di] = INF;
    for (bi = 0; bi < boundaryEdges.length; bi++) {
      if (lengthOfRoot[loopRoot(boundaryEdges[bi][0])] < minLoop) continue;
      for (var pi = 0; pi < 2; pi++) {
        var bv = boundaryEdges[bi][pi];
        if (dist[bv] !== 0) {
          dist[bv] = 0;
          queue.push(bv);
          queued[bv] = 1;
        }
      }
    }
    if (queue.length === 0) return null;
    // SPFA relaxation: near-linear on these small surface graphs.
    for (var qi = 0; qi < queue.length; qi++) {
      var current = queue[qi];
      queued[current] = 0;
      var neighbors = adjacency[current];
      for (var ni = 0; ni < neighbors.length; ni++) {
        var next = neighbors[ni];
        var dx = canonX[current] - canonX[next];
        var dy = canonY[current] - canonY[next];
        var dz = canonZ[current] - canonZ[next];
        var candidate = dist[current] + Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (candidate < dist[next] - 1e-9) {
          dist[next] = candidate;
          if (!queued[next]) { queue.push(next); queued[next] = 1; }
        }
      }
      if (queue.length > canonCount * 40) break; // defensive: malformed graph
    }

    // Normalize against a high percentile so one deep pocket does not flatten
    // the ramp everywhere else.
    var finite = [];
    for (var fi = 0; fi < canonCount; fi++) {
      if (dist[fi] < INF) finite.push(dist[fi]);
    }
    if (finite.length === 0) return null;
    finite.sort(function (a, b) { return a - b; });
    var scale = finite[Math.min(finite.length - 1, Math.floor(finite.length * 0.95))];
    if (scale <= 1e-6) return null;

    var heat = new Float32Array(count);
    for (var hi = 0; hi < count; hi++) {
      var d = dist[canonOf[hi]];
      heat[hi] = d >= INF ? 1.0 : Math.min(1.0, d / scale);
    }
    return heat;
  }
  function applyHeatmapColors(geometry) {
    var position = geometry && geometry.getAttribute && geometry.getAttribute('position');
    if (!position || position.count === 0) return;
    function smoothstep(edge0, edge1, value) {
      var t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
      return t * t * (3 - 2 * t);
    }
    var heat = computeBoundaryHeat(geometry);
    var deep = new THREE.Color(P.selected).lerp(new THREE.Color(0x000000), 0.35);
    var hot = new THREE.Color(P.selected);
    var core = hot.clone().lerp(new THREE.Color(P.heatWarm), 0.45);
    var colors = new Float32Array(position.count * 4);
    for (var ci = 0; ci < position.count; ci++) {
      var t = heat ? Math.pow(heat[ci], 0.85) : 0.75;
      var r, g, b;
      if (t < 0.6) {
        var lowMix = t / 0.6;
        r = deep.r + (hot.r - deep.r) * lowMix;
        g = deep.g + (hot.g - deep.g) * lowMix;
        b = deep.b + (hot.b - deep.b) * lowMix;
      } else {
        var highMix = (t - 0.6) / 0.4;
        r = hot.r + (core.r - hot.r) * highMix;
        g = hot.g + (core.g - hot.g) * highMix;
        b = hot.b + (core.b - hot.b) * highMix;
      }
      // Wide feather: the glow melts into the skin instead of drawing a
      // sticker outline around the zone.
      var alpha = 0.92 * smoothstep(0.0, 0.38, t);
      var offset = ci * 4;
      colors[offset] = r;
      colors[offset + 1] = g;
      colors[offset + 2] = b;
      colors[offset + 3] = alpha;
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  }
  // scratch colors reused by the per-frame highlight tween (no per-frame allocation)
  var _tcA = new THREE.Color();
  var _tcB = new THREE.Color();

  var figure = new THREE.Group();
  scene.add(figure);
  var muscleMeshes = [];    // detailed anatomical fallback pickers
  var highlightMeshes = []; // fitted outer-surface zones shown and tapped
  var bodySurface = null;
  var activeUntil = performance.now() + 700;
  var autoRotateUntil = 0;
  // The figure is populated below — from the GLB when available, else procedurally.

  controls.addEventListener('start', function () {
    controls.autoRotate = false;
    activeUntil = Infinity;
  });
  controls.addEventListener('end', function () {
    activeUntil = performance.now() + 900;
  });

  // ---- highlight ----
  // Selection only sets a per-mesh TARGET; tick() eases the material toward it so
  // the color change is smooth instead of a rough instant swap.
  var currentSelected = null;
  var pulseUntil = 0;
  function applyHighlight(group, side) {
    currentSelected = group;
    if (group != null) pulseUntil = performance.now() + 6000;
    if (highlightMeshes.length > 0) {
      for (var hi = 0; hi < highlightMeshes.length; hi++) {
        var h = highlightMeshes[hi];
        var highlightOn = group != null && h.userData.group === group;
        h.userData.tOpacity = highlightOn ? 1.0 : 0.0;
        if (highlightOn) {
          if (h.userData.needsHeat) {
            // Deferred: the boundary-distance field is only computed the
            // first time a zone is actually shown.
            applyHeatmapColors(h.geometry);
            h.userData.needsHeat = false;
          }
          h.visible = true;
        }
      }
    } else {
      // Procedural fallback: its muscle forms are the visible highlight layer.
      for (var i = 0; i < muscleMeshes.length; i++) {
        var m = muscleMeshes[i], ud = m.userData;
        var on = group != null && ud.group === group;
        ud.tCol = on ? P.selected : P.muscle;
        ud.tEmi = on ? P.selectedEmissive : P.emissiveOff;
        ud.tEmI = on ? 0.10 : 0.0;
        ud.tRough = on ? 0.46 : 0.68;
        m.renderOrder = on ? 2 : 0;
      }
    }
    activeUntil = Math.max(activeUntil, performance.now() + 700, pulseUntil);
    if (side === 'front' || side === 'back') turnTo(side);
  }
  handleHighlight = applyHighlight;
  function highlightsSettled() {
    for (var si = 0; si < highlightMeshes.length; si++) {
      var sh = highlightMeshes[si], starget = sh.userData.tOpacity;
      if (starget == null) continue;
      if (Math.abs(sh.material.opacity - starget) > 0.004) return false;
    }
    return true;
  }
  function stepHighlight() {
    var k = 0.16; // easing per frame (~0.3s to settle)
    // Breathing pulse after each selection; the amplitude damps to zero over
    // the last second so the glow settles at its resting intensity instead
    // of freezing mid-swell when the render loop pauses.
    var pulseNow = performance.now();
    var damp = Math.max(0, Math.min(1, (pulseUntil - pulseNow) / 1000));
    var glow = 0.16 + 0.14 * damp * (0.5 + 0.5 * Math.sin(pulseNow * 0.0045));
    for (var hi = 0; hi < highlightMeshes.length; hi++) {
      var h = highlightMeshes[hi], target = h.userData.tOpacity;
      if (target == null) continue;
      h.material.opacity += (target - h.material.opacity) * k;
      if (h.visible && target === 1) h.material.emissiveIntensity = glow;
      if (target === 0 && h.material.opacity < 0.01) {
        h.material.opacity = 0;
        h.visible = false;
      }
    }
    if (highlightMeshes.length > 0) return;
    for (var i = 0; i < muscleMeshes.length; i++) {
      var m = muscleMeshes[i], ud = m.userData;
      if (ud.tCol == null) continue;
      m.material.color.lerp(_tcA.set(ud.tCol), k);
      m.material.emissive.lerp(_tcB.set(ud.tEmi), k);
      m.material.emissiveIntensity += (ud.tEmI - m.material.emissiveIntensity) * k;
      m.material.roughness += (ud.tRough - m.material.roughness) * k;
    }
  }

  // ---- camera turn to a face (front/back) ----
  var azTarget = null;   // desired azimuth in radians, or null when settled
  function turnTo(side) {
    controls.autoRotate = false;
    azTarget = side === 'back' ? Math.PI : 0;
    activeUntil = performance.now() + 900;
  }
  function currentAzimuth() { return controls.getAzimuthalAngle(); }
  function setAzimuth(a) {
    var t = controls.target;
    var dx = camera.position.x - t.x;
    var dz = camera.position.z - t.z;
    var r = Math.sqrt(dx * dx + dz * dz);
    camera.position.x = t.x + r * Math.sin(a);
    camera.position.z = t.z + r * Math.cos(a);
  }

  // ---- tap picking (distinguish tap from orbit drag) ----
  var raycaster = new THREE.Raycaster();
  var ptr = new THREE.Vector2();
  var downX = 0, downY = 0, downT = 0, moved = false;
  renderer.domElement.addEventListener('pointerdown', function (e) {
    controls.autoRotate = false;
    azTarget = null;
    activeUntil = Infinity;
    downX = e.clientX; downY = e.clientY; downT = Date.now(); moved = false;
  });
  renderer.domElement.addEventListener('pointermove', function (e) {
    if (Math.abs(e.clientX - downX) > 6 || Math.abs(e.clientY - downY) > 6) moved = true;
  });
  renderer.domElement.addEventListener('pointerup', function (e) {
    activeUntil = performance.now() + 900;
    if (moved || Date.now() - downT > 500) return;
    var rect = renderer.domElement.getBoundingClientRect();
    ptr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ptr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ptr, camera);
    // Prefer the clean fitted regions as colliders: they exactly match what the
    // user sees and are much cheaper to hit-test than the detailed anatomy.
    var pickMeshes = highlightMeshes.length > 0 ? highlightMeshes : muscleMeshes;
    var hits = raycaster.intersectObjects(pickMeshes, false);
    if (hits.length > 0) {
      var g = hits[0].object.userData.group;
      if (g) { applyHighlight(g, null); send({ type: 'select', muscle: g }); }
    }
  });
  renderer.domElement.addEventListener('pointercancel', function () {
    activeUntil = performance.now() + 900;
  });

  // ---- resize ----
  function resize() {
    var w = stage.clientWidth, h = stage.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    activeUntil = performance.now() + 250;
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  window.addEventListener('resize', resize);

  // ---- loop ----
  function tick(now) {
    requestAnimationFrame(tick);
    if (controls.autoRotate && now >= autoRotateUntil) {
      controls.autoRotate = false;
      activeUntil = now + 900;
    }
    // Never pause the loop mid-fade: on slow devices the easing needs more
    // frames than the fixed activity window provides.
    if (!controls.autoRotate && azTarget == null && now >= activeUntil && highlightsSettled()) return;
    if (azTarget != null) {
      var cur = currentAzimuth();
      var diff = azTarget - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < 0.01) { setAzimuth(azTarget); azTarget = null; }
      else setAzimuth(cur + diff * 0.16);
    }
    stepHighlight();
    controls.update();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);

  // ---- populate the figure: real GLB model, procedural fallback on any failure ----
  function ready() {
    setAzimuth(CFG.side === 'back' ? Math.PI : 0);
    controls.update();
    applyHighlight(CFG.selected, null);
    controls.autoRotate = !!CFG.autoRotate;
    autoRotateUntil = performance.now() + 3500;
    activeUntil = autoRotateUntil + 900;
    send({ type: 'ready' });
  }
  function useProcedural() {
    buildFigure(figure, bodyMat, muscleMeshes, restingMat);
    figure.position.y = 0.02;   // vertical nudge to sit in frame
    ready();
  }
  var b64 = window.__MUSCLES_B64__ || '';
  if (!b64) {
    useProcedural();
  } else {
    try {
      var bin = atob(b64), n = bin.length, bytes = new Uint8Array(n);
      for (var bi = 0; bi < n; bi++) bytes[bi] = bin.charCodeAt(bi);
      var gltfLoader = new GLTFLoader();
      var dracoLoader = new DRACOLoader();
      var dracoSource = null;
      dracoLoader.setDecoderConfig({ type: 'js' });
      dracoLoader._loadLibrary = function () {
        if (dracoSource == null) {
          dracoSource = atob(window.__DRACO_DECODER_B64__ || '');
          window.__DRACO_DECODER_B64__ = '';
        }
        return Promise.resolve(dracoSource);
      };
      gltfLoader.setDRACOLoader(dracoLoader);
      window.__MUSCLES_B64__ = '';
      gltfLoader.parse(bytes.buffer, '', function (gltf) {
        var root = gltf.scene;
        var valid = CFG.groups || [];
        root.traverse(function (o) {
          if (!o.isMesh) return;
          // three.js GLTFLoader sanitizes node names (space -> underscore), so
          // 'lower back'/'middle back' arrive as 'lower_back'/'middle_back'.
          // Restore spaces so the tag equals the app's MuscleGroup key.
          var nm = (o.name || (o.parent && o.parent.name) || '').replace(/_/g, ' ');
          if (o.geometry && !o.geometry.getAttribute('normal') && o.geometry.computeVertexNormals) {
            o.geometry.computeVertexNormals();
          }
          if (nm === 'body surface') {
            o.material = skinMat();
            o.renderOrder = 0;
            bodySurface = o;
          } else if (nm === 'modesty shorts' || nm === 'modesty bridge') {
            // Real garment geometry baked in the GLB: an offset fabric shell
            // with straight waistband and hem cuts, plus the pubic-gap plug.
            o.material = fabricMat();
            o.renderOrder = 0;
          } else if (nm === 'eye whites') {
            o.material = eyeMat(P.eyeWhite);
            o.renderOrder = 1;
          } else if (nm === 'eye irises') {
            o.material = eyeMat(P.eyeDark);
            o.renderOrder = 2;
          } else if (nm.indexOf('highlight ') === 0) {
            var highlightGroup = nm.slice(10);
            if (valid.indexOf(highlightGroup) === -1) {
              o.visible = false;
              return;
            }
            o.material = highlightMat();
            o.userData.group = highlightGroup;
            o.userData.needsHeat = true;
            o.userData.tOpacity = 0.0;
            o.renderOrder = 10;
            o.visible = false;
            highlightMeshes.push(o);
          } else if (valid.indexOf(nm) !== -1) {
            o.material = restingMat();
            o.userData.group = nm;
            // Keep the source anatomy for raycast hit-testing, but never expose
            // its deep layers as the body's visible surface.
            o.visible = false;
            muscleMeshes.push(o);
          } else {
            o.visible = false;
          }
        });
        // The source atlas contains bilateral structures, but a linked-data
        // edge case in some Blender exports can collapse one side (the source
        // shoulder mesh is the known example). Mirror only groups whose entire
        // exported bound sits on one side of the body's centre line.
        var bilateral = ['chest', 'lats', 'shoulders', 'biceps', 'triceps', 'forearms',
          'quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors'];
        for (var gi = 0; gi < bilateral.length; gi++) {
          var group = bilateral[gi];
          var groupMeshes = muscleMeshes.filter(function (mesh) { return mesh.userData.group === group; });
          if (groupMeshes.length !== 1) continue;
          var groupBox = new THREE.Box3().setFromObject(groupMeshes[0]);
          if (groupBox.max.x < -0.001 || groupBox.min.x > 0.001) {
            var mirrored = groupMeshes[0].clone();
            mirrored.name = groupMeshes[0].name + '_mirrored';
            mirrored.scale.x *= -1;
            mirrored.material = restingMat();
            mirrored.userData.group = group;
            groupMeshes[0].parent.add(mirrored);
            muscleMeshes.push(mirrored);
          }
        }
        // center the model on the orbit target (0, 1, 0) so the existing camera frames it
        var box = new THREE.Box3().setFromObject(bodySurface || root);
        var ctr = box.getCenter(new THREE.Vector3());
        root.position.set(-ctr.x, 1.0 - ctr.y, -ctr.z);
        figure.add(root);
        ready();
      }, function () { useProcedural(); });
    } catch (e) {
      useProcedural();
    }
  }
}

// ==========================================================================
// Procedural écorché figure. Base silhouette in dark charcoal; one named,
// recolorable mesh per muscle group sits proud of it. Bilateral groups get a
// mirrored pair that share the same group name.
// ==========================================================================
function buildFigure(figure, bodyMat, muscleMeshes, restingMat) {
  var SEG = 24;
  var unitSphere = new THREE.SphereGeometry(1, SEG, SEG);

  function ellipsoid(rx, ry, rz) {
    var m = new THREE.Mesh(unitSphere, null);
    m.scale.set(rx, ry, rz);
    return m;
  }
  // base (non-pickable) body part
  function base(rx, ry, rz, x, y, z, rotX, rotZ) {
    var m = ellipsoid(rx, ry, rz);
    m.material = bodyMat;
    m.position.set(x, y, z);
    if (rotX) m.rotation.x = rotX;
    if (rotZ) m.rotation.z = rotZ;
    figure.add(m);
    return m;
  }
  // one muscle belly, tagged with its group; returns the mesh
  function muscle(group, rx, ry, rz, x, y, z, rotX, rotZ) {
    var m = ellipsoid(rx, ry, rz);
    m.material = restingMat();
    m.position.set(x, y, z);
    if (rotX) m.rotation.x = rotX;
    if (rotZ) m.rotation.z = rotZ;
    m.userData.group = group;
    figure.add(m);
    muscleMeshes.push(m);
    return m;
  }
  // muscle + its left/right mirror across x
  function pair(group, rx, ry, rz, x, y, z, rotX, rotZ) {
    muscle(group, rx, ry, rz, x, y, z, rotX, rotZ);
    muscle(group, rx, ry, rz, -x, y, z, rotX, rotZ ? -rotZ : rotZ);
  }

  // ---- base silhouette ----
  base(0.135, 0.155, 0.135, 0, 1.60, 0);                 // head
  base(0.062, 0.075, 0.062, 0, 1.475, 0);                // neck column
  base(0.175, 0.255, 0.115, 0, 1.17, 0);                 // trunk
  base(0.155, 0.11, 0.115, 0, 0.915, 0);                 // pelvis
  base(0.052, 0.16, 0.052, 0.235, 1.17, 0, 0, 0.06);     // upper arm R
  base(0.052, 0.16, 0.052, -0.235, 1.17, 0, 0, -0.06);   // upper arm L
  base(0.044, 0.15, 0.044, 0.275, 0.86, 0.01, 0, 0.05);  // forearm R
  base(0.044, 0.15, 0.044, -0.275, 0.86, 0.01, 0, -0.05);// forearm L
  base(0.05, 0.06, 0.055, 0.29, 0.70, 0.02);             // hand R
  base(0.05, 0.06, 0.055, -0.29, 0.70, 0.02);            // hand L
  base(0.092, 0.185, 0.095, 0.098, 0.60, 0, 0, 0.02);    // thigh R
  base(0.092, 0.185, 0.095, -0.098, 0.60, 0, 0, -0.02);  // thigh L
  base(0.062, 0.165, 0.066, 0.092, 0.27, -0.01);         // shin R
  base(0.062, 0.165, 0.066, -0.092, 0.27, -0.01);        // shin L
  base(0.06, 0.045, 0.11, 0.092, 0.03, 0.05);            // foot R
  base(0.06, 0.045, 0.11, -0.092, 0.03, 0.05);           // foot L

  // ---- front muscle groups ----
  pair('chest', 0.086, 0.062, 0.055, 0.076, 1.31, 0.10);
  pair('shoulders', 0.072, 0.07, 0.072, 0.19, 1.37, 0.0);
  pair('biceps', 0.042, 0.085, 0.046, 0.238, 1.20, 0.05, 0, 0.06);
  pair('forearms', 0.038, 0.115, 0.046, 0.275, 0.90, 0.02, 0, 0.05);
  pair('quadriceps', 0.072, 0.155, 0.072, 0.10, 0.62, 0.055, 0, 0.02);
  pair('adductors', 0.04, 0.12, 0.052, 0.045, 0.60, 0.02, 0, 0.03);
  pair('neck', 0.024, 0.062, 0.03, 0.045, 1.46, 0.05);
  // abdominals: central column + obliques (all one group)
  muscle('abdominals', 0.072, 0.05, 0.05, 0, 1.20, 0.115);
  muscle('abdominals', 0.075, 0.05, 0.052, 0, 1.11, 0.12);
  muscle('abdominals', 0.07, 0.048, 0.05, 0, 1.02, 0.115);
  pair('abdominals', 0.03, 0.075, 0.045, 0.092, 1.10, 0.095);   // obliques

  // ---- back muscle groups ----
  muscle('traps', 0.135, 0.10, 0.055, 0, 1.36, -0.055);
  muscle('middle back', 0.11, 0.095, 0.05, 0, 1.24, -0.09);
  muscle('lower back', 0.085, 0.085, 0.055, 0, 1.02, -0.10);
  pair('lats', 0.072, 0.13, 0.06, 0.118, 1.17, -0.06, 0, -0.16);
  pair('glutes', 0.082, 0.072, 0.075, 0.078, 0.915, -0.085);
  pair('hamstrings', 0.066, 0.14, 0.066, 0.10, 0.60, -0.07, 0, 0.02);
  pair('calves', 0.052, 0.11, 0.062, 0.092, 0.30, -0.065);
  pair('abductors', 0.05, 0.09, 0.062, 0.158, 0.85, 0.0);
}
</script>
</body>
</html>`;
}
