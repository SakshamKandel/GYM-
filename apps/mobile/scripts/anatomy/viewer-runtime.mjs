import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// This entry is bundled to a classic browser script by build_viewer_assets.mjs.
// Keeping Three.js out of Metro's runtime graph lets the same offline renderer
// run inside both a native WebView and the web iframe.
globalThis.__GYM_ANATOMY_RUNTIME__ = {
  THREE: {
    ACESFilmicToneMapping,
    Box3,
    Color,
    DirectionalLight,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    HemisphereLight,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    PerspectiveCamera,
    Raycaster,
    Scene,
    SphereGeometry,
    SRGBColorSpace,
    Vector2,
    Vector3,
    WebGLRenderer,
  },
  OrbitControls,
  GLTFLoader,
  DRACOLoader,
};
