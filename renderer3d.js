// Far Rover WebGL board renderer (three.js r170, vendored).
// Visual only: reads sim state, never writes rules or ticks.

import * as THREE from './vendor/three.module.js';
import {
  tileCloudTarget,
  cloudFadeDuration,
  prefersReducedMotion,
  CLOUD_HIDDEN,
  CLOUD_CAMERA
} from './renderer.js';

const GRID_COLS = 12;
const GRID_ROWS = 12;
const LANDER_COL = 5;
const LANDER_ROW = 12;
const WORLD = 48;
const SEGMENTS = 96;
const COV = 64;

const FACE_Y = { north: 0, east: Math.PI / 2, south: Math.PI, west: -Math.PI / 2 };

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return !!gl;
  } catch {
    return false;
  }
}

export function shouldUse3D() {
  if (typeof location === 'undefined') return false;
  const q = new URLSearchParams(location.search).get('renderer');
  if (q === '2d') return false;
  return webglAvailable();
}

function hash2(ix, iy, seed) {
  const n = Math.sin(ix * 127.1 + iy * 311.7 + seed * 19.19) * 43758.5453;
  return n - Math.floor(n);
}

function lerp(a, b, t) { return a + (b - a) * t; }

function cellCenter(col, row) {
  return new THREE.Vector3(col - (GRID_COLS - 1) / 2, 0, row - (GRID_COLS - 1) / 2);
}

function tileKnown(state, col, row) {
  return !!(state?.revealed?.[row]?.[col] || state?.cameraSeen?.[row]?.[col]);
}

function parseCraterCell(state) {
  const cell = state?.readings?.craterInFront;
  if (!cell?.detected || !cell.cell || cell.cell === 'Lander') return null;
  const s = String(cell.cell);
  const col = s.charCodeAt(0) - 65;
  const row = parseInt(s.slice(1), 10) - 1;
  if (col < 0 || col > 11 || row < 0 || row > 11 || Number.isNaN(row)) return null;
  return { col, row };
}

function knownCrater(state, col, row) {
  if (!state?.terrain) return false;
  if (state.terrain[row]?.[col] !== 'crater') return false;
  if (tileKnown(state, col, row)) return true;
  const ahead = parseCraterCell(state);
  return !!(ahead && ahead.col === col && ahead.row === row);
}

function heightAt(x, z, state) {
  let y = (hash2(Math.floor(x * 0.55), Math.floor(z * 0.55), 0.3) - 0.5) * 0.42;
  y += (hash2(Math.floor(x * 2.1), Math.floor(z * 2.1), 1.7) - 0.5) * 0.26;
  y += (hash2(Math.floor(x * 6.2), Math.floor(z * 6.2), 4.1) - 0.5) * 0.11;
  y += (hash2(Math.floor(x * 18), Math.floor(z * 18), 8.8) - 0.5) * 0.04;
  const col = x + (GRID_COLS - 1) / 2;
  const row = z + (GRID_ROWS - 1) / 2;
  if (col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS) {
    const c = Math.min(11, Math.max(0, Math.floor(col)));
    const r = Math.min(11, Math.max(0, Math.floor(row)));
    if (knownCrater(state, c, r)) {
      const dx = col - c - 0.5;
      const dz = row - r - 0.5;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 0.52) y -= (1 - d / 0.52) * 0.82;
      else if (d < 0.70) y += (1 - Math.abs(d - 0.60) / 0.10) * 0.16;
    }
  }
  return y;
}

function loadTexture(path) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      resolve(tex);
    };
    img.onerror = () => resolve(null);
    img.src = path;
  });
}

function makeNoiseTexture() {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = hash2(x, y, 3.2);
      const n2 = hash2(x, y, 9.1);
      const i = (y * size + x) * 4;
      data[i] = n * 255;
      data[i + 1] = n2 * 255;
      data[i + 2] = ((n + n2) * 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function createHazeMaterial(coverageTex, noiseTex) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      uCoverage: { value: coverageTex },
      uNoise: { value: noiseTex },
      uTime: { value: 0 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uCoverage;
      uniform sampler2D uNoise;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float n = texture2D(uNoise, vUv * 0.55 + vec2(uTime * 0.003, 0.0)).r;
        float cov = texture2D(uCoverage, vUv).r;
        float hidden = smoothstep(0.55, 0.92, cov);
        float cam = (1.0 - hidden) * smoothstep(0.08, 0.55, cov);
        float a = hidden * 0.16 + cam * 0.07;
        a *= 0.88 + 0.12 * n;
        if (a < 0.02) discard;
        vec3 col = vec3(0.05, 0.032, 0.022);
        gl_FragColor = vec4(col, a);
      }
    `
  });
}

function addBox(parent, w, h, d, color, x, y, z, rx = 0, rz = 0, opts = {}) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.72,
      metalness: opts.metalness ?? 0.18,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1
    })
  );
  mesh.position.set(x, y, z);
  mesh.rotation.x = rx;
  mesh.rotation.z = rz;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createRover() {
  const g = new THREE.Group();
  g.name = 'rover';
  addBox(g, 0.50, 0.14, 0.36, 0xb4bac2, 0, 0.22, 0);
  addBox(g, 0.44, 0.02, 0.30, 0x1b3a5c, 0, 0.30, 0, 0, 0, { roughness: 0.35, metalness: 0.4 });
  const mast = addBox(g, 0.03, 0.32, 0.03, 0xb8bec6, 0.08, 0.48, -0.04);
  addBox(mast, 0.11, 0.055, 0.07, 0x4b5563, 0, 0.18, -0.03);
  addBox(mast, 0.04, 0.04, 0.03, 0x111827, 0, 0.18, -0.07, 0, 0, { emissive: 0x112233, emissiveIntensity: 0.4 });
  const antenna = addBox(g, 0.012, 0.28, 0.012, 0xc5cad0, -0.14, 0.46, 0.08);
  addBox(antenna, 0.04, 0.01, 0.04, 0xdfe3e8, 0, 0.15, 0);
  const drill = addBox(g, 0.04, 0.18, 0.04, 0x6b7280, 0.18, 0.22, 0.02);
  const bit = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.01, 0.16, 8),
    new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.6, roughness: 0.3 })
  );
  bit.position.set(0, -0.14, 0);
  drill.add(bit);
  g.userData.drill = drill;
  g.userData.drillBit = bit;

  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x88ffcc, emissive: 0x226644, roughness: 0.35 })
  );
  light.position.set(0, 0.24, -0.20);
  light.name = 'statusLight';
  g.add(light);
  const head = new THREE.PointLight(0xffe6c8, 1.65, 9.0, 1.4);
  head.position.set(0, 0.26, -0.22);
  g.add(head);

  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.07, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1f2430, roughness: 0.9 });
  [[-0.20, -0.17], [-0.20, 0], [-0.20, 0.17], [0.20, -0.17], [0.20, 0], [0.20, 0.17]].forEach(([x, z]) => {
    const w = new THREE.Mesh(wheelGeo, wheelMat.clone());
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.095, z);
    w.castShadow = true;
    g.add(w);
    wheels.push(w);
  });
  g.userData.wheels = wheels;
  g.userData.light = light;
  g.scale.setScalar(1.28);
  return g;
}

function createLander() {
  const g = new THREE.Group();
  g.name = 'lander';
  addBox(g, 0.78, 0.30, 0.78, 0x9aa3ad, 0, 0.44, 0);
  addBox(g, 0.52, 0.04, 0.52, 0xc9a227, 0, 0.61, 0, 0, 0, { metalness: 0.45, roughness: 0.4 });
  [[-1, 0], [1, 0]].forEach(([sx]) => {
    const panel = addBox(g, 0.72, 0.02, 0.34, 0x1e3a5f, sx * 0.62, 0.52, 0, 0, sx * 0.18, {
      metalness: 0.35,
      roughness: 0.28,
      emissive: 0x061018
    });
    panel.castShadow = true;
  });
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45),
    new THREE.MeshStandardMaterial({ color: 0xd7dbe2, roughness: 0.35, metalness: 0.4, side: THREE.DoubleSide })
  );
  dish.position.set(0.12, 0.86, -0.08);
  dish.rotation.x = 0.5;
  dish.castShadow = true;
  g.add(dish);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.6, metalness: 0.3 });
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.055, 0.72, 6), legMat);
    leg.position.set(sx * 0.40, 0.22, sz * 0.40);
    leg.rotation.x = sz * 0.28;
    leg.rotation.z = -sx * 0.28;
    leg.castShadow = true;
    g.add(leg);
  });
  const glow = new THREE.PointLight(0x66ddff, 0, 3.8, 2);
  glow.position.set(0, 0.55, 0);
  glow.name = 'chargeGlow';
  g.add(glow);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x66ddff, transparent: true, opacity: 0, depthWrite: false })
  );
  halo.position.set(0, 0.48, 0);
  halo.name = 'chargeHalo';
  g.add(halo);
  return g;
}

function createRockInstancer(offCount, onCount) {
  const total = offCount + onCount;
  const geo = new THREE.DodecahedronGeometry(0.10, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x6e3c26, roughness: 0.96, metalness: 0.03 });
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  let placed = 0;
  let guard = 0;
  while (placed < onCount && guard < onCount * 14) {
    guard++;
    const col = hash2(guard, 3, 2.1) * 12;
    const row = hash2(guard, 5, 3.4) * 12;
    const x = col - 6 + (hash2(guard, 7, 1.2) - 0.5) * 0.82;
    const z = row - 6 + (hash2(guard, 8, 1.5) - 0.5) * 0.82;
    dummy.position.set(x, 0.03, z);
    dummy.rotation.set(hash2(guard, 8, 1) * 2, hash2(guard, 9, 1) * 6, hash2(guard, 10, 1));
    dummy.scale.setScalar(0.22 + hash2(guard, 11, 1) * 1.15);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  guard = 0;
  const offStart = placed;
  while (placed < offStart + offCount && guard < offCount * 8) {
    guard++;
    const x = (hash2(guard, 2, 1.1) - 0.5) * WORLD * 0.92;
    const z = (hash2(guard, 4, 2.2) - 0.5) * WORLD * 0.92;
    const onBoard = Math.abs(x) < 6.4 && Math.abs(z) < 6.4;
    if (onBoard) continue;
    dummy.position.set(x, 0.04, z);
    dummy.rotation.set(hash2(guard, 8, 1) * 2, hash2(guard, 9, 1) * 6, hash2(guard, 10, 1));
    dummy.scale.setScalar(0.55 + hash2(guard, 11, 1) * 1.8);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function isLiteGL() {
  if (typeof navigator !== 'undefined' && navigator.webdriver) return true;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return true;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || '') : '';
    return /swiftshader|llvmpipe|softpipe|microsoft basic render|cpu/i.test(gpu);
  } catch {
    return true;
  }
}

export class GameRenderer3D {
  constructor(container, gameState) {
    if (!webglAvailable()) throw new Error('WebGL unavailable');
    this.container = container;
    this.gameState = gameState;
    this.playbackSpeed = 1;
    this.reduceMotion = prefersReducedMotion();
    this.gridForced = false;
    this.hovering = false;
    this.pausedHint = true;
    this.cloudDisplay = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(CLOUD_HIDDEN));
    this.cloudTarget = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(CLOUD_HIDDEN));
    this.cloudFadeFrom = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(CLOUD_HIDDEN));
    this.cloudFading = false;
    this.cloudInitialized = false;
    this.cloudFadeStart = 0;
    this.knownCraterKey = '';
    this.visKey = '';
    this.lastCargo = gameState?.cargo || 0;
    this.lastDrilled = 0;
    this.lastFacing = gameState?.facing || 'north';
    this.anim = { active: false };
    this.tracks = [];
    this.particles = [];
    this.drillT = 0;
    this.craterLossing = false;
    this.fps = 0;
    this._frames = 0;
    this._fpsT = 0;
    this.clock = new THREE.Clock();
    this.disposed = false;
    this.lite = isLiteGL();

    this.sensorLayers = { camera: true, lidar: false, thermal: false, spectral: false };
    this.layerKey = '';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x3a2418);
    this.scene.fog = null;
    this.pipBg = new THREE.Color(0xd09a68);
    this.orbitalBg = new THREE.Color(0x3a2418);
    this.groundFog = new THREE.Fog(0xc07a4a, 7.5, 28);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.12, 220);
    this.camTarget = new THREE.Vector3(0, 0.0, 0.0);
    this.camSpherical = new THREE.Spherical(16.6, 0.09, 0.0);
    this.camDefault = this.camSpherical.clone();
    this._userFramed = false;
    this._applyCamera();
    this.camera.layers.enable(0);
    this.camera.layers.enable(1);
    this.camera.layers.enable(2);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.lite,
      alpha: false,
      powerPreference: this.lite ? 'low-power' : 'high-performance'
    });
    this.renderer.setPixelRatio(this.lite ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;
    this.renderer.setClearColor(0x3a2418, 1);
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'game-canvas';
    this.canvas.dataset.engine = 'webgl';

    this._lights();
    this._sky();
    this.coverageData = new Uint8Array(COV * COV * 4);
    this.coverageTex = new THREE.DataTexture(this.coverageData, COV, COV, THREE.RGBAFormat);
    this.coverageTex.magFilter = THREE.LinearFilter;
    this.coverageTex.minFilter = THREE.LinearFilter;
    this.coverageTex.flipY = false;
    this.coverageTex.generateMipmaps = false;
    this.coverageTex.needsUpdate = true;
    this.noiseTex = makeNoiseTexture();

    this.splatData = new Uint8Array(GRID_COLS * GRID_ROWS * 4);
    this.splatTex = new THREE.DataTexture(this.splatData, GRID_COLS, GRID_ROWS, THREE.RGBAFormat);
    this.splatTex.magFilter = THREE.LinearFilter;
    this.splatTex.minFilter = THREE.LinearFilter;
    this.splatTex.flipY = false;
    this.splatTex.needsUpdate = true;

    this._coverUniforms = [];
    this.terrain = this._makeTerrain();
    this.scene.add(this.terrain);
    this.gridHelper = this._makeGrid();
    this.scene.add(this.gridHelper);
    this.craterRings = new THREE.Group();
    this.scene.add(this.craterRings);
    this.lidarGroup = new THREE.Group();
    this.lidarGroup.visible = false;
    this.scene.add(this.lidarGroup);
    this.thermalGroup = new THREE.Group();
    this.thermalGroup.visible = false;
    this.scene.add(this.thermalGroup);
    this.spectralGroup = new THREE.Group();
    this.spectralGroup.visible = false;
    this.scene.add(this.spectralGroup);
    this.reticle = this._makeReticle();
    this.scene.add(this.reticle);
    this.rocks = createRockInstancer(this.lite ? 40 : 90, this.lite ? 80 : 220);
    this.rocks.material.onBeforeCompile = (shader) => {
      shader.uniforms.uCoverage = { value: this.coverageTex };
      shader.uniforms.uCoverAmt = { value: 1.0 };
      this._coverUniforms.push(shader.uniforms.uCoverAmt);
      shader.vertexShader = `varying vec3 vWorldPos;\n` + shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
      shader.fragmentShader = `uniform sampler2D uCoverage; uniform float uCoverAmt; varying vec3 vWorldPos;\n` + shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         vec2 buv = vec2(vWorldPos.x + 6.0, vWorldPos.z + 6.0) / 12.0;
         float onB = step(0.0, buv.x) * step(0.0, buv.y) * step(buv.x, 1.0) * step(buv.y, 1.0);
         float cov = mix(0.82, texture2D(uCoverage, clamp(vec2(buv.x, 1.0 - buv.y), 0.0, 1.0)).r, onB);
         float hiddenAmt = smoothstep(0.52, 0.92, cov);
         diffuseColor.rgb *= mix(1.0, 0.55, hiddenAmt * uCoverAmt);
        `
      );
    };
    this.scene.add(this.rocks);
    this.oreMarks = new THREE.Group();
    this.scene.add(this.oreMarks);

    this.cloudLayers = [];
    {
      const mat = createHazeMaterial(this.coverageTex, this.noiseTex);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(12.6, 12.6), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, 0.55, 0);
      mesh.renderOrder = 10;
      mesh.layers.set(2);
      this.scene.add(mesh);
      this.cloudLayers.push(mesh);
    }

    this.rover = createRover();
    this.lander = createLander();
    this.scene.add(this.rover);
    this.scene.add(this.lander);
    this._initRoverCam();

    this.trackCanvas = document.createElement('canvas');
    this.trackCanvas.width = this.trackCanvas.height = 512;
    this.trackCtx = this.trackCanvas.getContext('2d');
    this.trackTex = new THREE.CanvasTexture(this.trackCanvas);
    this.trackTex.colorSpace = THREE.SRGBColorSpace;
    this.trackTex.flipY = true;
    const trackMat = new THREE.MeshBasicMaterial({
      map: this.trackTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.9
    });
    this.trackPlane = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), trackMat);
    this.trackPlane.rotation.x = -Math.PI / 2;
    this.trackPlane.position.y = 0.035;
    this.trackPlane.renderOrder = 2;
    this.scene.add(this.trackPlane);

    this.dust = this._makeDust();
    this.dust.layers.set(2);
    this.scene.add(this.dust);
    this._makePuffs();
    this.puffPts.layers.set(2);

    this._loadArt();
    this.syncCloudTargets(true);
    this._placeActors(true);
    this._syncSensorOverlays(true);
    this._bindInput();
  }

  _lights() {
    const hemi = new THREE.HemisphereLight(0xc8b098, 0x5a2e18, 0.46);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd4a0, 2.25);
    sun.position.set(-12, 20, -10);
    sun.castShadow = !this.lite;
    sun.shadow.mapSize.set(this.lite ? 512 : 1024, this.lite ? 512 : 1024);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 48;
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 16;
    sun.shadow.camera.bottom = -16;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    this.sun = sun;
    this.sunDefault = 2.25;
    this.scene.add(new THREE.AmbientLight(0xffc8a0, 0.20));
  }

  _sky() {
    const skyGeo = new THREE.SphereGeometry(90, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0xe8c7a0) },
        mid: { value: new THREE.Color(0xd08958) },
        bot: { value: new THREE.Color(0x8a4a2a) }
      },
      vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
        void main(){
          float h = normalize(vP).y;
          vec3 c = mix(bot, mid, smoothstep(-0.15, 0.08, h));
          c = mix(c, top, smoothstep(0.08, 0.55, h));
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.skyMesh.layers.set(3);
    this.skyMesh.visible = false;
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);
  }

  _makeTerrain() {
    const geo = new THREE.PlaneGeometry(WORLD, WORLD, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    this._applyHeights(geo, this.gameState);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc45e34,
      roughness: 0.92,
      metalness: 0.02,
      vertexColors: true
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSplat = { value: this.splatTex };
      shader.uniforms.uDustTex = { value: this.maps?.dust || this.splatTex };
      shader.uniforms.uOreTex = { value: this.maps?.ore || this.splatTex };
      shader.uniforms.uCraterTex = { value: this.maps?.crater || this.splatTex };
      shader.uniforms.uCoverage = { value: this.coverageTex };
      shader.uniforms.uCoverAmt = { value: 1.0 };
      this._terrainShader = shader;
      this._coverUniforms.push(shader.uniforms.uCoverAmt);
      shader.vertexShader = `
        varying vec3 vWorldPos;
      ` + shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
      shader.fragmentShader = `
        uniform sampler2D uSplat;
        uniform sampler2D uDustTex;
        uniform sampler2D uOreTex;
        uniform sampler2D uCraterTex;
        uniform sampler2D uCoverage;
        uniform float uCoverAmt;
        varying vec3 vWorldPos;
      ` + shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         vec2 buv = vec2(vWorldPos.x + 6.0, vWorldPos.z + 6.0) / 12.0;
         float onB = step(0.0, buv.x) * step(0.0, buv.y) * step(buv.x, 1.0) * step(buv.y, 1.0);
         vec4 sp = texture2D(uSplat, buv);
         vec2 ruv = vWorldPos.xz * 0.55;
         vec3 dustC = texture2D(uDustTex, ruv).rgb;
         vec3 oreC = texture2D(uOreTex, ruv).rgb;
         vec3 crC = texture2D(uCraterTex, ruv).rgb;
         diffuseColor.rgb = mix(diffuseColor.rgb, dustC, sp.r * onB);
         diffuseColor.rgb = mix(diffuseColor.rgb, oreC, sp.g * onB);
         diffuseColor.rgb = mix(diffuseColor.rgb, crC, sp.b * onB);
         float cov = mix(0.78, texture2D(uCoverage, clamp(vec2(buv.x, 1.0 - buv.y), 0.0, 1.0)).r, onB);
         float hiddenAmt = smoothstep(0.52, 0.92, cov) * uCoverAmt;
         float camAmt = (1.0 - hiddenAmt) * smoothstep(0.06, 0.52, cov) * uCoverAmt;
         float drivenAmt = (1.0 - hiddenAmt) * (1.0 - camAmt) * onB * uCoverAmt;
         float luma = dot(diffuseColor.rgb, vec3(0.36, 0.28, 0.16));
         vec3 gray = vec3(luma * 0.92, luma * 0.62, luma * 0.42);
         vec3 dimmed = mix(diffuseColor.rgb, gray, hiddenAmt * 0.42 + camAmt * 0.18);
         dimmed *= mix(1.0, 0.58, hiddenAmt);
         dimmed *= mix(1.0, 0.82, camAmt);
         dimmed *= mix(1.0, 1.16, drivenAmt);
         diffuseColor.rgb = dimmed;
        `
      ).replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
         float nx = fract(sin(dot(vWorldPos.xz, vec2(127.1, 311.7))) * 43758.5453);
         float nz = fract(sin(dot(vWorldPos.xz, vec2(269.5, 183.3))) * 43758.5453);
         normal = normalize(normal + vec3(nx - 0.5, 0.0, nz - 0.5) * 0.28);
        `
      );
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  _applyHeights(geo, state) {
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = heightAt(x, z, state);
      pos.setY(i, y);
      const ao = 0.90 + Math.max(0, y) * 0.55 + (y < 0 ? y * 0.45 : 0);
      const warm = 0.96 + (ao - 0.90) * 0.4;
      colors[i * 3] = warm;
      colors[i * 3 + 1] = warm * 0.70;
      colors[i * 3 + 2] = warm * 0.44;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  _craterKey(state) {
    if (!state) return '';
    let k = '';
    for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) if (knownCrater(state, c, r)) k += `${c},${r};`;
    return k;
  }

  _visKey(state) {
    if (!state) return '';
    let k = '';
    for (let r = 0; r < 12; r++) {
      for (let c = 0; c < 12; c++) {
        const rev = state.revealed?.[r]?.[c] ? '1' : '0';
        const cam = state.cameraSeen?.[r]?.[c] ? '1' : '0';
        const dr = state.drilled?.[r]?.[c] ? '1' : '0';
        if (rev !== '0' || cam !== '0' || dr !== '0') k += `${c}${r}${rev}${cam}${dr}`;
      }
    }
    return k;
  }

  _makeGrid() {
    const g = new THREE.GridHelper(12, 12, 0xffffff, 0xffffff);
    g.position.y = 0.045;
    g.material.transparent = true;
    g.material.opacity = 0.10;
    g.material.depthWrite = false;
    g.visible = false;
    g.layers.set(2);
    return g;
  }

  _makeReticle() {
    const g = new THREE.Group();
    g.name = 'reticle';
    const mat = new THREE.LineBasicMaterial({
      color: 0xe8e4dc,
      transparent: true,
      opacity: 0.82,
      depthWrite: false
    });
    const s = 0.52;
    const len = 0.18;
    const corners = [
      [[-s, -s], [-s + len, -s], [-s, -s], [-s, -s + len]],
      [[s, -s], [s - len, -s], [s, -s], [s, -s + len]],
      [[-s, s], [-s + len, s], [-s, s], [-s, s - len]],
      [[s, s], [s - len, s], [s, s], [s, s - len]]
    ];
    corners.forEach((pair) => {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(pair[0][0], 0, pair[0][1]),
        new THREE.Vector3(pair[1][0], 0, pair[1][1]),
        new THREE.Vector3(pair[2][0], 0, pair[2][1]),
        new THREE.Vector3(pair[3][0], 0, pair[3][1])
      ]);
      const line = new THREE.LineSegments(geo, mat);
      g.add(line);
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.055, 0.07, 20),
      new THREE.MeshBasicMaterial({
        color: 0xe8e4dc,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    g.add(ring);
    g.layers.set(1);
    g.traverse(o => o.layers.set(1));
    g.visible = false;
    return g;
  }

  _initRoverCam() {
    this.roverCam = new THREE.PerspectiveCamera(60, 4 / 3, 0.08, 48);
    this.roverCam.layers.enable(0);
    this.roverCam.layers.enable(3);
    this.roverCam.layers.disable(2);
    const host = document.getElementById('rover-cam-canvas');
    this.roverCamCanvas = host || document.createElement('canvas');
    if (host) host.dataset.engine = 'rover-cam';
    this.roverCamCanvas.width = this.lite ? 160 : 320;
    this.roverCamCanvas.height = this.lite ? 120 : 240;
    this.roverCamTarget = null;
    this.roverCamPixels = null;
    this.roverCamRenderer = null;
    this.roverCamCtx = null;
    if (this.lite) {
      this.roverCamCtx = this.roverCamCanvas.getContext('2d');
    } else {
      try {
        this.roverCamRenderer = new THREE.WebGLRenderer({
          canvas: this.roverCamCanvas,
          antialias: false,
          alpha: false,
          powerPreference: 'low-power'
        });
        this.roverCamRenderer.setPixelRatio(1);
        this.roverCamRenderer.setSize(this.roverCamCanvas.width, this.roverCamCanvas.height, false);
        this.roverCamRenderer.outputColorSpace = THREE.SRGBColorSpace;
        this.roverCamRenderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.roverCamRenderer.toneMappingExposure = 1.18;
        this.roverCamRenderer.shadowMap.enabled = false;
      } catch {
        this.roverCamRenderer = null;
        this.roverCamCtx = this.roverCamCanvas.getContext('2d');
      }
    }
  }

  setSensorLayer(name, on) {
    if (!(name in this.sensorLayers)) return;
    this.sensorLayers[name] = !!on;
    this._syncSensorOverlays(true);
  }

  _clearGroup(group) {
    if (!group) return;
    while (group.children.length) {
      const ch = group.children[0];
      group.remove(ch);
      ch.geometry?.dispose();
      if (ch.material) {
        if (Array.isArray(ch.material)) ch.material.forEach(m => m.dispose());
        else ch.material.dispose();
      }
    }
  }

  _syncSensorOverlays(force) {
    const state = this.gameState;
    const key = [
      this._craterKey(state),
      this._visKey(state),
      (state?.sensors || []).join(','),
      JSON.stringify(this.sensorLayers),
      state?.readings?.craterInFront?.cell || '',
      state?.readings?.craterInFront?.detected ? '1' : '0'
    ].join('|');
    if (!force && key === this.layerKey) return;
    this.layerKey = key;
    this._rebuildLidar();
    this._rebuildThermal();
    this._rebuildSpectral();
  }

  _rebuildLidar() {
    this._clearGroup(this.lidarGroup);
    const state = this.gameState;
    const installed = !!state?.sensors?.includes('distance');
    this.lidarGroup.visible = installed && this.sensorLayers.lidar;
    if (!this.lidarGroup.visible) return;
    const ahead = parseCraterCell(state);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4be4ff,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    });
    const pulse = new THREE.MeshBasicMaterial({
      color: 0x9ff6ff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    });
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 12; col++) {
        const known = knownCrater(state, col, row);
        if (!known) continue;
        const isAhead = ahead && ahead.col === col && ahead.row === row;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.01, 6, 36), isAhead ? pulse : mat);
        ring.rotation.x = Math.PI / 2;
        const p = cellCenter(col, row);
        ring.position.set(p.x, 0.07, p.z);
        this.lidarGroup.add(ring);
        const inner = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.006, 5, 28), mat);
        inner.rotation.x = Math.PI / 2;
        inner.position.set(p.x, 0.09, p.z);
        this.lidarGroup.add(inner);
      }
    }
  }

  _rebuildThermal() {
    this._clearGroup(this.thermalGroup);
    const state = this.gameState;
    const installed = !!state?.sensors?.includes('dust');
    this.thermalGroup.visible = installed && this.sensorLayers.thermal;
    if (!this.thermalGroup.visible) return;
    const geo = new THREE.PlaneGeometry(0.92, 0.92);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff6a28,
      transparent: true,
      opacity: 0.30,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 12; col++) {
        if (state.terrain[row][col] !== 'dust') continue;
        if (!tileKnown(state, col, row)) continue;
        const m = new THREE.Mesh(geo, mat);
        m.rotation.x = -Math.PI / 2;
        const p = cellCenter(col, row);
        m.position.set(p.x, 0.055, p.z);
        this.thermalGroup.add(m);
      }
    }
  }

  _rebuildSpectral() {
    this._clearGroup(this.spectralGroup);
    const state = this.gameState;
    const installed = !!state?.sensors?.includes('spectral');
    this.spectralGroup.visible = installed && this.sensorLayers.spectral;
    if (!this.spectralGroup.visible) return;
    const geo = new THREE.IcosahedronGeometry(0.11, 0);
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 12; col++) {
        if (state.terrain[row][col] !== 'ore') continue;
        if (!tileKnown(state, col, row)) continue;
        if (state.drilled?.[row]?.[col]) continue;
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
          color: 0x14524a,
          roughness: 0.28,
          metalness: 0.72,
          emissive: 0x1ee6c4,
          emissiveIntensity: 0.85
        }));
        const p = cellCenter(col, row);
        m.position.set(p.x, heightAt(p.x, p.z, state) + 0.14, p.z);
        this.spectralGroup.add(m);
      }
    }
  }

  _rebuildCraterRings() {
    while (this.craterRings.children.length) {
      const ch = this.craterRings.children[0];
      this.craterRings.remove(ch);
      ch.geometry?.dispose();
      ch.material?.dispose();
    }
    const state = this.gameState;
    if (!state) return;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xc45a3a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false
    });
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 12; col++) {
        if (!knownCrater(state, col, row)) continue;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.012, 6, 28), mat);
        ring.rotation.x = Math.PI / 2;
        const p = cellCenter(col, row);
        ring.position.set(p.x, 0.06, p.z);
        this.craterRings.add(ring);
      }
    }
  }

  _makeDust() {
    const n = 140;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 22;
      pos[i * 3 + 1] = 0.2 + Math.random() * 3.5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 22;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xe0c09a,
      size: 0.08,
      transparent: true,
      opacity: 0.35,
      depthWrite: false
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  _makePuffs() {
    this.puffPos = new Float32Array(96 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.puffPos, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      color: 0xd4b48a,
      size: 0.11,
      transparent: true,
      opacity: 0.55,
      depthWrite: false
    });
    this.puffPts = new THREE.Points(geo, mat);
    this.puffPts.frustumCulled = false;
    this.scene.add(this.puffPts);
  }

  async _loadArt() {
    const [g1, g2, g3, dust, ore, crater] = await Promise.all([
      loadTexture('assets/art/tile-ground-1.png'),
      loadTexture('assets/art/tile-ground-2.png'),
      loadTexture('assets/art/tile-ground-3.png'),
      loadTexture('assets/art/tile-dust.png'),
      loadTexture('assets/art/tile-ore.png'),
      loadTexture('assets/art/tile-crater.png')
    ]);
    if (this.disposed) return;
    this.maps = { g1, g2, g3, dust, ore, crater };
    this._makeGroundMap();
    this._updateSplat();
    if (this._terrainShader) {
      this._terrainShader.uniforms.uDustTex.value = dust || this.splatTex;
      this._terrainShader.uniforms.uOreTex.value = ore || this.splatTex;
      this._terrainShader.uniforms.uCraterTex.value = crater || this.splatTex;
    }
  }

  _makeGroundMap() {
    if (!this.maps?.g1) return;
    const size = 512;
    const cnv = document.createElement('canvas');
    cnv.width = cnv.height = size;
    const ctx = cnv.getContext('2d');
    const imgs = [this.maps.g1, this.maps.g2, this.maps.g3].map(t => t?.image).filter(Boolean);
    if (!imgs.length) return;
    for (let y = 0; y < size; y += 128) {
      for (let x = 0; x < size; x += 128) {
        ctx.drawImage(imgs[(x / 128 + y / 128) % imgs.length], x, y, 128, 128);
      }
    }
    if (this.groundTex) this.groundTex.dispose();
    this.groundTex = new THREE.CanvasTexture(cnv);
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.groundTex.wrapS = this.groundTex.wrapT = THREE.RepeatWrapping;
    this.groundTex.repeat.set(18, 18);
    this.groundTex.anisotropy = 8;
    this.terrain.material.map = this.groundTex;
    this.terrain.material.needsUpdate = true;
  }

  _updateSplat() {
    const state = this.gameState;
    const data = this.splatData;
    data.fill(0);
    if (state) {
      for (let row = 0; row < 12; row++) {
        for (let col = 0; col < 12; col++) {
          const known = !!(state.revealed?.[row]?.[col] || state.cameraSeen?.[row]?.[col]);
          if (!known) continue;
          const i = (row * 12 + col) * 4;
          const t = state.terrain[row][col];
          if (t === 'dust') data[i] = 220;
          if (t === 'ore' && !state.drilled?.[row]?.[col]) data[i + 1] = 230;
          if (t === 'crater' && knownCrater(state, col, row)) data[i + 2] = 240;
          data[i + 3] = 255;
        }
      }
    }
    this.splatTex.needsUpdate = true;
    this._refreshOreMarks();
  }

  _refreshOreMarks() {
    while (this.oreMarks.children.length) {
      const ch = this.oreMarks.children[0];
      this.oreMarks.remove(ch);
      ch.geometry?.dispose();
      ch.material?.dispose();
    }
    const state = this.gameState;
    if (!state) return;
    const geo = new THREE.IcosahedronGeometry(0.09, 0);
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 12; col++) {
        if (state.terrain[row][col] !== 'ore') continue;
        if (!(state.revealed?.[row]?.[col] || state.cameraSeen?.[row]?.[col])) continue;
        if (state.drilled?.[row]?.[col]) continue;
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
          color: 0x2a1a10,
          roughness: 0.22,
          metalness: 0.88,
          emissive: 0x332200,
          emissiveIntensity: 0.55
        }));
        const p = cellCenter(col, row);
        m.position.set(p.x, heightAt(p.x, p.z, state) + 0.12, p.z);
        m.castShadow = true;
        this.oreMarks.add(m);
      }
    }
  }

  _bindInput() {
    this._pointers = new Map();
    this._lastPinch = 0;
    const el = this.canvas;
    el.style.touchAction = 'none';
    this._onPointerDown = (e) => {
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture(e.pointerId);
    };
    this._onPointerMove = (e) => {
      this.hovering = true;
      if (!this._pointers.has(e.pointerId)) return;
      const prev = this._pointers.get(e.pointerId);
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      prev.x = e.clientX;
      prev.y = e.clientY;
      if (this._pointers.size === 1) {
        this.camSpherical.theta -= dx * 0.0035;
        this.camSpherical.phi = THREE.MathUtils.clamp(this.camSpherical.phi + dy * 0.003, 0.04, 0.32);
        this._clampCam();
      } else if (this._pointers.size === 2) {
        const pts = [...this._pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this._lastPinch) {
          this.camSpherical.radius *= this._lastPinch / dist;
          this._userFramed = true;
          this._clampCam();
        }
        this._lastPinch = dist;
      }
    };
    this._onPointerUp = (e) => {
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) this._lastPinch = 0;
    };
    this._onPointerLeave = () => { this.hovering = false; };
    this._onWheel = (e) => {
      e.preventDefault();
      this.camSpherical.radius *= (1 + Math.sign(e.deltaY) * 0.08);
      this._userFramed = true;
      this._clampCam();
    };
    el.addEventListener('pointerdown', this._onPointerDown);
    el.addEventListener('pointermove', this._onPointerMove);
    el.addEventListener('pointerup', this._onPointerUp);
    el.addEventListener('pointercancel', this._onPointerUp);
    el.addEventListener('pointerleave', this._onPointerLeave);
    el.addEventListener('wheel', this._onWheel, { passive: false });
  }

  _clampCam() {
    this.camSpherical.radius = THREE.MathUtils.clamp(this.camSpherical.radius, 11.5, 22);
    this.camSpherical.phi = THREE.MathUtils.clamp(this.camSpherical.phi, 0.04, 0.32);
    const span = 0.36;
    this.camSpherical.theta = THREE.MathUtils.clamp(this.camSpherical.theta, this.camDefault.theta - span, this.camDefault.theta + span);
  }

  _applyCamera() {
    const offset = new THREE.Vector3().setFromSpherical(this.camSpherical);
    this.camera.position.copy(this.camTarget).add(offset);
    this.camera.lookAt(this.camTarget);
    this.camera.up.set(0, 1, 0);
  }

  resetView() {
    this._userFramed = false;
    this.camSpherical.copy(this.camDefault);
    if (this.camera?.aspect) this.camSpherical.radius = this._framingRadius();
    this._applyCamera();
  }

  setGridForced(on) {
    this.gridForced = !!on;
  }

  setPausedHint(paused) {
    this.pausedHint = !!paused;
  }

  mount() {
    this.container.appendChild(this.canvas);
    this.resize();
    requestAnimationFrame(() => { if (!this.disposed) this.resize(); });
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.running = true;
    const loop = () => {
      if (!this.running || this.disposed || !this.canvas.isConnected) return;
      this._raf = requestAnimationFrame(loop);
      this._tick(this.clock.getDelta());
    };
    this._raf = requestAnimationFrame(loop);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    const el = this.canvas;
    if (el) {
      el.removeEventListener('pointerdown', this._onPointerDown);
      el.removeEventListener('pointermove', this._onPointerMove);
      el.removeEventListener('pointerup', this._onPointerUp);
      el.removeEventListener('pointercancel', this._onPointerUp);
      el.removeEventListener('pointerleave', this._onPointerLeave);
      el.removeEventListener('wheel', this._onWheel);
    }
    this.renderer?.dispose();
    this.roverCamRenderer?.dispose();
    this.coverageTex?.dispose();
    this.splatTex?.dispose();
    this.noiseTex?.dispose();
    this.groundTex?.dispose();
    this.trackTex?.dispose();
    this.terrain?.geometry?.dispose();
    this.terrain?.material?.dispose();
    if (this.canvas?.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    if (typeof window !== 'undefined' && window.__farRoverFps && this.fps) {
      // keep last reading
    }
  }

  _framingRadius() {
    const span = 13.35;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = Math.max(0.25, this.camera.aspect || 1);
    const halfH = Math.tan(vFov / 2);
    const halfW = halfH * aspect;
    const halfMin = Math.min(halfW, halfH);
    return (span / 2) / Math.max(0.08, halfMin);
  }

  _setCoverAmt(v) {
    if (!this._coverUniforms) return;
    for (let i = 0; i < this._coverUniforms.length; i++) this._coverUniforms[i].value = v;
  }

  resize() {
    if (this.disposed) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.style.background = '#3a2418';
    const framed = this._framingRadius();
    this.camDefault.radius = framed;
    if (!this._userFramed) this.camSpherical.radius = framed;
    this._applyCamera();
  }

  setPlaybackSpeed(speed) {
    this.playbackSpeed = speed || 1;
  }

  updateState(gameState) {
    this.gameState = gameState;
    this.syncCloudTargets(false);
    const ck = this._craterKey(gameState);
    if (ck !== this.knownCraterKey) {
      this.knownCraterKey = ck;
      this._applyHeights(this.terrain.geometry, gameState);
      this._rebuildCraterRings();
    }
    const vk = this._visKey(gameState);
    if (vk !== this.visKey) {
      this.visKey = vk;
      this._updateSplat();
    }
    if (gameState.cargo > this.lastCargo) this._sparkle();
    this.lastCargo = gameState.cargo;
    let drilled = 0;
    gameState.drilled?.forEach(row => row.forEach(v => { if (v) drilled++; }));
    if (drilled > this.lastDrilled) this._drillPlume();
    this.lastDrilled = drilled;
    if (!this.anim.active) this._placeActors(false);
    if (gameState.facing !== this.lastFacing && !this.anim.active) {
      this._tweenFacing(this.lastFacing, gameState.facing);
    }
    this.lastFacing = gameState.facing;
    if (gameState.outcome === 'lost-crater') this._craterLoss();
    if (gameState.outcome === 'lost-battery') this.sun.intensity = 0.45;
    else this.sun.intensity = this.sunDefault;
    this._syncSensorOverlays(false);
    this._writeCoverage();
  }

  startAnimation(fromCol, fromRow, toCol, toRow, duration = 120) {
    const from = cellCenter(fromCol, fromRow);
    const to = cellCenter(toCol, toRow);
    from.y = heightAt(from.x, from.z, this.gameState);
    to.y = heightAt(to.x, to.z, this.gameState);
    this.anim = {
      active: true,
      start: performance.now(),
      duration: Math.max(1, duration),
      from,
      to,
      fromY: FACE_Y[this.lastFacing] || 0,
      toY: FACE_Y[this.gameState?.facing] || 0,
      dist: from.distanceTo(to)
    };
    this._stampTrack(fromCol, fromRow);
    this._puff(from);
  }

  _tweenFacing(from, to) {
    this.anim = {
      active: true,
      start: performance.now(),
      duration: 160,
      from: this.rover.position.clone(),
      to: this.rover.position.clone(),
      fromY: FACE_Y[from] || 0,
      toY: FACE_Y[to] || 0,
      dist: 0
    };
  }

  _placeActors(snap) {
    const s = this.gameState;
    if (!s) return;
    const rp = cellCenter(s.col, s.row);
    const groundY = heightAt(rp.x, rp.z, s);
    if (snap || !this.anim.active) {
      this.rover.position.set(rp.x, groundY, rp.z);
      this.rover.rotation.y = FACE_Y[s.facing] || 0;
    }
    const lp = cellCenter(LANDER_COL, LANDER_ROW);
    this.lander.position.set(lp.x, heightAt(lp.x, lp.z, s), lp.z);
    const glow = this.lander.getObjectByName('chargeGlow');
    const halo = this.lander.getObjectByName('chargeHalo');
    if (glow) glow.intensity = s.charging ? 2.6 : 0;
    if (halo) halo.material.opacity = s.charging ? 0.28 : 0;
    this._statusLight();
  }

  _statusLight() {
    const light = this.rover.userData.light;
    if (!light) return;
    const s = this.gameState;
    let color = 0x88ffcc;
    let em = 0x226644;
    if (s?.charging) { color = 0x66e0ff; em = 0x117799; }
    else if ((s?.battery ?? 20) <= 4) { color = 0xff8844; em = 0x662200; }
    else if (String(s?.outcome || '').startsWith('stuck')) { color = 0xff3333; em = 0x550000; }
    light.material.color.setHex(color);
    light.material.emissive.setHex(em);
  }

  _stampTrack(col, row) {
    const ctx = this.trackCtx;
    const x = ((col + 0.5) / 12) * 512;
    const y = ((row + 0.5) / 12) * 512;
    ctx.fillStyle = 'rgba(40, 22, 12, 0.32)';
    ctx.beginPath();
    ctx.ellipse(x, y, 6, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    this.trackTex.needsUpdate = true;
    this.tracks.push({ t: performance.now() });
  }

  _fadeTracks() {
    if (this.tracks.length && performance.now() - this.tracks[0].t > 18000) {
      const ctx = this.trackCtx;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(0, 0, 512, 512);
      ctx.restore();
      this.trackTex.needsUpdate = true;
      this.tracks.shift();
    }
  }

  _puff(at) {
    for (let i = 0; i < 10; i++) {
      this.particles.push({
        x: at.x, y: (at.y || 0) + 0.06, z: at.z,
        vx: (Math.random() - 0.5) * 0.45,
        vy: 0.35 + Math.random() * 0.45,
        vz: (Math.random() - 0.5) * 0.45,
        life: 1,
        gold: false
      });
    }
  }

  _sparkle() {
    const p = this.rover.position;
    for (let i = 0; i < 14; i++) {
      this.particles.push({
        x: p.x, y: p.y + 0.2, z: p.z,
        vx: (Math.random() - 0.5) * 0.6,
        vy: 0.5 + Math.random() * 0.6,
        vz: (Math.random() - 0.5) * 0.6,
        life: 1,
        gold: true
      });
    }
  }

  _drillPlume() {
    this.drillT = 1;
    this._puff(this.rover.position);
  }

  _craterLoss() {
    if (this.craterLossing) return;
    this.craterLossing = true;
    this.rover.traverse(o => {
      if (o.material && o.material.opacity !== undefined) {
        o.material = o.material.clone();
        o.material.transparent = true;
      }
    });
  }

  syncCloudTargets(init) {
    const state = this.gameState;
    if (!state) return;
    let changed = false;
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const next = tileCloudTarget(state, col, row);
        if (this.cloudTarget[row][col] !== next) {
          this.cloudTarget[row][col] = next;
          changed = true;
        }
      }
    }
    if (init || !this.cloudInitialized) {
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          this.cloudDisplay[row][col] = this.cloudTarget[row][col];
          this.cloudFadeFrom[row][col] = this.cloudTarget[row][col];
        }
      }
      this.cloudInitialized = true;
      this.cloudFading = false;
      this._writeCoverage();
      return;
    }
    if (changed) {
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          this.cloudFadeFrom[row][col] = this.cloudDisplay[row][col];
        }
      }
      this.cloudFadeStart = performance.now();
      this.cloudFading = true;
    }
  }

  _stepCloud(now) {
    if (!this.cloudFading) return;
    const dur = cloudFadeDuration(this.playbackSpeed);
    const t = Math.min(1, (now - this.cloudFadeStart) / dur);
    const e = t * t * (3 - 2 * t);
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        this.cloudDisplay[row][col] = lerp(this.cloudFadeFrom[row][col], this.cloudTarget[row][col], e);
      }
    }
    this._writeCoverage();
    if (t >= 1) this.cloudFading = false;
  }

  _writeCoverage() {
    const data = this.coverageData;
    const ahead = parseCraterCell(this.gameState);
    for (let y = 0; y < COV; y++) {
      for (let x = 0; x < COV; x++) {
        // Cloud plane UV: v=0 is south (high row) after X=-90 rotation.
        const col = (x + 0.5) / COV * GRID_COLS;
        const row = GRID_ROWS - (y + 0.5) / COV * GRID_ROWS;
        const c0 = Math.floor(col);
        const r0 = Math.floor(row);
        const fx = col - c0;
        const fy = row - r0;
        const sample = (c, r) => {
          if (c < 0 || r < 0 || c >= 12 || r >= 12) return CLOUD_HIDDEN;
          let v = this.cloudDisplay[r][c];
          if (ahead && c === ahead.col && r === ahead.row) v = Math.min(v, CLOUD_CAMERA);
          return v;
        };
        const v = lerp(
          lerp(sample(c0, r0), sample(c0 + 1, r0), fx),
          lerp(sample(c0, r0 + 1), sample(c0 + 1, r0 + 1), fy),
          fy
        );
        const edge = Math.abs(sample(c0, r0) - sample(c0 + 1, r0)) + Math.abs(sample(c0, r0) - sample(c0, r0 + 1));
        const n = hash2(x, y, 6.2) - 0.5;
        const cov = Math.max(0, Math.min(255, (v + n * edge * 0.22) * 255));
        const i = (y * COV + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = cov;
        data[i + 3] = 255;
      }
    }
    this.coverageTex.needsUpdate = true;
  }

  _tick(dt) {
    const now = performance.now();
    this._stepCloud(now);
    this._applyCamera();
    this.gridHelper.visible = this.gridForced || this.hovering;
    const t = this.reduceMotion ? 0 : now / 1000;
    this.cloudLayers.forEach((m) => {
      m.material.uniforms.uTime.value = t;
    });
    if (!this.reduceMotion && !this.lite) {
      const pos = this.dust.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.setX(i, pos.getX(i) + dt * 0.15);
        pos.setY(i, pos.getY(i) + Math.sin(t + i) * dt * 0.05);
        if (pos.getX(i) > 12) pos.setX(i, -12);
      }
      pos.needsUpdate = true;
    }
    if (this.drillT > 0) {
      this.drillT = Math.max(0, this.drillT - dt * 1.8);
      const bit = this.rover.userData.drillBit;
      const drill = this.rover.userData.drill;
      if (bit) bit.rotation.y += dt * 18;
      if (drill) drill.position.y = 0.22 - (1 - this.drillT) * 0.08;
    }
    if (this.anim.active) {
      const u = Math.min(1, (now - this.anim.start) / this.anim.duration);
      const e = 1 - (1 - u) * (1 - u);
      this.rover.position.lerpVectors(this.anim.from, this.anim.to, e);
      let a0 = this.anim.fromY;
      let a1 = this.anim.toY;
      while (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
      while (a0 - a1 > Math.PI) a1 += Math.PI * 2;
      this.rover.rotation.y = lerp(a0, a1, e);
      this.rover.position.y += Math.sin(e * Math.PI) * 0.03;
      const dist = this.anim.dist * e * 8;
      this.rover.userData.wheels.forEach(w => { w.rotation.x = dist; });
      if (u >= 1) {
        this.anim.active = false;
        this._placeActors(true);
        this._stampTrack(this.gameState.col, this.gameState.row);
      }
    } else if (this.gameState?.charging && !this.craterLossing) {
      const rp = cellCenter(this.gameState.col, this.gameState.row);
      this.rover.position.y = heightAt(rp.x, rp.z, this.gameState) + Math.sin(now / 400) * 0.01;
    }
    if (this.craterLossing) {
      this.rover.rotation.z = Math.min(0.85, this.rover.rotation.z + dt * 0.7);
      this.rover.rotation.x = Math.min(0.4, this.rover.rotation.x + dt * 0.35);
      this.rover.position.y -= dt * 0.22;
      this.rover.traverse(o => {
        if (o.material && o.material.opacity !== undefined) {
          o.material.transparent = true;
          o.material.opacity = Math.max(0, (o.material.opacity ?? 1) - dt * 0.55);
        }
      });
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= dt * 0.6;
      p.life -= dt * 1.4;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    const n = Math.min(this.particles.length, this.puffPos.length / 3);
    for (let i = 0; i < n; i++) {
      const p = this.particles[i];
      this.puffPos[i * 3] = p.x;
      this.puffPos[i * 3 + 1] = p.y;
      this.puffPos[i * 3 + 2] = p.z;
    }
    this.puffPts.geometry.attributes.position.needsUpdate = true;
    this.puffPts.geometry.setDrawRange(0, n);
    if (this.oreMarks.children.length && !this.reduceMotion) {
      const pulse = 0.45 + Math.sin(now / 280) * 0.2;
      this.oreMarks.children.forEach(m => { m.material.emissiveIntensity = pulse; });
    }
    this._fadeTracks();
    this._statusLight();
    this._updateReticle();
    this._updateRoverCam();
    if (this.craterRings) this.craterRings.visible = !this.sensorLayers.lidar;
    const busy = this.cloudFading || this.anim.active || this.craterLossing ||
      this.particles.length > 0 || this.drillT > 0 || (this._pointers && this._pointers.size > 0);
    const interval = this.lite ? (busy ? 50 : 250) : (this.pausedHint && !busy ? 80 : 0);
    if (interval && now - (this._lastDraw || 0) < interval) return;
    this._lastDraw = now;
    this._frames++;
    if (now - this._fpsT > 500) {
      this.fps = (this._frames * 1000) / (now - this._fpsT);
      this._frames = 0;
      this._fpsT = now;
      if (typeof window !== 'undefined') window.__farRoverFps = this.fps;
    }
    this._renderRoverCam(now);
    this._setCoverAmt(1);
    if (this.skyMesh) this.skyMesh.visible = false;
    this.scene.background = this.orbitalBg;
    this.scene.fog = null;
    this.renderer.render(this.scene, this.camera);
  }

  _updateReticle() {
    if (!this.reticle) return;
    const s = this.gameState;
    const onGrid = s && s.row >= 0 && s.row < 12 && s.col >= 0 && s.col < 12;
    this.reticle.visible = !!onGrid;
    const tag = document.getElementById('rover-tag');
    if (!onGrid) {
      if (tag) tag.hidden = true;
      return;
    }
    const p = this.rover.position;
    this.reticle.position.set(p.x, 0.09, p.z);
    if (tag && this.camera && this.container) {
      const v = p.clone();
      v.y += 0.55;
      v.project(this.camera);
      const rect = this.container.getBoundingClientRect();
      const x = (v.x * 0.5 + 0.5) * rect.width;
      const y = (-v.y * 0.5 + 0.5) * rect.height;
      tag.hidden = v.z > 1;
      tag.style.left = `${x}px`;
      tag.style.top = `${y + 14}px`;
    }
  }

  _updateRoverCam() {
    if (!this.roverCam || !this.rover) return;
    this.rover.updateMatrixWorld(true);
    const eye = new THREE.Vector3(0, 0.40, 0.12);
    const ahead = new THREE.Vector3(0, 0.08, -6.2);
    eye.applyMatrix4(this.rover.matrixWorld);
    ahead.applyMatrix4(this.rover.matrixWorld);
    this.roverCam.position.copy(eye);
    this.roverCam.up.set(0, 1, 0);
    this.roverCam.lookAt(ahead);
  }

  _renderRoverCam(now) {
    if (this.disposed) return;
    if (!this.roverCamRenderer) {
      if (this.roverCamCtx) this._paintRoverCam2D();
      return;
    }
    const interval = this.lite ? 180 : 0;
    if (interval && now - (this._lastPip || 0) < interval) return;
    this._lastPip = now;
    const roverWas = this.rover.visible;
    const landerWas = this.lander?.visible;
    const landerHalo = this.lander?.getObjectByName('chargeHalo');
    const haloWas = landerHalo?.visible;
    this.rover.visible = false;
    if (this.lander) this.lander.visible = false;
    const prevFog = this.scene.fog;
    const prevBg = this.scene.background;
    this._setCoverAmt(0.16);
    if (this.skyMesh) this.skyMesh.visible = true;
    this.scene.fog = this.groundFog;
    this.scene.background = this.pipBg;
    try {
      this.roverCamRenderer.render(this.scene, this.roverCam);
    } catch {
      // keep orbital feed even if the PiP context drops
    }
    this.scene.fog = prevFog;
    this.scene.background = prevBg;
    this._setCoverAmt(1);
    if (this.skyMesh) this.skyMesh.visible = false;
    this.rover.visible = roverWas;
    if (this.lander) this.lander.visible = landerWas !== false;
    if (landerHalo) landerHalo.visible = haloWas;
  }

  render() {
    if (this.disposed) return;
    this._updateRoverCam();
    this._renderRoverCam(performance.now());
    this._setCoverAmt(1);
    if (this.skyMesh) this.skyMesh.visible = false;
    this.scene.background = this.orbitalBg;
    this.scene.fog = null;
    this.renderer.render(this.scene, this.camera);
  }

  _paintRoverCam2D() {
    const ctx = this.roverCamCtx;
    const canvas = this.roverCamCanvas;
    if (!ctx || !canvas || !this.gameState) return;
    const w = canvas.width;
    const h = canvas.height;
    const state = this.gameState;
    const facing = state.facing || 'north';
    const vec = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
    const [dx, dy] = vec[facing] || [0, -1];
    const fc = state.col + dx;
    const fr = state.row + dy;
    const onGrid = fc >= 0 && fc < 12 && fr >= 0 && fr < 12;
    const terrain = onGrid ? state.terrain[fr][fc] : null;
    const ahead = parseCraterCell(state);
    const craterAhead = !!(ahead && ahead.col === fc && ahead.row === fr);
    ctx.fillStyle = '#d4a078';
    ctx.fillRect(0, 0, w, h);
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.38);
    sky.addColorStop(0, '#f0d0b0');
    sky.addColorStop(0.55, '#d49260');
    sky.addColorStop(1, '#c07848');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h * 0.38);
    const ground = ctx.createLinearGradient(0, h * 0.38, 0, h);
    ground.addColorStop(0, '#7a4028');
    ground.addColorStop(0.4, '#b06038');
    ground.addColorStop(1, '#c4683a');
    ctx.fillStyle = ground;
    ctx.fillRect(0, h * 0.38, w, h * 0.62);
    ctx.fillStyle = 'rgba(40, 18, 10, 0.32)';
    for (let i = 0; i < 16; i++) {
      const rx = (i * 47 + 13) % w;
      const ry = h * 0.46 + (i * 31) % (h * 0.46);
      const rw = 3 + (i % 5) * 2.2;
      ctx.beginPath();
      ctx.ellipse(rx, ry, rw, rw * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (craterAhead || terrain === 'crater') {
      ctx.fillStyle = 'rgba(22, 8, 4, 0.78)';
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.70, w * 0.32, h * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(12, 4, 2, 0.55)';
      ctx.beginPath();
      ctx.ellipse(w * 0.47, h * 0.68, w * 0.16, h * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
      if (this.sensorLayers.lidar) {
        ctx.strokeStyle = '#4be4ff';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(w * 0.5, h * 0.70, w * 0.32, h * 0.16, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(w * 0.5, h * 0.70, w * 0.22, h * 0.11, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  getCellFromClick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x, y }, this.camera);
    const hits = ray.intersectObject(this.terrain);
    if (!hits.length) return null;
    const p = hits[0].point;
    const col = Math.round(p.x + (GRID_COLS - 1) / 2);
    const row = Math.round(p.z + (GRID_ROWS - 1) / 2);
    if (col < 0 || col > 11 || row < 0 || row > 12) return null;
    return { col, row };
  }
}
