import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Krog Street Market
// Sculpt build pass: optimization-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createKrogStreetMarketModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Krog Street Market";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {"schemaVersion": 1, "status": "proceed", "registry": "/Users/william-meroxa/.img2threejs/releases/a669e9a97cea4452b1c2310c5cca6aa0f6657c1f/img2threejs/docs/materials/material-reference.json", "analysisArtifact": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-analysis.json", "targetThreshold": 0.7, "unresolvedNotObservedMaterials": [], "regions": [{"componentId": "roof-profile", "regionId": "metal", "specMaterialId": "metal", "profileId": "metal.aluminum", "status": "proceed"}, {"componentId": "canopy", "regionId": "steel", "specMaterialId": "steel", "profileId": "coating.painted-metal", "status": "proceed"}, {"componentId": "market-letters", "regionId": "market", "specMaterialId": "letters-white", "profileId": "coating.painted-metal", "status": "proceed"}, {"componentId": "pendant-0", "regionId": "brass", "specMaterialId": "brass", "profileId": "metal.brass", "status": "proceed"}], "controlledViewsRequired": ["albedo-unlit", "environment-reflection", "grazing", "neutral-studio", "reference-beauty"]};
  root.userData.materialReferenceRegistry = "/Users/william-meroxa/.img2threejs/releases/a669e9a97cea4452b1c2310c5cca6aa0f6657c1f/img2threejs/docs/materials/material-reference.json";

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["metal"] = createSculptMaterial(
    "metal",
    {"id": "metal", "name": "Corrugated metal", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#B9BEC3", "color": "#B9BEC3", "albedo": {"dominant": "#B9BEC3", "secondary": ["#B9BEC3"], "samplingNotes": "Flat game color (vertex color); de-lit by eye from the day photo."}, "colorVariation": {"palette": ["#B9BEC3"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.3, "map": "material-evidence/metal/metal_roughness.png", "notes": "Evidence map from extract_pbr_evidence.py; the game uses the base value only (toon shading)."}, "metalness": {"base": 1.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "corrugation", "type": "normal-ribs", "region": "the whole metal wall", "amount": 0.2, "notes": "Fine vertical ribs; not modeled in the game (flat toon color)."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referenceMaterialId": "metal.aluminum", "materialFamily": "metal", "materialSubtype": "aluminum", "materialFinish": "satin", "materialReference": {"registry": "/Users/william-meroxa/.img2threejs/releases/a669e9a97cea4452b1c2310c5cca6aa0f6657c1f/img2threejs/docs/materials/material-reference.json", "profileId": "metal.aluminum", "method": "family-subtype-finish", "confidence": 0.829, "sourceRefs": ["three.mesh-standard", "three.pmrem", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-2", "google.filament-pbr"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "anisotropyMap"], "validationViews": ["neutral-studio", "environment-reflection", "grazing"]}, "anisotropy": {"base": 0.2, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-00-metal/metal_albedo.png", "url": "metal_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-00-metal/metal_roughness.png", "url": "metal_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-00-metal/metal_height.png", "url": "metal_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-00-metal/metal_normal.png", "url": "metal_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-00-metal/metal_ao.png", "url": "metal_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 340, "sourceHeight": 140, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 340, "height": 140}, "mask": {"backgroundColor": "#778EAD", "backgroundNoise": 52.621, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.981}, "mapStats": {"valueRange": 0.5196, "heightP90Gradient": 0.13322, "roughnessBase": 0.722, "roughnessVariation": 0.217, "normalStrength": 0.312, "blurRadius": 10}, "palette": ["#7C92AF", "#98C1F9", "#5E708A", "#9CC4FA", "#1E2634"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "textureAnalysis": {"finishClass": "candy-coat", "recipe": {"metalness": 0.35, "roughness": 0.18, "clearcoat": 0.6, "clearcoatRoughness": 0.15, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 0.7, "anisotropy": 0.0, "procedural": "gradient-smoke"}, "palette": ["#97BEF3", "#88ABDB", "#83A0CA", "#575C64", "#6F839E"], "paletteHueRisk": [{"stop": "#97BEF3", "hueRisk": "blue-collapse", "suggestedRgb": [243, 190, 151]}, {"stop": "#88ABDB", "hueRisk": "blue-collapse", "suggestedRgb": [219, 171, 136]}, {"stop": "#83A0CA", "hueRisk": "blue-collapse", "suggestedRgb": [202, 160, 131]}, {"stop": "#6F839E", "hueRisk": "blue-collapse", "suggestedRgb": [158, 131, 111]}], "gradientAxis": "horizontal", "stats": {"meanLum": 149.1, "meanSaturation": 0.343, "gradientStrength": 0.642, "mottle": 0.047, "streakRatio": 2.39, "hueSpread": 0.001, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "roof-profile", "regionId": "metal", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}, "observations": ["chromatic base-colour response", "directional surface frequency", "visible meso/micro variation", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "roof-profile", "regionId": "metal", "materialId": null, "family": "metal", "subtype": "aluminum", "finish": "satin", "aliases": [], "confidence": 0.829, "source": "vision"}, "alternatives": []}, "needsEnvironment": true},
    options
  );
  materialMap["steel"] = createSculptMaterial(
    "steel",
    {"id": "steel", "name": "Black painted steel", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#1E2023", "color": "#1E2023", "albedo": {"dominant": "#1E2023", "secondary": ["#1E2023"], "samplingNotes": "Flat game color (vertex color); de-lit by eye from the day photo."}, "colorVariation": {"palette": ["#1E2023"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.45, "map": "material-evidence/steel/steel_roughness.png", "notes": "Evidence map from extract_pbr_evidence.py; the game uses the base value only (toon shading)."}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referenceMaterialId": "coating.painted-metal", "materialFamily": "coating", "materialSubtype": "paint-over-metal", "materialFinish": "gloss-or-satin", "materialReference": {"registry": "/Users/william-meroxa/.img2threejs/releases/a669e9a97cea4452b1c2310c5cca6aa0f6657c1f/img2threejs/docs/materials/material-reference.json", "profileId": "coating.painted-metal", "method": "family-subtype-finish", "confidence": 0.805, "sourceRefs": ["three.mesh-physical", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-1", "adobe.pbr-guide-2"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "clearcoatMap", "clearcoatRoughnessMap", "metalnessMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing", "environment-reflection", "reference-beauty"]}, "clearcoat": {"base": 0.75, "variation": 0.0}, "clearcoatRoughness": {"base": 0.12, "variation": 0.0}, "ior": {"base": 1.5, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/01-steel.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.805, "estimatedFidelity": 0.805, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-01-steel/steel_albedo.png", "url": "steel_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-01-steel/steel_roughness.png", "url": "steel_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-01-steel/steel_height.png", "url": "steel_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-01-steel/steel_normal.png", "url": "steel_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-01-steel/steel_ao.png", "url": "steel_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 1400, "sourceHeight": 40, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 1400, "height": 40}, "mask": {"backgroundColor": "#120E18", "backgroundNoise": 43.301, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.8911}, "mapStats": {"valueRange": 0.1879, "heightP90Gradient": 0.13329, "roughnessBase": 0.727, "roughnessVariation": 0.179, "normalStrength": 0.312, "blurRadius": 10}, "palette": ["#02040A", "#000105", "#0A0C12", "#282527", "#66635C"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"]}, "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#2A2226", "#080A10", "#05070D", "#0E0E11", "#1E1C1B"], "paletteHueRisk": [{"stop": "#080A10", "hueRisk": "blue-collapse", "suggestedRgb": [16, 10, 8]}, {"stop": "#05070D", "hueRisk": "blue-collapse", "suggestedRgb": [13, 7, 5]}, {"stop": "#0E0E11", "hueRisk": "blue-collapse", "suggestedRgb": [17, 14, 14]}], "gradientAxis": "horizontal", "stats": {"meanLum": 13.9, "meanSaturation": 0.674, "gradientStrength": 0.191, "mottle": 0.029, "streakRatio": 2.54, "hueSpread": 0.039, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "canopy", "regionId": "steel", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/01-steel.png", "bbox": {"x": 1520, "y": 1360, "width": 1400, "height": 40}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0046}, "observations": ["chromatic base-colour response", "directional surface frequency", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "canopy", "regionId": "steel", "materialId": null, "family": "coating", "subtype": "paint-over-metal", "finish": "gloss-or-satin", "aliases": [], "confidence": 0.805, "source": "vision"}, "alternatives": []}},
    options
  );
  materialMap["letters-white"] = createSculptMaterial(
    "letters-white",
    {"id": "letters-white", "name": "White letters", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#F4F4F2", "color": "#F4F4F2", "albedo": {"dominant": "#F4F4F2", "secondary": ["#F4F4F2"], "samplingNotes": "Flat game color (vertex color); de-lit by eye from the day photo."}, "colorVariation": {"palette": ["#F4F4F2"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.45, "map": "material-evidence/letters-white/letters-white_roughness.png", "notes": "Evidence map from extract_pbr_evidence.py; the game uses the base value only (toon shading)."}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referenceMaterialId": "coating.painted-metal", "materialFamily": "coating", "materialSubtype": "paint-over-metal", "materialFinish": "gloss-or-satin", "materialReference": {"registry": "/Users/william-meroxa/.img2threejs/releases/a669e9a97cea4452b1c2310c5cca6aa0f6657c1f/img2threejs/docs/materials/material-reference.json", "profileId": "coating.painted-metal", "method": "family-subtype-finish", "confidence": 0.829, "sourceRefs": ["three.mesh-physical", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-1", "adobe.pbr-guide-2"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "clearcoatMap", "clearcoatRoughnessMap", "metalnessMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing", "environment-reflection", "reference-beauty"]}, "clearcoat": {"base": 0.75, "variation": 0.0}, "clearcoatRoughness": {"base": 0.12, "variation": 0.0}, "ior": {"base": 1.5, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/02-market.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-02-market/letters-white_albedo.png", "url": "letters-white_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-02-market/letters-white_roughness.png", "url": "letters-white_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-02-market/letters-white_height.png", "url": "letters-white_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-02-market/letters-white_normal.png", "url": "letters-white_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-02-market/letters-white_ao.png", "url": "letters-white_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 504, "sourceHeight": 62, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 504, "height": 62}, "mask": {"backgroundColor": "#7B879D", "backgroundNoise": 203.524, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.9795}, "mapStats": {"valueRange": 0.6072, "heightP90Gradient": 0.22201, "roughnessBase": 0.785, "roughnessVariation": 0.209, "normalStrength": 0.416, "blurRadius": 10}, "palette": ["#8597B7", "#0C1320", "#020510", "#2C3444", "#646F86"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "textureAnalysis": {"finishClass": "candy-coat", "recipe": {"metalness": 0.35, "roughness": 0.18, "clearcoat": 0.6, "clearcoatRoughness": 0.15, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 0.7, "anisotropy": 0.0, "procedural": "gradient-smoke"}, "palette": ["#535F73", "#4C586F", "#515A6F", "#2B364D", "#1D232E"], "paletteHueRisk": [{"stop": "#535F73", "hueRisk": "blue-collapse", "suggestedRgb": [115, 95, 83]}, {"stop": "#4C586F", "hueRisk": "blue-collapse", "suggestedRgb": [111, 88, 76]}, {"stop": "#515A6F", "hueRisk": "blue-collapse", "suggestedRgb": [111, 90, 81]}, {"stop": "#2B364D", "hueRisk": "blue-collapse", "suggestedRgb": [77, 54, 43]}, {"stop": "#1D232E", "hueRisk": "blue-collapse", "suggestedRgb": [46, 35, 29]}], "gradientAxis": "horizontal", "stats": {"meanLum": 63.1, "meanSaturation": 0.534, "gradientStrength": 0.478, "mottle": 0.15, "streakRatio": 5.05, "hueSpread": 0.013, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "market-letters", "regionId": "market", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/02-market.png", "bbox": {"x": 2362, "y": 1285, "width": 504, "height": 62}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0026}, "observations": ["chromatic base-colour response", "directional surface frequency", "visible meso/micro variation", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "market-letters", "regionId": "market", "materialId": null, "family": "coating", "subtype": "paint-over-metal", "finish": "gloss-or-satin", "aliases": [], "confidence": 0.829, "source": "vision"}, "alternatives": []}},
    options
  );
  materialMap["brass"] = createSculptMaterial(
    "brass",
    {"id": "brass", "name": "Brass pendant", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#D8A848", "color": "#D8A848", "albedo": {"dominant": "#D8A848", "secondary": ["#D8A848"], "samplingNotes": "Flat game color (vertex color); de-lit by eye from the day photo."}, "colorVariation": {"palette": ["#D8A848"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.3, "map": "material-evidence/brass/brass_roughness.png", "notes": "Evidence map from extract_pbr_evidence.py; the game uses the base value only (toon shading)."}, "metalness": {"base": 1.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referenceMaterialId": "metal.brass", "materialFamily": "metal", "materialSubtype": "brass-bronze", "materialFinish": "polished-or-aged", "materialReference": {"registry": "/Users/william-meroxa/.img2threejs/releases/a669e9a97cea4452b1c2310c5cca6aa0f6657c1f/img2threejs/docs/materials/material-reference.json", "profileId": "metal.brass", "method": "family-subtype-finish", "confidence": 0.829, "sourceRefs": ["three.mesh-standard", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-2", "google.filament-pbr"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "aoMap", "metalnessMap"], "validationViews": ["albedo-unlit", "environment-reflection", "grazing", "reference-beauty"]}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/03-brass.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-03-brass/brass_albedo.png", "url": "brass_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-03-brass/brass_roughness.png", "url": "brass_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-03-brass/brass_height.png", "url": "brass_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-03-brass/brass_normal.png", "url": "brass_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-03-brass/brass_ao.png", "url": "brass_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 50, "sourceHeight": 45, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 50, "height": 45}, "mask": {"backgroundColor": "#0F0C0B", "backgroundNoise": 71.141, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.9156}, "mapStats": {"valueRange": 0.8393, "heightP90Gradient": 0.06167, "roughnessBase": 0.719, "roughnessVariation": 0.115, "normalStrength": 0.229, "blurRadius": 10}, "palette": ["#100907", "#AF9469", "#7D6E54", "#F0CD8B", "#41382B"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#0E0E11", "#705D43", "#B39969", "#7C6C4F", "#0A0301"], "paletteHueRisk": [{"stop": "#0E0E11", "hueRisk": "blue-collapse", "suggestedRgb": [17, 14, 14]}], "gradientAxis": "vertical", "stats": {"meanLum": 91.5, "meanSaturation": 0.432, "gradientStrength": 0.59, "mottle": 0.034, "streakRatio": 0.76, "hueSpread": 0.169, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "pendant-0", "regionId": "brass", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/03-brass.png", "bbox": {"x": 2331, "y": 1433, "width": 50, "height": 45}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0002}, "observations": ["chromatic base-colour response", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "pendant-0", "regionId": "brass", "materialId": null, "family": "metal", "subtype": "brass-bronze", "finish": "polished-or-aged", "aliases": [], "confidence": 0.829, "source": "vision"}, "alternatives": []}, "needsEnvironment": true},
    options
  );
  materialMap["bulb"] = createSculptMaterial(
    "bulb",
    {"id": "bulb", "name": "Lit bulb", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#FFF1C8", "color": "#FFF1C8", "albedo": {"dominant": "#FFF1C8", "secondary": ["#FFF1C8"], "samplingNotes": "Flat game color (vertex color); de-lit by eye from the day photo."}, "colorVariation": {"palette": ["#FFF1C8"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.4, "map": "material-evidence/bulb/bulb_roughness.png", "notes": "Evidence map from extract_pbr_evidence.py; the game uses the base value only (toon shading)."}, "metalness": 0.0, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "corrugation", "type": "normal-ribs", "region": "the whole metal wall", "amount": 0.2, "notes": "Fine vertical ribs; not modeled in the game (flat toon color)."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referenceMaterialId": "metal.aluminum", "materialFamily": "metal", "materialSubtype": "aluminum", "materialFinish": "satin", "materialReference": {"registry": "/Users/william-meroxa/.img2threejs/releases/a669e9a97cea4452b1c2310c5cca6aa0f6657c1f/img2threejs/docs/materials/material-reference.json", "profileId": "metal.aluminum", "method": "family-subtype-finish", "confidence": 0.829, "sourceRefs": ["three.mesh-standard", "three.pmrem", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-2", "google.filament-pbr"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "anisotropyMap"], "validationViews": ["neutral-studio", "environment-reflection", "grazing"]}, "anisotropy": {"base": 0.2, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-00-metal/metal_albedo.png", "url": "metal_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-00-metal/metal_roughness.png", "url": "metal_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-00-metal/metal_height.png", "url": "metal_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-00-metal/metal_normal.png", "url": "metal_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/pbr-00-metal/metal_ao.png", "url": "metal_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 340, "sourceHeight": 140, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 340, "height": 140}, "mask": {"backgroundColor": "#778EAD", "backgroundNoise": 52.621, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.981}, "mapStats": {"valueRange": 0.5196, "heightP90Gradient": 0.13322, "roughnessBase": 0.722, "roughnessVariation": 0.217, "normalStrength": 0.312, "blurRadius": 10}, "palette": ["#7C92AF", "#98C1F9", "#5E708A", "#9CC4FA", "#1E2634"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "textureAnalysis": {"finishClass": "candy-coat", "recipe": {"metalness": 0.35, "roughness": 0.18, "clearcoat": 0.6, "clearcoatRoughness": 0.15, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 0.7, "anisotropy": 0.0, "procedural": "gradient-smoke"}, "palette": ["#97BEF3", "#88ABDB", "#83A0CA", "#575C64", "#6F839E"], "paletteHueRisk": [{"stop": "#97BEF3", "hueRisk": "blue-collapse", "suggestedRgb": [243, 190, 151]}, {"stop": "#88ABDB", "hueRisk": "blue-collapse", "suggestedRgb": [219, 171, 136]}, {"stop": "#83A0CA", "hueRisk": "blue-collapse", "suggestedRgb": [202, 160, 131]}, {"stop": "#6F839E", "hueRisk": "blue-collapse", "suggestedRgb": [158, 131, 111]}], "gradientAxis": "horizontal", "stats": {"meanLum": 149.1, "meanSaturation": 0.343, "gradientStrength": 0.642, "mottle": 0.047, "streakRatio": 2.39, "hueSpread": 0.001, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "roof-profile", "regionId": "metal", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}, "observations": ["chromatic base-colour response", "directional surface frequency", "visible meso/micro variation", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "roof-profile", "regionId": "metal", "materialId": null, "family": "metal", "subtype": "aluminum", "finish": "satin", "aliases": [], "confidence": 0.829, "source": "vision"}, "alternatives": []}, "needsEnvironment": true},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_roof_profile_0 = makeAttachmentEndpoint(null);
  const node_roof_profile_0 = new THREE.Group();
  node_roof_profile_0.name = "Sawtooth metal upper wall and roof__pivot";
  node_roof_profile_0.scale.set(1, 1, 1);
  if (endpoint_roof_profile_0) {
    node_roof_profile_0.position.copy(endpoint_roof_profile_0.start);
    node_roof_profile_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_roof_profile_0.position.set(0.0, 0.0, -50.0);
    node_roof_profile_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_roof_profile_0.userData.sculptComponent = {"id": "roof-profile", "name": "Sawtooth metal upper wall and roof", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.75, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A constant cross-section along the depth of the hall: an extruded 2D profile, not boxes.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": null, "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "m", "confidence": 0.75}, "transform": {"position": [0, 0, -50], "rotation": [0, 0, 0], "worldPosition": [0, 0, -50]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["corrugation", "sawtooth-step"], "surfaceDetail": {"macroRoughness": 0.42, "microRoughness": 0.08, "bumpAmplitude": 1.2, "normalPattern": "corrugation ribs every 7.5 cm (corrugatedSet bump map)", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Soft streaks in the color map."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "metal", "colorMaterialRecipe": {"materialId": "metal", "dominantAlbedo": "rgba(185, 190, 195, 1.0)", "secondaryAlbedo": "rgba(157, 161, 165, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_roof_profile_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_roof_profile_0);
  nodes["roof-profile"] = node_roof_profile_0;
  const mesh_roof_profile_0Geometry = endpoint_roof_profile_0
    ? new THREE.CylinderGeometry(endpoint_roof_profile_0.endRadius, endpoint_roof_profile_0.baseRadius, endpoint_roof_profile_0.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50});
  if (!endpoint_roof_profile_0) {
    mesh_roof_profile_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_roof_profile_0 = new THREE.Mesh(
    mesh_roof_profile_0Geometry,
    materialMap["metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_roof_profile_0.name = "Sawtooth metal upper wall and roof";
  if (endpoint_roof_profile_0) {
    mesh_roof_profile_0.position.copy(endpoint_roof_profile_0.midpoint);
    mesh_roof_profile_0.quaternion.copy(endpoint_roof_profile_0.quaternion);
  }
  mesh_roof_profile_0.castShadow = options.castShadow ?? true;
  mesh_roof_profile_0.receiveShadow = options.receiveShadow ?? true;
  mesh_roof_profile_0.userData.sculptComponent = {"id": "roof-profile", "name": "Sawtooth metal upper wall and roof", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.75, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A constant cross-section along the depth of the hall: an extruded 2D profile, not boxes.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": null, "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "m", "confidence": 0.75}, "transform": {"position": [0, 0, -50], "rotation": [0, 0, 0], "worldPosition": [0, 0, -50]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["corrugation", "sawtooth-step"], "surfaceDetail": {"macroRoughness": 0.42, "microRoughness": 0.08, "bumpAmplitude": 1.2, "normalPattern": "corrugation ribs every 7.5 cm (corrugatedSet bump map)", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Soft streaks in the color map."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "metal", "colorMaterialRecipe": {"materialId": "metal", "dominantAlbedo": "rgba(185, 190, 195, 1.0)", "secondaryAlbedo": "rgba(157, 161, 165, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_roof_profile_0.add(mesh_roof_profile_0);
  meshes["roof-profile"] = mesh_roof_profile_0;
  colliders["roof-profile"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_roof_profile_0);

  const endpoint_canopy_1 = makeAttachmentEndpoint(null);
  const node_canopy_1 = new THREE.Group();
  node_canopy_1.name = "Entrance canopy__pivot";
  node_canopy_1.scale.set(1, 1, 1);
  if (endpoint_canopy_1) {
    node_canopy_1.position.copy(endpoint_canopy_1.start);
    node_canopy_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_canopy_1.position.set(1.05, 5.86, 2.0);
    node_canopy_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_canopy_1.userData.sculptComponent = {"id": "canopy", "name": "Entrance canopy", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat cantilever slab; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": null, "attachment": null, "dimensions": {"width": 15.75, "height": 0.63, "depth": 4.0, "units": "m", "confidence": 0.75}, "transform": {"position": [1.05, 5.86, 2.0], "rotation": [0, 0, 0], "worldPosition": [1.05, 5.86, 2.0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["soffit-truss"], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_canopy_1.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_canopy_1);
  nodes["canopy"] = node_canopy_1;
  const mesh_canopy_1Geometry = endpoint_canopy_1
    ? new THREE.CylinderGeometry(endpoint_canopy_1.endRadius, endpoint_canopy_1.baseRadius, endpoint_canopy_1.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_canopy_1) {
    mesh_canopy_1Geometry.scale(15.75, 0.63, 4.0);
  }
  const mesh_canopy_1 = new THREE.Mesh(
    mesh_canopy_1Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_canopy_1.name = "Entrance canopy";
  if (endpoint_canopy_1) {
    mesh_canopy_1.position.copy(endpoint_canopy_1.midpoint);
    mesh_canopy_1.quaternion.copy(endpoint_canopy_1.quaternion);
  }
  mesh_canopy_1.castShadow = options.castShadow ?? true;
  mesh_canopy_1.receiveShadow = options.receiveShadow ?? true;
  mesh_canopy_1.userData.sculptComponent = {"id": "canopy", "name": "Entrance canopy", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat cantilever slab; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": null, "attachment": null, "dimensions": {"width": 15.75, "height": 0.63, "depth": 4.0, "units": "m", "confidence": 0.75}, "transform": {"position": [1.05, 5.86, 2.0], "rotation": [0, 0, 0], "worldPosition": [1.05, 5.86, 2.0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["soffit-truss"], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_canopy_1.add(mesh_canopy_1);
  meshes["canopy"] = mesh_canopy_1;
  colliders["canopy"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_canopy_1);

  const endpoint_canopy_truss_2 = makeAttachmentEndpoint(null);
  const node_canopy_truss_2 = new THREE.Group();
  node_canopy_truss_2.name = "Canopy steel truss__pivot";
  node_canopy_truss_2.scale.set(1, 1, 1);
  if (endpoint_canopy_truss_2) {
    node_canopy_truss_2.position.copy(endpoint_canopy_truss_2.start);
    node_canopy_truss_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_canopy_truss_2.position.set(0.0, -0.81, -0.1);
    node_canopy_truss_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_canopy_truss_2.userData.sculptComponent = {"id": "canopy-truss", "name": "Canopy steel truss", "level": "meso", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The open steel truss under the canopy deck, read as a dark slab from street level (4.5 to 5.55 m); a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [0.0, -1.31, -0.1], "localEnd": [0.0, -0.31, -0.1], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 15.4, "height": 1.0, "depth": 3.6, "units": "m", "confidence": 0.7}, "transform": {"position": [0.0, -0.81, -0.1], "rotation": [0, 0, 0], "worldPosition": [1.05, 5.05, 1.9]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_canopy_truss_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_canopy_truss_2);
  nodes["canopy-truss"] = node_canopy_truss_2;
  const mesh_canopy_truss_2Geometry = endpoint_canopy_truss_2
    ? new THREE.CylinderGeometry(endpoint_canopy_truss_2.endRadius, endpoint_canopy_truss_2.baseRadius, endpoint_canopy_truss_2.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_canopy_truss_2) {
    mesh_canopy_truss_2Geometry.scale(15.4, 1.0, 3.6);
  }
  const mesh_canopy_truss_2 = new THREE.Mesh(
    mesh_canopy_truss_2Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_canopy_truss_2.name = "Canopy steel truss";
  if (endpoint_canopy_truss_2) {
    mesh_canopy_truss_2.position.copy(endpoint_canopy_truss_2.midpoint);
    mesh_canopy_truss_2.quaternion.copy(endpoint_canopy_truss_2.quaternion);
  }
  mesh_canopy_truss_2.castShadow = options.castShadow ?? true;
  mesh_canopy_truss_2.receiveShadow = options.receiveShadow ?? true;
  mesh_canopy_truss_2.userData.sculptComponent = {"id": "canopy-truss", "name": "Canopy steel truss", "level": "meso", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The open steel truss under the canopy deck, read as a dark slab from street level (4.5 to 5.55 m); a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [0.0, -1.31, -0.1], "localEnd": [0.0, -0.31, -0.1], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 15.4, "height": 1.0, "depth": 3.6, "units": "m", "confidence": 0.7}, "transform": {"position": [0.0, -0.81, -0.1], "rotation": [0, 0, 0], "worldPosition": [1.05, 5.05, 1.9]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_canopy_truss_2.add(mesh_canopy_truss_2);
  meshes["canopy-truss"] = mesh_canopy_truss_2;
  colliders["canopy-truss"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_canopy_truss_2);

  const endpoint_post_a_3 = makeAttachmentEndpoint(null);
  const node_post_a_3 = new THREE.Group();
  node_post_a_3.name = "Canopy post A__pivot";
  node_post_a_3.scale.set(1, 1, 1);
  if (endpoint_post_a_3) {
    node_post_a_3.position.copy(endpoint_post_a_3.start);
    node_post_a_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_post_a_3.position.set(-5.55, -3.085, 1.6);
    node_post_a_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_post_a_3.userData.sculptComponent = {"id": "post-a", "name": "Canopy post A", "level": "meso", "role": "detail", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A square steel post; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-5.55, -5.86, 1.6], "localEnd": [-5.55, -0.31, 1.6], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.25, "height": 5.55, "depth": 0.25, "units": "m", "confidence": 0.7}, "transform": {"position": [-5.55, -3.085, 1.6], "rotation": [0, 0, 0], "worldPosition": [-4.5, 2.775, 3.6]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_post_a_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_post_a_3);
  nodes["post-a"] = node_post_a_3;
  const mesh_post_a_3Geometry = endpoint_post_a_3
    ? new THREE.CylinderGeometry(endpoint_post_a_3.endRadius, endpoint_post_a_3.baseRadius, endpoint_post_a_3.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_post_a_3) {
    mesh_post_a_3Geometry.scale(0.25, 5.55, 0.25);
  }
  const mesh_post_a_3 = new THREE.Mesh(
    mesh_post_a_3Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_post_a_3.name = "Canopy post A";
  if (endpoint_post_a_3) {
    mesh_post_a_3.position.copy(endpoint_post_a_3.midpoint);
    mesh_post_a_3.quaternion.copy(endpoint_post_a_3.quaternion);
  }
  mesh_post_a_3.castShadow = options.castShadow ?? true;
  mesh_post_a_3.receiveShadow = options.receiveShadow ?? true;
  mesh_post_a_3.userData.sculptComponent = {"id": "post-a", "name": "Canopy post A", "level": "meso", "role": "detail", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A square steel post; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-5.55, -5.86, 1.6], "localEnd": [-5.55, -0.31, 1.6], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.25, "height": 5.55, "depth": 0.25, "units": "m", "confidence": 0.7}, "transform": {"position": [-5.55, -3.085, 1.6], "rotation": [0, 0, 0], "worldPosition": [-4.5, 2.775, 3.6]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_post_a_3.add(mesh_post_a_3);
  meshes["post-a"] = mesh_post_a_3;
  colliders["post-a"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_post_a_3);

  const endpoint_post_b_4 = makeAttachmentEndpoint(null);
  const node_post_b_4 = new THREE.Group();
  node_post_b_4.name = "Canopy post B__pivot";
  node_post_b_4.scale.set(1, 1, 1);
  if (endpoint_post_b_4) {
    node_post_b_4.position.copy(endpoint_post_b_4.start);
    node_post_b_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_post_b_4.position.set(6.95, -3.085, 1.6);
    node_post_b_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_post_b_4.userData.sculptComponent = {"id": "post-b", "name": "Canopy post B", "level": "meso", "role": "detail", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A square steel post; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [6.95, -5.86, 1.6], "localEnd": [6.95, -0.31, 1.6], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.25, "height": 5.55, "depth": 0.25, "units": "m", "confidence": 0.7}, "transform": {"position": [6.95, -3.085, 1.6], "rotation": [0, 0, 0], "worldPosition": [8.0, 2.775, 3.6]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_post_b_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_post_b_4);
  nodes["post-b"] = node_post_b_4;
  const mesh_post_b_4Geometry = endpoint_post_b_4
    ? new THREE.CylinderGeometry(endpoint_post_b_4.endRadius, endpoint_post_b_4.baseRadius, endpoint_post_b_4.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_post_b_4) {
    mesh_post_b_4Geometry.scale(0.25, 5.55, 0.25);
  }
  const mesh_post_b_4 = new THREE.Mesh(
    mesh_post_b_4Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_post_b_4.name = "Canopy post B";
  if (endpoint_post_b_4) {
    mesh_post_b_4.position.copy(endpoint_post_b_4.midpoint);
    mesh_post_b_4.quaternion.copy(endpoint_post_b_4.quaternion);
  }
  mesh_post_b_4.castShadow = options.castShadow ?? true;
  mesh_post_b_4.receiveShadow = options.receiveShadow ?? true;
  mesh_post_b_4.userData.sculptComponent = {"id": "post-b", "name": "Canopy post B", "level": "meso", "role": "detail", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A square steel post; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [6.95, -5.86, 1.6], "localEnd": [6.95, -0.31, 1.6], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.25, "height": 5.55, "depth": 0.25, "units": "m", "confidence": 0.7}, "transform": {"position": [6.95, -3.085, 1.6], "rotation": [0, 0, 0], "worldPosition": [8.0, 2.775, 3.6]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_post_b_4.add(mesh_post_b_4);
  meshes["post-b"] = mesh_post_b_4;
  colliders["post-b"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_post_b_4);

  const endpoint_krog_street_letters_5 = makeAttachmentEndpoint(null);
  const node_krog_street_letters_5 = new THREE.Group();
  node_krog_street_letters_5.name = "KROG STREET letters__pivot";
  node_krog_street_letters_5.scale.set(1, 1, 1);
  if (endpoint_krog_street_letters_5) {
    node_krog_street_letters_5.position.copy(endpoint_krog_street_letters_5.start);
    node_krog_street_letters_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_krog_street_letters_5.position.set(-0.95, 1.5, 0.6);
    node_krog_street_letters_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_krog_street_letters_5.userData.sculptComponent = {"id": "krog-street-letters", "name": "KROG STREET letters", "level": "meso", "role": "detail", "importance": 1.0, "confidence": 0.85, "primitive": "plane-card", "topologyClass": "surface-relief", "topologyRationale": "Black block letters standing on the canopy, read as a flat card with a transparent canvas texture.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-0.95, 0.45, 0.6], "localEnd": [-0.95, 2.55, 0.6], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 9.8, "height": 2.1, "depth": 0.02, "units": "m", "confidence": 0.85}, "transform": {"position": [-0.95, 1.5, 0.6], "rotation": [0, 0, 0], "worldPosition": [0.1, 7.36, 2.6]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}], "canvasText": {"text": "KROG STREET", "color": "#1E2023", "background": "transparent", "outline": "#C9CCD0", "drawnBy": "src/render/landmark-signs.js createSignTexture"}};
  node_krog_street_letters_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_krog_street_letters_5);
  nodes["krog-street-letters"] = node_krog_street_letters_5;
  const mesh_krog_street_letters_5Geometry = endpoint_krog_street_letters_5
    ? new THREE.CylinderGeometry(endpoint_krog_street_letters_5.endRadius, endpoint_krog_street_letters_5.baseRadius, endpoint_krog_street_letters_5.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_krog_street_letters_5) {
    mesh_krog_street_letters_5Geometry.scale(9.8, 2.1, 0.02);
  }
  const mesh_krog_street_letters_5 = new THREE.Mesh(
    mesh_krog_street_letters_5Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_krog_street_letters_5.name = "KROG STREET letters";
  if (endpoint_krog_street_letters_5) {
    mesh_krog_street_letters_5.position.copy(endpoint_krog_street_letters_5.midpoint);
    mesh_krog_street_letters_5.quaternion.copy(endpoint_krog_street_letters_5.quaternion);
  }
  mesh_krog_street_letters_5.castShadow = options.castShadow ?? true;
  mesh_krog_street_letters_5.receiveShadow = options.receiveShadow ?? true;
  mesh_krog_street_letters_5.userData.sculptComponent = {"id": "krog-street-letters", "name": "KROG STREET letters", "level": "meso", "role": "detail", "importance": 1.0, "confidence": 0.85, "primitive": "plane-card", "topologyClass": "surface-relief", "topologyRationale": "Black block letters standing on the canopy, read as a flat card with a transparent canvas texture.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-0.95, 0.45, 0.6], "localEnd": [-0.95, 2.55, 0.6], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 9.8, "height": 2.1, "depth": 0.02, "units": "m", "confidence": 0.85}, "transform": {"position": [-0.95, 1.5, 0.6], "rotation": [0, 0, 0], "worldPosition": [0.1, 7.36, 2.6]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}], "canvasText": {"text": "KROG STREET", "color": "#1E2023", "background": "transparent", "outline": "#C9CCD0", "drawnBy": "src/render/landmark-signs.js createSignTexture"}};
  node_krog_street_letters_5.add(mesh_krog_street_letters_5);
  meshes["krog-street-letters"] = mesh_krog_street_letters_5;
  colliders["krog-street-letters"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_krog_street_letters_5);

  const endpoint_market_letters_6 = makeAttachmentEndpoint(null);
  const node_market_letters_6 = new THREE.Group();
  node_market_letters_6.name = "MARKET letters__pivot";
  node_market_letters_6.scale.set(1, 1, 1);
  if (endpoint_market_letters_6) {
    node_market_letters_6.position.copy(endpoint_market_letters_6.start);
    node_market_letters_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_market_letters_6.position.set(4.05, 0.0, 2.02);
    node_market_letters_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_market_letters_6.userData.sculptComponent = {"id": "market-letters", "name": "MARKET letters", "level": "meso", "role": "detail", "importance": 0.9, "confidence": 0.85, "primitive": "plane-card", "topologyClass": "surface-relief", "topologyRationale": "White letters on the canopy fascia; a flat card with a canvas texture.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [4.05, -0.38, 2.02], "localEnd": [4.05, 0.38, 2.02], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 5.3, "height": 0.76, "depth": 0.02, "units": "m", "confidence": 0.85}, "transform": {"position": [4.05, 0.0, 2.02], "rotation": [0, 0, 0], "worldPosition": [5.1, 5.86, 4.02]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "letters-white", "materialLayers": ["letters-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "letters-white", "colorMaterialRecipe": {"materialId": "letters-white", "dominantAlbedo": "rgba(244, 244, 242, 1.0)", "secondaryAlbedo": "rgba(207, 207, 205, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}], "canvasText": {"text": "MARKET", "color": "#F4F4F2", "background": "#1E2023", "drawnBy": "src/render/landmark-signs.js createSignTexture"}};
  node_market_letters_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_market_letters_6);
  nodes["market-letters"] = node_market_letters_6;
  const mesh_market_letters_6Geometry = endpoint_market_letters_6
    ? new THREE.CylinderGeometry(endpoint_market_letters_6.endRadius, endpoint_market_letters_6.baseRadius, endpoint_market_letters_6.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_market_letters_6) {
    mesh_market_letters_6Geometry.scale(5.3, 0.76, 0.02);
  }
  const mesh_market_letters_6 = new THREE.Mesh(
    mesh_market_letters_6Geometry,
    materialMap["letters-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_market_letters_6.name = "MARKET letters";
  if (endpoint_market_letters_6) {
    mesh_market_letters_6.position.copy(endpoint_market_letters_6.midpoint);
    mesh_market_letters_6.quaternion.copy(endpoint_market_letters_6.quaternion);
  }
  mesh_market_letters_6.castShadow = options.castShadow ?? true;
  mesh_market_letters_6.receiveShadow = options.receiveShadow ?? true;
  mesh_market_letters_6.userData.sculptComponent = {"id": "market-letters", "name": "MARKET letters", "level": "meso", "role": "detail", "importance": 0.9, "confidence": 0.85, "primitive": "plane-card", "topologyClass": "surface-relief", "topologyRationale": "White letters on the canopy fascia; a flat card with a canvas texture.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [4.05, -0.38, 2.02], "localEnd": [4.05, 0.38, 2.02], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 5.3, "height": 0.76, "depth": 0.02, "units": "m", "confidence": 0.85}, "transform": {"position": [4.05, 0.0, 2.02], "rotation": [0, 0, 0], "worldPosition": [5.1, 5.86, 4.02]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "letters-white", "materialLayers": ["letters-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "letters-white", "colorMaterialRecipe": {"materialId": "letters-white", "dominantAlbedo": "rgba(244, 244, 242, 1.0)", "secondaryAlbedo": "rgba(207, 207, 205, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}], "canvasText": {"text": "MARKET", "color": "#F4F4F2", "background": "#1E2023", "drawnBy": "src/render/landmark-signs.js createSignTexture"}};
  node_market_letters_6.add(mesh_market_letters_6);
  meshes["market-letters"] = mesh_market_letters_6;
  colliders["market-letters"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_market_letters_6);

  const attachment_pendant_0_7 = {"parentSocket": "canopy", "localStart": [-3.25, -1.76, 1.0], "localEnd": [-3.25, -1.36, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.25, "endRadius": 0.25};
  const endpoint_pendant_0_7 = makeAttachmentEndpoint(attachment_pendant_0_7);
  const node_pendant_0_7 = new THREE.Group();
  node_pendant_0_7.name = "Pendant light 0__pivot";
  node_pendant_0_7.scale.set(1, 1, 1);
  if (endpoint_pendant_0_7) {
    node_pendant_0_7.position.copy(endpoint_pendant_0_7.start);
    node_pendant_0_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pendant_0_7.position.set(-3.25, -1.56, 1.0);
    node_pendant_0_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_pendant_0_7.userData.sculptComponent = {"id": "pendant-0", "name": "Pendant light 0", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A small round brass shade; a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-3.25, -1.76, 1.0], "localEnd": [-3.25, -1.36, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.25, "endRadius": 0.25}, "dimensions": {"width": 0.5, "height": 0.4, "depth": 0.5, "units": "m", "confidence": 0.6, "radius": 0.25}, "transform": {"position": [-3.25, -1.56, 1.0], "rotation": [0, 0, 0], "worldPosition": [-2.2, 4.3, 3.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brass", "materialLayers": ["brass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.25, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "polished brass", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "A faint emissive warmth from the bulb."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "brass", "colorMaterialRecipe": {"materialId": "brass", "dominantAlbedo": "rgba(216, 168, 72, 1.0)", "secondaryAlbedo": "rgba(183, 142, 61, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_0_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_pendant_0_7);
  nodes["pendant-0"] = node_pendant_0_7;
  const mesh_pendant_0_7Geometry = endpoint_pendant_0_7
    ? new THREE.CylinderGeometry(endpoint_pendant_0_7.endRadius, endpoint_pendant_0_7.baseRadius, endpoint_pendant_0_7.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_pendant_0_7) {
    mesh_pendant_0_7Geometry.scale(0.5, 0.4, 0.5);
  }
  const mesh_pendant_0_7 = new THREE.Mesh(
    mesh_pendant_0_7Geometry,
    materialMap["brass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pendant_0_7.name = "Pendant light 0";
  if (endpoint_pendant_0_7) {
    mesh_pendant_0_7.position.copy(endpoint_pendant_0_7.midpoint);
    mesh_pendant_0_7.quaternion.copy(endpoint_pendant_0_7.quaternion);
  }
  mesh_pendant_0_7.castShadow = options.castShadow ?? true;
  mesh_pendant_0_7.receiveShadow = options.receiveShadow ?? true;
  mesh_pendant_0_7.userData.sculptComponent = {"id": "pendant-0", "name": "Pendant light 0", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A small round brass shade; a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-3.25, -1.76, 1.0], "localEnd": [-3.25, -1.36, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.25, "endRadius": 0.25}, "dimensions": {"width": 0.5, "height": 0.4, "depth": 0.5, "units": "m", "confidence": 0.6, "radius": 0.25}, "transform": {"position": [-3.25, -1.56, 1.0], "rotation": [0, 0, 0], "worldPosition": [-2.2, 4.3, 3.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brass", "materialLayers": ["brass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.25, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "polished brass", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "A faint emissive warmth from the bulb."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "brass", "colorMaterialRecipe": {"materialId": "brass", "dominantAlbedo": "rgba(216, 168, 72, 1.0)", "secondaryAlbedo": "rgba(183, 142, 61, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_0_7.add(mesh_pendant_0_7);
  meshes["pendant-0"] = mesh_pendant_0_7;
  colliders["pendant-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_pendant_0_7);

  const attachment_pendant_cord_0_8 = {"parentSocket": "canopy", "localStart": [-3.25, -1.36, 1.0], "localEnd": [-3.25, -1.26, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.015, "endRadius": 0.015};
  const endpoint_pendant_cord_0_8 = makeAttachmentEndpoint(attachment_pendant_cord_0_8);
  const node_pendant_cord_0_8 = new THREE.Group();
  node_pendant_cord_0_8.name = "Pendant cord 0__pivot";
  node_pendant_cord_0_8.scale.set(1, 1, 1);
  if (endpoint_pendant_cord_0_8) {
    node_pendant_cord_0_8.position.copy(endpoint_pendant_cord_0_8.start);
    node_pendant_cord_0_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pendant_cord_0_8.position.set(-3.25, -1.31, 1.0);
    node_pendant_cord_0_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_pendant_cord_0_8.userData.sculptComponent = {"id": "pendant-cord-0", "name": "Pendant cord 0", "level": "micro", "role": "detail", "importance": 0.3, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The short drop from the truss to the shade; a thin cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-3.25, -1.36, 1.0], "localEnd": [-3.25, -1.26, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.015, "endRadius": 0.015}, "dimensions": {"width": 0.03, "height": 0.1, "depth": 0.03, "units": "m", "confidence": 0.6, "radius": 0.015}, "transform": {"position": [-3.25, -1.31, 1.0], "rotation": [0, 0, 0], "worldPosition": [-2.2, 4.55, 3.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_cord_0_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_pendant_cord_0_8);
  nodes["pendant-cord-0"] = node_pendant_cord_0_8;
  const mesh_pendant_cord_0_8Geometry = endpoint_pendant_cord_0_8
    ? new THREE.CylinderGeometry(endpoint_pendant_cord_0_8.endRadius, endpoint_pendant_cord_0_8.baseRadius, endpoint_pendant_cord_0_8.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_pendant_cord_0_8) {
    mesh_pendant_cord_0_8Geometry.scale(0.03, 0.1, 0.03);
  }
  const mesh_pendant_cord_0_8 = new THREE.Mesh(
    mesh_pendant_cord_0_8Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pendant_cord_0_8.name = "Pendant cord 0";
  if (endpoint_pendant_cord_0_8) {
    mesh_pendant_cord_0_8.position.copy(endpoint_pendant_cord_0_8.midpoint);
    mesh_pendant_cord_0_8.quaternion.copy(endpoint_pendant_cord_0_8.quaternion);
  }
  mesh_pendant_cord_0_8.castShadow = options.castShadow ?? true;
  mesh_pendant_cord_0_8.receiveShadow = options.receiveShadow ?? true;
  mesh_pendant_cord_0_8.userData.sculptComponent = {"id": "pendant-cord-0", "name": "Pendant cord 0", "level": "micro", "role": "detail", "importance": 0.3, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The short drop from the truss to the shade; a thin cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-3.25, -1.36, 1.0], "localEnd": [-3.25, -1.26, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.015, "endRadius": 0.015}, "dimensions": {"width": 0.03, "height": 0.1, "depth": 0.03, "units": "m", "confidence": 0.6, "radius": 0.015}, "transform": {"position": [-3.25, -1.31, 1.0], "rotation": [0, 0, 0], "worldPosition": [-2.2, 4.55, 3.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_cord_0_8.add(mesh_pendant_cord_0_8);
  meshes["pendant-cord-0"] = mesh_pendant_cord_0_8;
  colliders["pendant-cord-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_pendant_cord_0_8);

  const endpoint_pendant_bulb_0_9 = makeAttachmentEndpoint(null);
  const node_pendant_bulb_0_9 = new THREE.Group();
  node_pendant_bulb_0_9.name = "Pendant bulb 0__pivot";
  node_pendant_bulb_0_9.scale.set(1, 1, 1);
  if (endpoint_pendant_bulb_0_9) {
    node_pendant_bulb_0_9.position.copy(endpoint_pendant_bulb_0_9.start);
    node_pendant_bulb_0_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pendant_bulb_0_9.position.set(-3.25, -1.78, 1.0);
    node_pendant_bulb_0_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_pendant_bulb_0_9.userData.sculptComponent = {"id": "pendant-bulb-0", "name": "Pendant bulb 0", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "The lit bulb under the shade; a small sphere.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-3.25, -1.89, 1.0], "localEnd": [-3.25, -1.67, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.22, "height": 0.22, "depth": 0.22, "units": "m", "confidence": 0.6}, "transform": {"position": [-3.25, -1.78, 1.0], "rotation": [0, 0, 0], "worldPosition": [-2.2, 4.08, 3.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "bulb", "materialLayers": ["bulb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.4, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Emissive."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "bulb", "colorMaterialRecipe": {"materialId": "bulb", "dominantAlbedo": "rgba(255, 241, 200, 1.0)", "secondaryAlbedo": "rgba(216, 204, 170, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_bulb_0_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_pendant_bulb_0_9);
  nodes["pendant-bulb-0"] = node_pendant_bulb_0_9;
  const mesh_pendant_bulb_0_9Geometry = endpoint_pendant_bulb_0_9
    ? new THREE.CylinderGeometry(endpoint_pendant_bulb_0_9.endRadius, endpoint_pendant_bulb_0_9.baseRadius, endpoint_pendant_bulb_0_9.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 12, 8);
  if (!endpoint_pendant_bulb_0_9) {
    mesh_pendant_bulb_0_9Geometry.scale(0.22, 0.22, 0.22);
  }
  const mesh_pendant_bulb_0_9 = new THREE.Mesh(
    mesh_pendant_bulb_0_9Geometry,
    materialMap["bulb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pendant_bulb_0_9.name = "Pendant bulb 0";
  if (endpoint_pendant_bulb_0_9) {
    mesh_pendant_bulb_0_9.position.copy(endpoint_pendant_bulb_0_9.midpoint);
    mesh_pendant_bulb_0_9.quaternion.copy(endpoint_pendant_bulb_0_9.quaternion);
  }
  mesh_pendant_bulb_0_9.castShadow = options.castShadow ?? true;
  mesh_pendant_bulb_0_9.receiveShadow = options.receiveShadow ?? true;
  mesh_pendant_bulb_0_9.userData.sculptComponent = {"id": "pendant-bulb-0", "name": "Pendant bulb 0", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "The lit bulb under the shade; a small sphere.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-3.25, -1.89, 1.0], "localEnd": [-3.25, -1.67, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.22, "height": 0.22, "depth": 0.22, "units": "m", "confidence": 0.6}, "transform": {"position": [-3.25, -1.78, 1.0], "rotation": [0, 0, 0], "worldPosition": [-2.2, 4.08, 3.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "bulb", "materialLayers": ["bulb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.4, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Emissive."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "bulb", "colorMaterialRecipe": {"materialId": "bulb", "dominantAlbedo": "rgba(255, 241, 200, 1.0)", "secondaryAlbedo": "rgba(216, 204, 170, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_bulb_0_9.add(mesh_pendant_bulb_0_9);
  meshes["pendant-bulb-0"] = mesh_pendant_bulb_0_9;
  colliders["pendant-bulb-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_pendant_bulb_0_9);

  const attachment_pendant_1_10 = {"parentSocket": "canopy", "localStart": [-2.55, -1.76, -0.4], "localEnd": [-2.55, -1.36, -0.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.25, "endRadius": 0.25};
  const endpoint_pendant_1_10 = makeAttachmentEndpoint(attachment_pendant_1_10);
  const node_pendant_1_10 = new THREE.Group();
  node_pendant_1_10.name = "Pendant light 1__pivot";
  node_pendant_1_10.scale.set(1, 1, 1);
  if (endpoint_pendant_1_10) {
    node_pendant_1_10.position.copy(endpoint_pendant_1_10.start);
    node_pendant_1_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pendant_1_10.position.set(-2.55, -1.56, -0.4);
    node_pendant_1_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_pendant_1_10.userData.sculptComponent = {"id": "pendant-1", "name": "Pendant light 1", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A small round brass shade; a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-2.55, -1.76, -0.4], "localEnd": [-2.55, -1.36, -0.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.25, "endRadius": 0.25}, "dimensions": {"width": 0.5, "height": 0.4, "depth": 0.5, "units": "m", "confidence": 0.6, "radius": 0.25}, "transform": {"position": [-2.55, -1.56, -0.4], "rotation": [0, 0, 0], "worldPosition": [-1.5, 4.3, 1.6]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brass", "materialLayers": ["brass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.25, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "polished brass", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "A faint emissive warmth from the bulb."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "brass", "colorMaterialRecipe": {"materialId": "brass", "dominantAlbedo": "rgba(216, 168, 72, 1.0)", "secondaryAlbedo": "rgba(183, 142, 61, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_1_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_pendant_1_10);
  nodes["pendant-1"] = node_pendant_1_10;
  const mesh_pendant_1_10Geometry = endpoint_pendant_1_10
    ? new THREE.CylinderGeometry(endpoint_pendant_1_10.endRadius, endpoint_pendant_1_10.baseRadius, endpoint_pendant_1_10.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_pendant_1_10) {
    mesh_pendant_1_10Geometry.scale(0.5, 0.4, 0.5);
  }
  const mesh_pendant_1_10 = new THREE.Mesh(
    mesh_pendant_1_10Geometry,
    materialMap["brass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pendant_1_10.name = "Pendant light 1";
  if (endpoint_pendant_1_10) {
    mesh_pendant_1_10.position.copy(endpoint_pendant_1_10.midpoint);
    mesh_pendant_1_10.quaternion.copy(endpoint_pendant_1_10.quaternion);
  }
  mesh_pendant_1_10.castShadow = options.castShadow ?? true;
  mesh_pendant_1_10.receiveShadow = options.receiveShadow ?? true;
  mesh_pendant_1_10.userData.sculptComponent = {"id": "pendant-1", "name": "Pendant light 1", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A small round brass shade; a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-2.55, -1.76, -0.4], "localEnd": [-2.55, -1.36, -0.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.25, "endRadius": 0.25}, "dimensions": {"width": 0.5, "height": 0.4, "depth": 0.5, "units": "m", "confidence": 0.6, "radius": 0.25}, "transform": {"position": [-2.55, -1.56, -0.4], "rotation": [0, 0, 0], "worldPosition": [-1.5, 4.3, 1.6]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brass", "materialLayers": ["brass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.25, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "polished brass", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "A faint emissive warmth from the bulb."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "brass", "colorMaterialRecipe": {"materialId": "brass", "dominantAlbedo": "rgba(216, 168, 72, 1.0)", "secondaryAlbedo": "rgba(183, 142, 61, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_1_10.add(mesh_pendant_1_10);
  meshes["pendant-1"] = mesh_pendant_1_10;
  colliders["pendant-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_pendant_1_10);

  const attachment_pendant_cord_1_11 = {"parentSocket": "canopy", "localStart": [-2.55, -1.36, -0.4], "localEnd": [-2.55, -1.26, -0.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.015, "endRadius": 0.015};
  const endpoint_pendant_cord_1_11 = makeAttachmentEndpoint(attachment_pendant_cord_1_11);
  const node_pendant_cord_1_11 = new THREE.Group();
  node_pendant_cord_1_11.name = "Pendant cord 1__pivot";
  node_pendant_cord_1_11.scale.set(1, 1, 1);
  if (endpoint_pendant_cord_1_11) {
    node_pendant_cord_1_11.position.copy(endpoint_pendant_cord_1_11.start);
    node_pendant_cord_1_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pendant_cord_1_11.position.set(-2.55, -1.31, -0.4);
    node_pendant_cord_1_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_pendant_cord_1_11.userData.sculptComponent = {"id": "pendant-cord-1", "name": "Pendant cord 1", "level": "micro", "role": "detail", "importance": 0.3, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The short drop from the truss to the shade; a thin cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-2.55, -1.36, -0.4], "localEnd": [-2.55, -1.26, -0.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.015, "endRadius": 0.015}, "dimensions": {"width": 0.03, "height": 0.1, "depth": 0.03, "units": "m", "confidence": 0.6, "radius": 0.015}, "transform": {"position": [-2.55, -1.31, -0.4], "rotation": [0, 0, 0], "worldPosition": [-1.5, 4.55, 1.6]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_cord_1_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_pendant_cord_1_11);
  nodes["pendant-cord-1"] = node_pendant_cord_1_11;
  const mesh_pendant_cord_1_11Geometry = endpoint_pendant_cord_1_11
    ? new THREE.CylinderGeometry(endpoint_pendant_cord_1_11.endRadius, endpoint_pendant_cord_1_11.baseRadius, endpoint_pendant_cord_1_11.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_pendant_cord_1_11) {
    mesh_pendant_cord_1_11Geometry.scale(0.03, 0.1, 0.03);
  }
  const mesh_pendant_cord_1_11 = new THREE.Mesh(
    mesh_pendant_cord_1_11Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pendant_cord_1_11.name = "Pendant cord 1";
  if (endpoint_pendant_cord_1_11) {
    mesh_pendant_cord_1_11.position.copy(endpoint_pendant_cord_1_11.midpoint);
    mesh_pendant_cord_1_11.quaternion.copy(endpoint_pendant_cord_1_11.quaternion);
  }
  mesh_pendant_cord_1_11.castShadow = options.castShadow ?? true;
  mesh_pendant_cord_1_11.receiveShadow = options.receiveShadow ?? true;
  mesh_pendant_cord_1_11.userData.sculptComponent = {"id": "pendant-cord-1", "name": "Pendant cord 1", "level": "micro", "role": "detail", "importance": 0.3, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The short drop from the truss to the shade; a thin cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-2.55, -1.36, -0.4], "localEnd": [-2.55, -1.26, -0.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.015, "endRadius": 0.015}, "dimensions": {"width": 0.03, "height": 0.1, "depth": 0.03, "units": "m", "confidence": 0.6, "radius": 0.015}, "transform": {"position": [-2.55, -1.31, -0.4], "rotation": [0, 0, 0], "worldPosition": [-1.5, 4.55, 1.6]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_cord_1_11.add(mesh_pendant_cord_1_11);
  meshes["pendant-cord-1"] = mesh_pendant_cord_1_11;
  colliders["pendant-cord-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_pendant_cord_1_11);

  const endpoint_pendant_bulb_1_12 = makeAttachmentEndpoint(null);
  const node_pendant_bulb_1_12 = new THREE.Group();
  node_pendant_bulb_1_12.name = "Pendant bulb 1__pivot";
  node_pendant_bulb_1_12.scale.set(1, 1, 1);
  if (endpoint_pendant_bulb_1_12) {
    node_pendant_bulb_1_12.position.copy(endpoint_pendant_bulb_1_12.start);
    node_pendant_bulb_1_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pendant_bulb_1_12.position.set(-2.55, -1.78, -0.4);
    node_pendant_bulb_1_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_pendant_bulb_1_12.userData.sculptComponent = {"id": "pendant-bulb-1", "name": "Pendant bulb 1", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "The lit bulb under the shade; a small sphere.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-2.55, -1.89, -0.4], "localEnd": [-2.55, -1.67, -0.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.22, "height": 0.22, "depth": 0.22, "units": "m", "confidence": 0.6}, "transform": {"position": [-2.55, -1.78, -0.4], "rotation": [0, 0, 0], "worldPosition": [-1.5, 4.08, 1.6]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "bulb", "materialLayers": ["bulb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.4, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Emissive."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "bulb", "colorMaterialRecipe": {"materialId": "bulb", "dominantAlbedo": "rgba(255, 241, 200, 1.0)", "secondaryAlbedo": "rgba(216, 204, 170, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_bulb_1_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_pendant_bulb_1_12);
  nodes["pendant-bulb-1"] = node_pendant_bulb_1_12;
  const mesh_pendant_bulb_1_12Geometry = endpoint_pendant_bulb_1_12
    ? new THREE.CylinderGeometry(endpoint_pendant_bulb_1_12.endRadius, endpoint_pendant_bulb_1_12.baseRadius, endpoint_pendant_bulb_1_12.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 12, 8);
  if (!endpoint_pendant_bulb_1_12) {
    mesh_pendant_bulb_1_12Geometry.scale(0.22, 0.22, 0.22);
  }
  const mesh_pendant_bulb_1_12 = new THREE.Mesh(
    mesh_pendant_bulb_1_12Geometry,
    materialMap["bulb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pendant_bulb_1_12.name = "Pendant bulb 1";
  if (endpoint_pendant_bulb_1_12) {
    mesh_pendant_bulb_1_12.position.copy(endpoint_pendant_bulb_1_12.midpoint);
    mesh_pendant_bulb_1_12.quaternion.copy(endpoint_pendant_bulb_1_12.quaternion);
  }
  mesh_pendant_bulb_1_12.castShadow = options.castShadow ?? true;
  mesh_pendant_bulb_1_12.receiveShadow = options.receiveShadow ?? true;
  mesh_pendant_bulb_1_12.userData.sculptComponent = {"id": "pendant-bulb-1", "name": "Pendant bulb 1", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "The lit bulb under the shade; a small sphere.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-2.55, -1.89, -0.4], "localEnd": [-2.55, -1.67, -0.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.22, "height": 0.22, "depth": 0.22, "units": "m", "confidence": 0.6}, "transform": {"position": [-2.55, -1.78, -0.4], "rotation": [0, 0, 0], "worldPosition": [-1.5, 4.08, 1.6]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "bulb", "materialLayers": ["bulb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.4, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Emissive."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "bulb", "colorMaterialRecipe": {"materialId": "bulb", "dominantAlbedo": "rgba(255, 241, 200, 1.0)", "secondaryAlbedo": "rgba(216, 204, 170, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_bulb_1_12.add(mesh_pendant_bulb_1_12);
  meshes["pendant-bulb-1"] = mesh_pendant_bulb_1_12;
  colliders["pendant-bulb-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_pendant_bulb_1_12);

  const attachment_pendant_2_13 = {"parentSocket": "canopy", "localStart": [1.35, -1.76, 1.0], "localEnd": [1.35, -1.36, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.25, "endRadius": 0.25};
  const endpoint_pendant_2_13 = makeAttachmentEndpoint(attachment_pendant_2_13);
  const node_pendant_2_13 = new THREE.Group();
  node_pendant_2_13.name = "Pendant light 2__pivot";
  node_pendant_2_13.scale.set(1, 1, 1);
  if (endpoint_pendant_2_13) {
    node_pendant_2_13.position.copy(endpoint_pendant_2_13.start);
    node_pendant_2_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pendant_2_13.position.set(1.35, -1.56, 1.0);
    node_pendant_2_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_pendant_2_13.userData.sculptComponent = {"id": "pendant-2", "name": "Pendant light 2", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A small round brass shade; a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [1.35, -1.76, 1.0], "localEnd": [1.35, -1.36, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.25, "endRadius": 0.25}, "dimensions": {"width": 0.5, "height": 0.4, "depth": 0.5, "units": "m", "confidence": 0.6, "radius": 0.25}, "transform": {"position": [1.35, -1.56, 1.0], "rotation": [0, 0, 0], "worldPosition": [2.4, 4.3, 3.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brass", "materialLayers": ["brass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.25, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "polished brass", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "A faint emissive warmth from the bulb."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "brass", "colorMaterialRecipe": {"materialId": "brass", "dominantAlbedo": "rgba(216, 168, 72, 1.0)", "secondaryAlbedo": "rgba(183, 142, 61, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_2_13.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_pendant_2_13);
  nodes["pendant-2"] = node_pendant_2_13;
  const mesh_pendant_2_13Geometry = endpoint_pendant_2_13
    ? new THREE.CylinderGeometry(endpoint_pendant_2_13.endRadius, endpoint_pendant_2_13.baseRadius, endpoint_pendant_2_13.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_pendant_2_13) {
    mesh_pendant_2_13Geometry.scale(0.5, 0.4, 0.5);
  }
  const mesh_pendant_2_13 = new THREE.Mesh(
    mesh_pendant_2_13Geometry,
    materialMap["brass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pendant_2_13.name = "Pendant light 2";
  if (endpoint_pendant_2_13) {
    mesh_pendant_2_13.position.copy(endpoint_pendant_2_13.midpoint);
    mesh_pendant_2_13.quaternion.copy(endpoint_pendant_2_13.quaternion);
  }
  mesh_pendant_2_13.castShadow = options.castShadow ?? true;
  mesh_pendant_2_13.receiveShadow = options.receiveShadow ?? true;
  mesh_pendant_2_13.userData.sculptComponent = {"id": "pendant-2", "name": "Pendant light 2", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A small round brass shade; a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [1.35, -1.76, 1.0], "localEnd": [1.35, -1.36, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.25, "endRadius": 0.25}, "dimensions": {"width": 0.5, "height": 0.4, "depth": 0.5, "units": "m", "confidence": 0.6, "radius": 0.25}, "transform": {"position": [1.35, -1.56, 1.0], "rotation": [0, 0, 0], "worldPosition": [2.4, 4.3, 3.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brass", "materialLayers": ["brass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.25, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "polished brass", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "A faint emissive warmth from the bulb."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "brass", "colorMaterialRecipe": {"materialId": "brass", "dominantAlbedo": "rgba(216, 168, 72, 1.0)", "secondaryAlbedo": "rgba(183, 142, 61, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_2_13.add(mesh_pendant_2_13);
  meshes["pendant-2"] = mesh_pendant_2_13;
  colliders["pendant-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_pendant_2_13);

  const attachment_pendant_cord_2_14 = {"parentSocket": "canopy", "localStart": [1.35, -1.36, 1.0], "localEnd": [1.35, -1.26, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.015, "endRadius": 0.015};
  const endpoint_pendant_cord_2_14 = makeAttachmentEndpoint(attachment_pendant_cord_2_14);
  const node_pendant_cord_2_14 = new THREE.Group();
  node_pendant_cord_2_14.name = "Pendant cord 2__pivot";
  node_pendant_cord_2_14.scale.set(1, 1, 1);
  if (endpoint_pendant_cord_2_14) {
    node_pendant_cord_2_14.position.copy(endpoint_pendant_cord_2_14.start);
    node_pendant_cord_2_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pendant_cord_2_14.position.set(1.35, -1.31, 1.0);
    node_pendant_cord_2_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_pendant_cord_2_14.userData.sculptComponent = {"id": "pendant-cord-2", "name": "Pendant cord 2", "level": "micro", "role": "detail", "importance": 0.3, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The short drop from the truss to the shade; a thin cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [1.35, -1.36, 1.0], "localEnd": [1.35, -1.26, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.015, "endRadius": 0.015}, "dimensions": {"width": 0.03, "height": 0.1, "depth": 0.03, "units": "m", "confidence": 0.6, "radius": 0.015}, "transform": {"position": [1.35, -1.31, 1.0], "rotation": [0, 0, 0], "worldPosition": [2.4, 4.55, 3.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_cord_2_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_pendant_cord_2_14);
  nodes["pendant-cord-2"] = node_pendant_cord_2_14;
  const mesh_pendant_cord_2_14Geometry = endpoint_pendant_cord_2_14
    ? new THREE.CylinderGeometry(endpoint_pendant_cord_2_14.endRadius, endpoint_pendant_cord_2_14.baseRadius, endpoint_pendant_cord_2_14.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_pendant_cord_2_14) {
    mesh_pendant_cord_2_14Geometry.scale(0.03, 0.1, 0.03);
  }
  const mesh_pendant_cord_2_14 = new THREE.Mesh(
    mesh_pendant_cord_2_14Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pendant_cord_2_14.name = "Pendant cord 2";
  if (endpoint_pendant_cord_2_14) {
    mesh_pendant_cord_2_14.position.copy(endpoint_pendant_cord_2_14.midpoint);
    mesh_pendant_cord_2_14.quaternion.copy(endpoint_pendant_cord_2_14.quaternion);
  }
  mesh_pendant_cord_2_14.castShadow = options.castShadow ?? true;
  mesh_pendant_cord_2_14.receiveShadow = options.receiveShadow ?? true;
  mesh_pendant_cord_2_14.userData.sculptComponent = {"id": "pendant-cord-2", "name": "Pendant cord 2", "level": "micro", "role": "detail", "importance": 0.3, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The short drop from the truss to the shade; a thin cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [1.35, -1.36, 1.0], "localEnd": [1.35, -1.26, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.015, "endRadius": 0.015}, "dimensions": {"width": 0.03, "height": 0.1, "depth": 0.03, "units": "m", "confidence": 0.6, "radius": 0.015}, "transform": {"position": [1.35, -1.31, 1.0], "rotation": [0, 0, 0], "worldPosition": [2.4, 4.55, 3.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_cord_2_14.add(mesh_pendant_cord_2_14);
  meshes["pendant-cord-2"] = mesh_pendant_cord_2_14;
  colliders["pendant-cord-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_pendant_cord_2_14);

  const endpoint_pendant_bulb_2_15 = makeAttachmentEndpoint(null);
  const node_pendant_bulb_2_15 = new THREE.Group();
  node_pendant_bulb_2_15.name = "Pendant bulb 2__pivot";
  node_pendant_bulb_2_15.scale.set(1, 1, 1);
  if (endpoint_pendant_bulb_2_15) {
    node_pendant_bulb_2_15.position.copy(endpoint_pendant_bulb_2_15.start);
    node_pendant_bulb_2_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pendant_bulb_2_15.position.set(1.35, -1.78, 1.0);
    node_pendant_bulb_2_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_pendant_bulb_2_15.userData.sculptComponent = {"id": "pendant-bulb-2", "name": "Pendant bulb 2", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "The lit bulb under the shade; a small sphere.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [1.35, -1.89, 1.0], "localEnd": [1.35, -1.67, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.22, "height": 0.22, "depth": 0.22, "units": "m", "confidence": 0.6}, "transform": {"position": [1.35, -1.78, 1.0], "rotation": [0, 0, 0], "worldPosition": [2.4, 4.08, 3.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "bulb", "materialLayers": ["bulb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.4, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Emissive."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "bulb", "colorMaterialRecipe": {"materialId": "bulb", "dominantAlbedo": "rgba(255, 241, 200, 1.0)", "secondaryAlbedo": "rgba(216, 204, 170, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_bulb_2_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_pendant_bulb_2_15);
  nodes["pendant-bulb-2"] = node_pendant_bulb_2_15;
  const mesh_pendant_bulb_2_15Geometry = endpoint_pendant_bulb_2_15
    ? new THREE.CylinderGeometry(endpoint_pendant_bulb_2_15.endRadius, endpoint_pendant_bulb_2_15.baseRadius, endpoint_pendant_bulb_2_15.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 12, 8);
  if (!endpoint_pendant_bulb_2_15) {
    mesh_pendant_bulb_2_15Geometry.scale(0.22, 0.22, 0.22);
  }
  const mesh_pendant_bulb_2_15 = new THREE.Mesh(
    mesh_pendant_bulb_2_15Geometry,
    materialMap["bulb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pendant_bulb_2_15.name = "Pendant bulb 2";
  if (endpoint_pendant_bulb_2_15) {
    mesh_pendant_bulb_2_15.position.copy(endpoint_pendant_bulb_2_15.midpoint);
    mesh_pendant_bulb_2_15.quaternion.copy(endpoint_pendant_bulb_2_15.quaternion);
  }
  mesh_pendant_bulb_2_15.castShadow = options.castShadow ?? true;
  mesh_pendant_bulb_2_15.receiveShadow = options.receiveShadow ?? true;
  mesh_pendant_bulb_2_15.userData.sculptComponent = {"id": "pendant-bulb-2", "name": "Pendant bulb 2", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "The lit bulb under the shade; a small sphere.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [1.35, -1.89, 1.0], "localEnd": [1.35, -1.67, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.22, "height": 0.22, "depth": 0.22, "units": "m", "confidence": 0.6}, "transform": {"position": [1.35, -1.78, 1.0], "rotation": [0, 0, 0], "worldPosition": [2.4, 4.08, 3.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "bulb", "materialLayers": ["bulb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.4, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Emissive."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "bulb", "colorMaterialRecipe": {"materialId": "bulb", "dominantAlbedo": "rgba(255, 241, 200, 1.0)", "secondaryAlbedo": "rgba(216, 204, 170, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_bulb_2_15.add(mesh_pendant_bulb_2_15);
  meshes["pendant-bulb-2"] = mesh_pendant_bulb_2_15;
  colliders["pendant-bulb-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_pendant_bulb_2_15);

  const attachment_pendant_3_16 = {"parentSocket": "canopy", "localStart": [1.55, -1.76, -0.4], "localEnd": [1.55, -1.36, -0.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.25, "endRadius": 0.25};
  const endpoint_pendant_3_16 = makeAttachmentEndpoint(attachment_pendant_3_16);
  const node_pendant_3_16 = new THREE.Group();
  node_pendant_3_16.name = "Pendant light 3__pivot";
  node_pendant_3_16.scale.set(1, 1, 1);
  if (endpoint_pendant_3_16) {
    node_pendant_3_16.position.copy(endpoint_pendant_3_16.start);
    node_pendant_3_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pendant_3_16.position.set(1.55, -1.56, -0.4);
    node_pendant_3_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_pendant_3_16.userData.sculptComponent = {"id": "pendant-3", "name": "Pendant light 3", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A small round brass shade; a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [1.55, -1.76, -0.4], "localEnd": [1.55, -1.36, -0.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.25, "endRadius": 0.25}, "dimensions": {"width": 0.5, "height": 0.4, "depth": 0.5, "units": "m", "confidence": 0.6, "radius": 0.25}, "transform": {"position": [1.55, -1.56, -0.4], "rotation": [0, 0, 0], "worldPosition": [2.6, 4.3, 1.6]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brass", "materialLayers": ["brass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.25, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "polished brass", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "A faint emissive warmth from the bulb."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "brass", "colorMaterialRecipe": {"materialId": "brass", "dominantAlbedo": "rgba(216, 168, 72, 1.0)", "secondaryAlbedo": "rgba(183, 142, 61, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_3_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_pendant_3_16);
  nodes["pendant-3"] = node_pendant_3_16;
  const mesh_pendant_3_16Geometry = endpoint_pendant_3_16
    ? new THREE.CylinderGeometry(endpoint_pendant_3_16.endRadius, endpoint_pendant_3_16.baseRadius, endpoint_pendant_3_16.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_pendant_3_16) {
    mesh_pendant_3_16Geometry.scale(0.5, 0.4, 0.5);
  }
  const mesh_pendant_3_16 = new THREE.Mesh(
    mesh_pendant_3_16Geometry,
    materialMap["brass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pendant_3_16.name = "Pendant light 3";
  if (endpoint_pendant_3_16) {
    mesh_pendant_3_16.position.copy(endpoint_pendant_3_16.midpoint);
    mesh_pendant_3_16.quaternion.copy(endpoint_pendant_3_16.quaternion);
  }
  mesh_pendant_3_16.castShadow = options.castShadow ?? true;
  mesh_pendant_3_16.receiveShadow = options.receiveShadow ?? true;
  mesh_pendant_3_16.userData.sculptComponent = {"id": "pendant-3", "name": "Pendant light 3", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A small round brass shade; a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [1.55, -1.76, -0.4], "localEnd": [1.55, -1.36, -0.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.25, "endRadius": 0.25}, "dimensions": {"width": 0.5, "height": 0.4, "depth": 0.5, "units": "m", "confidence": 0.6, "radius": 0.25}, "transform": {"position": [1.55, -1.56, -0.4], "rotation": [0, 0, 0], "worldPosition": [2.6, 4.3, 1.6]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brass", "materialLayers": ["brass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.25, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "polished brass", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "A faint emissive warmth from the bulb."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "brass", "colorMaterialRecipe": {"materialId": "brass", "dominantAlbedo": "rgba(216, 168, 72, 1.0)", "secondaryAlbedo": "rgba(183, 142, 61, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_3_16.add(mesh_pendant_3_16);
  meshes["pendant-3"] = mesh_pendant_3_16;
  colliders["pendant-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_pendant_3_16);

  const attachment_pendant_cord_3_17 = {"parentSocket": "canopy", "localStart": [1.55, -1.36, -0.4], "localEnd": [1.55, -1.26, -0.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.015, "endRadius": 0.015};
  const endpoint_pendant_cord_3_17 = makeAttachmentEndpoint(attachment_pendant_cord_3_17);
  const node_pendant_cord_3_17 = new THREE.Group();
  node_pendant_cord_3_17.name = "Pendant cord 3__pivot";
  node_pendant_cord_3_17.scale.set(1, 1, 1);
  if (endpoint_pendant_cord_3_17) {
    node_pendant_cord_3_17.position.copy(endpoint_pendant_cord_3_17.start);
    node_pendant_cord_3_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pendant_cord_3_17.position.set(1.55, -1.31, -0.4);
    node_pendant_cord_3_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_pendant_cord_3_17.userData.sculptComponent = {"id": "pendant-cord-3", "name": "Pendant cord 3", "level": "micro", "role": "detail", "importance": 0.3, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The short drop from the truss to the shade; a thin cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [1.55, -1.36, -0.4], "localEnd": [1.55, -1.26, -0.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.015, "endRadius": 0.015}, "dimensions": {"width": 0.03, "height": 0.1, "depth": 0.03, "units": "m", "confidence": 0.6, "radius": 0.015}, "transform": {"position": [1.55, -1.31, -0.4], "rotation": [0, 0, 0], "worldPosition": [2.6, 4.55, 1.6]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_cord_3_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_pendant_cord_3_17);
  nodes["pendant-cord-3"] = node_pendant_cord_3_17;
  const mesh_pendant_cord_3_17Geometry = endpoint_pendant_cord_3_17
    ? new THREE.CylinderGeometry(endpoint_pendant_cord_3_17.endRadius, endpoint_pendant_cord_3_17.baseRadius, endpoint_pendant_cord_3_17.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_pendant_cord_3_17) {
    mesh_pendant_cord_3_17Geometry.scale(0.03, 0.1, 0.03);
  }
  const mesh_pendant_cord_3_17 = new THREE.Mesh(
    mesh_pendant_cord_3_17Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pendant_cord_3_17.name = "Pendant cord 3";
  if (endpoint_pendant_cord_3_17) {
    mesh_pendant_cord_3_17.position.copy(endpoint_pendant_cord_3_17.midpoint);
    mesh_pendant_cord_3_17.quaternion.copy(endpoint_pendant_cord_3_17.quaternion);
  }
  mesh_pendant_cord_3_17.castShadow = options.castShadow ?? true;
  mesh_pendant_cord_3_17.receiveShadow = options.receiveShadow ?? true;
  mesh_pendant_cord_3_17.userData.sculptComponent = {"id": "pendant-cord-3", "name": "Pendant cord 3", "level": "micro", "role": "detail", "importance": 0.3, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The short drop from the truss to the shade; a thin cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [1.55, -1.36, -0.4], "localEnd": [1.55, -1.26, -0.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.015, "endRadius": 0.015}, "dimensions": {"width": 0.03, "height": 0.1, "depth": 0.03, "units": "m", "confidence": 0.6, "radius": 0.015}, "transform": {"position": [1.55, -1.31, -0.4], "rotation": [0, 0, 0], "worldPosition": [2.6, 4.55, 1.6]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_cord_3_17.add(mesh_pendant_cord_3_17);
  meshes["pendant-cord-3"] = mesh_pendant_cord_3_17;
  colliders["pendant-cord-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_pendant_cord_3_17);

  const endpoint_pendant_bulb_3_18 = makeAttachmentEndpoint(null);
  const node_pendant_bulb_3_18 = new THREE.Group();
  node_pendant_bulb_3_18.name = "Pendant bulb 3__pivot";
  node_pendant_bulb_3_18.scale.set(1, 1, 1);
  if (endpoint_pendant_bulb_3_18) {
    node_pendant_bulb_3_18.position.copy(endpoint_pendant_bulb_3_18.start);
    node_pendant_bulb_3_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pendant_bulb_3_18.position.set(1.55, -1.78, -0.4);
    node_pendant_bulb_3_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_pendant_bulb_3_18.userData.sculptComponent = {"id": "pendant-bulb-3", "name": "Pendant bulb 3", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "The lit bulb under the shade; a small sphere.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [1.55, -1.89, -0.4], "localEnd": [1.55, -1.67, -0.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.22, "height": 0.22, "depth": 0.22, "units": "m", "confidence": 0.6}, "transform": {"position": [1.55, -1.78, -0.4], "rotation": [0, 0, 0], "worldPosition": [2.6, 4.08, 1.6]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "bulb", "materialLayers": ["bulb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.4, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Emissive."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "bulb", "colorMaterialRecipe": {"materialId": "bulb", "dominantAlbedo": "rgba(255, 241, 200, 1.0)", "secondaryAlbedo": "rgba(216, 204, 170, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_bulb_3_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_pendant_bulb_3_18);
  nodes["pendant-bulb-3"] = node_pendant_bulb_3_18;
  const mesh_pendant_bulb_3_18Geometry = endpoint_pendant_bulb_3_18
    ? new THREE.CylinderGeometry(endpoint_pendant_bulb_3_18.endRadius, endpoint_pendant_bulb_3_18.baseRadius, endpoint_pendant_bulb_3_18.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 12, 8);
  if (!endpoint_pendant_bulb_3_18) {
    mesh_pendant_bulb_3_18Geometry.scale(0.22, 0.22, 0.22);
  }
  const mesh_pendant_bulb_3_18 = new THREE.Mesh(
    mesh_pendant_bulb_3_18Geometry,
    materialMap["bulb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pendant_bulb_3_18.name = "Pendant bulb 3";
  if (endpoint_pendant_bulb_3_18) {
    mesh_pendant_bulb_3_18.position.copy(endpoint_pendant_bulb_3_18.midpoint);
    mesh_pendant_bulb_3_18.quaternion.copy(endpoint_pendant_bulb_3_18.quaternion);
  }
  mesh_pendant_bulb_3_18.castShadow = options.castShadow ?? true;
  mesh_pendant_bulb_3_18.receiveShadow = options.receiveShadow ?? true;
  mesh_pendant_bulb_3_18.userData.sculptComponent = {"id": "pendant-bulb-3", "name": "Pendant bulb 3", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "The lit bulb under the shade; a small sphere.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [1.55, -1.89, -0.4], "localEnd": [1.55, -1.67, -0.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.22, "height": 0.22, "depth": 0.22, "units": "m", "confidence": 0.6}, "transform": {"position": [1.55, -1.78, -0.4], "rotation": [0, 0, 0], "worldPosition": [2.6, 4.08, 1.6]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "bulb", "materialLayers": ["bulb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.4, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Emissive."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "bulb", "colorMaterialRecipe": {"materialId": "bulb", "dominantAlbedo": "rgba(255, 241, 200, 1.0)", "secondaryAlbedo": "rgba(216, 204, 170, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_bulb_3_18.add(mesh_pendant_bulb_3_18);
  meshes["pendant-bulb-3"] = mesh_pendant_bulb_3_18;
  colliders["pendant-bulb-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_pendant_bulb_3_18);

  const attachment_pendant_4_19 = {"parentSocket": "canopy", "localStart": [6.35, -1.76, 1.0], "localEnd": [6.35, -1.36, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.25, "endRadius": 0.25};
  const endpoint_pendant_4_19 = makeAttachmentEndpoint(attachment_pendant_4_19);
  const node_pendant_4_19 = new THREE.Group();
  node_pendant_4_19.name = "Pendant light 4__pivot";
  node_pendant_4_19.scale.set(1, 1, 1);
  if (endpoint_pendant_4_19) {
    node_pendant_4_19.position.copy(endpoint_pendant_4_19.start);
    node_pendant_4_19.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pendant_4_19.position.set(6.35, -1.56, 1.0);
    node_pendant_4_19.rotation.set(0.0, 0.0, 0.0);
  }
  node_pendant_4_19.userData.sculptComponent = {"id": "pendant-4", "name": "Pendant light 4", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A small round brass shade; a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [6.35, -1.76, 1.0], "localEnd": [6.35, -1.36, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.25, "endRadius": 0.25}, "dimensions": {"width": 0.5, "height": 0.4, "depth": 0.5, "units": "m", "confidence": 0.6, "radius": 0.25}, "transform": {"position": [6.35, -1.56, 1.0], "rotation": [0, 0, 0], "worldPosition": [7.4, 4.3, 3.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brass", "materialLayers": ["brass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.25, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "polished brass", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "A faint emissive warmth from the bulb."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "brass", "colorMaterialRecipe": {"materialId": "brass", "dominantAlbedo": "rgba(216, 168, 72, 1.0)", "secondaryAlbedo": "rgba(183, 142, 61, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_4_19.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_pendant_4_19);
  nodes["pendant-4"] = node_pendant_4_19;
  const mesh_pendant_4_19Geometry = endpoint_pendant_4_19
    ? new THREE.CylinderGeometry(endpoint_pendant_4_19.endRadius, endpoint_pendant_4_19.baseRadius, endpoint_pendant_4_19.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_pendant_4_19) {
    mesh_pendant_4_19Geometry.scale(0.5, 0.4, 0.5);
  }
  const mesh_pendant_4_19 = new THREE.Mesh(
    mesh_pendant_4_19Geometry,
    materialMap["brass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pendant_4_19.name = "Pendant light 4";
  if (endpoint_pendant_4_19) {
    mesh_pendant_4_19.position.copy(endpoint_pendant_4_19.midpoint);
    mesh_pendant_4_19.quaternion.copy(endpoint_pendant_4_19.quaternion);
  }
  mesh_pendant_4_19.castShadow = options.castShadow ?? true;
  mesh_pendant_4_19.receiveShadow = options.receiveShadow ?? true;
  mesh_pendant_4_19.userData.sculptComponent = {"id": "pendant-4", "name": "Pendant light 4", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A small round brass shade; a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [6.35, -1.76, 1.0], "localEnd": [6.35, -1.36, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.25, "endRadius": 0.25}, "dimensions": {"width": 0.5, "height": 0.4, "depth": 0.5, "units": "m", "confidence": 0.6, "radius": 0.25}, "transform": {"position": [6.35, -1.56, 1.0], "rotation": [0, 0, 0], "worldPosition": [7.4, 4.3, 3.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brass", "materialLayers": ["brass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.25, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "polished brass", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "A faint emissive warmth from the bulb."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "brass", "colorMaterialRecipe": {"materialId": "brass", "dominantAlbedo": "rgba(216, 168, 72, 1.0)", "secondaryAlbedo": "rgba(183, 142, 61, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_4_19.add(mesh_pendant_4_19);
  meshes["pendant-4"] = mesh_pendant_4_19;
  colliders["pendant-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_pendant_4_19);

  const attachment_pendant_cord_4_20 = {"parentSocket": "canopy", "localStart": [6.35, -1.36, 1.0], "localEnd": [6.35, -1.26, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.015, "endRadius": 0.015};
  const endpoint_pendant_cord_4_20 = makeAttachmentEndpoint(attachment_pendant_cord_4_20);
  const node_pendant_cord_4_20 = new THREE.Group();
  node_pendant_cord_4_20.name = "Pendant cord 4__pivot";
  node_pendant_cord_4_20.scale.set(1, 1, 1);
  if (endpoint_pendant_cord_4_20) {
    node_pendant_cord_4_20.position.copy(endpoint_pendant_cord_4_20.start);
    node_pendant_cord_4_20.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pendant_cord_4_20.position.set(6.35, -1.31, 1.0);
    node_pendant_cord_4_20.rotation.set(0.0, 0.0, 0.0);
  }
  node_pendant_cord_4_20.userData.sculptComponent = {"id": "pendant-cord-4", "name": "Pendant cord 4", "level": "micro", "role": "detail", "importance": 0.3, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The short drop from the truss to the shade; a thin cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [6.35, -1.36, 1.0], "localEnd": [6.35, -1.26, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.015, "endRadius": 0.015}, "dimensions": {"width": 0.03, "height": 0.1, "depth": 0.03, "units": "m", "confidence": 0.6, "radius": 0.015}, "transform": {"position": [6.35, -1.31, 1.0], "rotation": [0, 0, 0], "worldPosition": [7.4, 4.55, 3.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_cord_4_20.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_pendant_cord_4_20);
  nodes["pendant-cord-4"] = node_pendant_cord_4_20;
  const mesh_pendant_cord_4_20Geometry = endpoint_pendant_cord_4_20
    ? new THREE.CylinderGeometry(endpoint_pendant_cord_4_20.endRadius, endpoint_pendant_cord_4_20.baseRadius, endpoint_pendant_cord_4_20.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_pendant_cord_4_20) {
    mesh_pendant_cord_4_20Geometry.scale(0.03, 0.1, 0.03);
  }
  const mesh_pendant_cord_4_20 = new THREE.Mesh(
    mesh_pendant_cord_4_20Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pendant_cord_4_20.name = "Pendant cord 4";
  if (endpoint_pendant_cord_4_20) {
    mesh_pendant_cord_4_20.position.copy(endpoint_pendant_cord_4_20.midpoint);
    mesh_pendant_cord_4_20.quaternion.copy(endpoint_pendant_cord_4_20.quaternion);
  }
  mesh_pendant_cord_4_20.castShadow = options.castShadow ?? true;
  mesh_pendant_cord_4_20.receiveShadow = options.receiveShadow ?? true;
  mesh_pendant_cord_4_20.userData.sculptComponent = {"id": "pendant-cord-4", "name": "Pendant cord 4", "level": "micro", "role": "detail", "importance": 0.3, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The short drop from the truss to the shade; a thin cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [6.35, -1.36, 1.0], "localEnd": [6.35, -1.26, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.015, "endRadius": 0.015}, "dimensions": {"width": 0.03, "height": 0.1, "depth": 0.03, "units": "m", "confidence": 0.6, "radius": 0.015}, "transform": {"position": [6.35, -1.31, 1.0], "rotation": [0, 0, 0], "worldPosition": [7.4, 4.55, 3.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_cord_4_20.add(mesh_pendant_cord_4_20);
  meshes["pendant-cord-4"] = mesh_pendant_cord_4_20;
  colliders["pendant-cord-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_pendant_cord_4_20);

  const endpoint_pendant_bulb_4_21 = makeAttachmentEndpoint(null);
  const node_pendant_bulb_4_21 = new THREE.Group();
  node_pendant_bulb_4_21.name = "Pendant bulb 4__pivot";
  node_pendant_bulb_4_21.scale.set(1, 1, 1);
  if (endpoint_pendant_bulb_4_21) {
    node_pendant_bulb_4_21.position.copy(endpoint_pendant_bulb_4_21.start);
    node_pendant_bulb_4_21.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pendant_bulb_4_21.position.set(6.35, -1.78, 1.0);
    node_pendant_bulb_4_21.rotation.set(0.0, 0.0, 0.0);
  }
  node_pendant_bulb_4_21.userData.sculptComponent = {"id": "pendant-bulb-4", "name": "Pendant bulb 4", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "The lit bulb under the shade; a small sphere.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [6.35, -1.89, 1.0], "localEnd": [6.35, -1.67, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.22, "height": 0.22, "depth": 0.22, "units": "m", "confidence": 0.6}, "transform": {"position": [6.35, -1.78, 1.0], "rotation": [0, 0, 0], "worldPosition": [7.4, 4.08, 3.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "bulb", "materialLayers": ["bulb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.4, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Emissive."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "bulb", "colorMaterialRecipe": {"materialId": "bulb", "dominantAlbedo": "rgba(255, 241, 200, 1.0)", "secondaryAlbedo": "rgba(216, 204, 170, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_bulb_4_21.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_pendant_bulb_4_21);
  nodes["pendant-bulb-4"] = node_pendant_bulb_4_21;
  const mesh_pendant_bulb_4_21Geometry = endpoint_pendant_bulb_4_21
    ? new THREE.CylinderGeometry(endpoint_pendant_bulb_4_21.endRadius, endpoint_pendant_bulb_4_21.baseRadius, endpoint_pendant_bulb_4_21.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 12, 8);
  if (!endpoint_pendant_bulb_4_21) {
    mesh_pendant_bulb_4_21Geometry.scale(0.22, 0.22, 0.22);
  }
  const mesh_pendant_bulb_4_21 = new THREE.Mesh(
    mesh_pendant_bulb_4_21Geometry,
    materialMap["bulb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pendant_bulb_4_21.name = "Pendant bulb 4";
  if (endpoint_pendant_bulb_4_21) {
    mesh_pendant_bulb_4_21.position.copy(endpoint_pendant_bulb_4_21.midpoint);
    mesh_pendant_bulb_4_21.quaternion.copy(endpoint_pendant_bulb_4_21.quaternion);
  }
  mesh_pendant_bulb_4_21.castShadow = options.castShadow ?? true;
  mesh_pendant_bulb_4_21.receiveShadow = options.receiveShadow ?? true;
  mesh_pendant_bulb_4_21.userData.sculptComponent = {"id": "pendant-bulb-4", "name": "Pendant bulb 4", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "The lit bulb under the shade; a small sphere.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [6.35, -1.89, 1.0], "localEnd": [6.35, -1.67, 1.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.22, "height": 0.22, "depth": 0.22, "units": "m", "confidence": 0.6}, "transform": {"position": [6.35, -1.78, 1.0], "rotation": [0, 0, 0], "worldPosition": [7.4, 4.08, 3.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "bulb", "materialLayers": ["bulb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.4, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Emissive."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "bulb", "colorMaterialRecipe": {"materialId": "bulb", "dominantAlbedo": "rgba(255, 241, 200, 1.0)", "secondaryAlbedo": "rgba(216, 204, 170, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_pendant_bulb_4_21.add(mesh_pendant_bulb_4_21);
  meshes["pendant-bulb-4"] = mesh_pendant_bulb_4_21;
  colliders["pendant-bulb-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_pendant_bulb_4_21);

  const endpoint_truss_top_f_22 = makeAttachmentEndpoint(null);
  const node_truss_top_f_22 = new THREE.Group();
  node_truss_top_f_22.name = "Truss top chord f__pivot";
  node_truss_top_f_22.scale.set(1, 1, 1);
  if (endpoint_truss_top_f_22) {
    node_truss_top_f_22.position.copy(endpoint_truss_top_f_22.start);
    node_truss_top_f_22.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_truss_top_f_22.position.set(0.0, -0.36, 1.7);
    node_truss_top_f_22.rotation.set(0.0, 0.0, 0.0);
  }
  node_truss_top_f_22.userData.sculptComponent = {"id": "truss-top-f", "name": "Truss top chord f", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel chord; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [0.0, -0.41, 1.7], "localEnd": [0.0, -0.31, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 15.4, "height": 0.1, "depth": 0.1, "units": "m", "confidence": 0.6}, "transform": {"position": [0.0, -0.36, 1.7], "rotation": [0, 0, 0], "worldPosition": [1.05, 5.5, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_top_f_22.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_top_f_22);
  nodes["truss-top-f"] = node_truss_top_f_22;
  const mesh_truss_top_f_22Geometry = endpoint_truss_top_f_22
    ? new THREE.CylinderGeometry(endpoint_truss_top_f_22.endRadius, endpoint_truss_top_f_22.baseRadius, endpoint_truss_top_f_22.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_top_f_22) {
    mesh_truss_top_f_22Geometry.scale(15.4, 0.1, 0.1);
  }
  const mesh_truss_top_f_22 = new THREE.Mesh(
    mesh_truss_top_f_22Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_top_f_22.name = "Truss top chord f";
  if (endpoint_truss_top_f_22) {
    mesh_truss_top_f_22.position.copy(endpoint_truss_top_f_22.midpoint);
    mesh_truss_top_f_22.quaternion.copy(endpoint_truss_top_f_22.quaternion);
  }
  mesh_truss_top_f_22.castShadow = options.castShadow ?? true;
  mesh_truss_top_f_22.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_top_f_22.userData.sculptComponent = {"id": "truss-top-f", "name": "Truss top chord f", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel chord; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [0.0, -0.41, 1.7], "localEnd": [0.0, -0.31, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 15.4, "height": 0.1, "depth": 0.1, "units": "m", "confidence": 0.6}, "transform": {"position": [0.0, -0.36, 1.7], "rotation": [0, 0, 0], "worldPosition": [1.05, 5.5, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_top_f_22.add(mesh_truss_top_f_22);
  meshes["truss-top-f"] = mesh_truss_top_f_22;
  colliders["truss-top-f"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_top_f_22);

  const endpoint_truss_bottom_f_23 = makeAttachmentEndpoint(null);
  const node_truss_bottom_f_23 = new THREE.Group();
  node_truss_bottom_f_23.name = "Truss bottom chord f__pivot";
  node_truss_bottom_f_23.scale.set(1, 1, 1);
  if (endpoint_truss_bottom_f_23) {
    node_truss_bottom_f_23.position.copy(endpoint_truss_bottom_f_23.start);
    node_truss_bottom_f_23.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_truss_bottom_f_23.position.set(0.0, -1.26, 1.7);
    node_truss_bottom_f_23.rotation.set(0.0, 0.0, 0.0);
  }
  node_truss_bottom_f_23.userData.sculptComponent = {"id": "truss-bottom-f", "name": "Truss bottom chord f", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel chord; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [0.0, -1.31, 1.7], "localEnd": [0.0, -1.21, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 15.4, "height": 0.1, "depth": 0.1, "units": "m", "confidence": 0.6}, "transform": {"position": [0.0, -1.26, 1.7], "rotation": [0, 0, 0], "worldPosition": [1.05, 4.6, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_bottom_f_23.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_bottom_f_23);
  nodes["truss-bottom-f"] = node_truss_bottom_f_23;
  const mesh_truss_bottom_f_23Geometry = endpoint_truss_bottom_f_23
    ? new THREE.CylinderGeometry(endpoint_truss_bottom_f_23.endRadius, endpoint_truss_bottom_f_23.baseRadius, endpoint_truss_bottom_f_23.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_bottom_f_23) {
    mesh_truss_bottom_f_23Geometry.scale(15.4, 0.1, 0.1);
  }
  const mesh_truss_bottom_f_23 = new THREE.Mesh(
    mesh_truss_bottom_f_23Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_bottom_f_23.name = "Truss bottom chord f";
  if (endpoint_truss_bottom_f_23) {
    mesh_truss_bottom_f_23.position.copy(endpoint_truss_bottom_f_23.midpoint);
    mesh_truss_bottom_f_23.quaternion.copy(endpoint_truss_bottom_f_23.quaternion);
  }
  mesh_truss_bottom_f_23.castShadow = options.castShadow ?? true;
  mesh_truss_bottom_f_23.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_bottom_f_23.userData.sculptComponent = {"id": "truss-bottom-f", "name": "Truss bottom chord f", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel chord; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [0.0, -1.31, 1.7], "localEnd": [0.0, -1.21, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 15.4, "height": 0.1, "depth": 0.1, "units": "m", "confidence": 0.6}, "transform": {"position": [0.0, -1.26, 1.7], "rotation": [0, 0, 0], "worldPosition": [1.05, 4.6, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_bottom_f_23.add(mesh_truss_bottom_f_23);
  meshes["truss-bottom-f"] = mesh_truss_bottom_f_23;
  colliders["truss-bottom-f"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_bottom_f_23);

  const endpoint_truss_diag_f0_24 = makeAttachmentEndpoint(null);
  const node_truss_diag_f0_24 = new THREE.Group();
  node_truss_diag_f0_24.name = "Truss diagonal f0__pivot";
  node_truss_diag_f0_24.scale.set(1, 1, 1);
  if (endpoint_truss_diag_f0_24) {
    node_truss_diag_f0_24.position.copy(endpoint_truss_diag_f0_24.start);
    node_truss_diag_f0_24.rotation.set(0.0, 0.0, 0.7853981634);
  } else {
    node_truss_diag_f0_24.position.set(-7.175, -0.81, 1.7);
    node_truss_diag_f0_24.rotation.set(0.0, 0.0, 0.7853981634);
  }
  node_truss_diag_f0_24.userData.sculptComponent = {"id": "truss-diag-f0", "name": "Truss diagonal f0", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-7.175, -1.445, 1.7], "localEnd": [-7.175, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-7.175, -0.81, 1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [-6.125, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f0_24.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_f0_24);
  nodes["truss-diag-f0"] = node_truss_diag_f0_24;
  const mesh_truss_diag_f0_24Geometry = endpoint_truss_diag_f0_24
    ? new THREE.CylinderGeometry(endpoint_truss_diag_f0_24.endRadius, endpoint_truss_diag_f0_24.baseRadius, endpoint_truss_diag_f0_24.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_f0_24) {
    mesh_truss_diag_f0_24Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_f0_24 = new THREE.Mesh(
    mesh_truss_diag_f0_24Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_f0_24.name = "Truss diagonal f0";
  if (endpoint_truss_diag_f0_24) {
    mesh_truss_diag_f0_24.position.copy(endpoint_truss_diag_f0_24.midpoint);
    mesh_truss_diag_f0_24.quaternion.copy(endpoint_truss_diag_f0_24.quaternion);
  }
  mesh_truss_diag_f0_24.castShadow = options.castShadow ?? true;
  mesh_truss_diag_f0_24.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_f0_24.userData.sculptComponent = {"id": "truss-diag-f0", "name": "Truss diagonal f0", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-7.175, -1.445, 1.7], "localEnd": [-7.175, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-7.175, -0.81, 1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [-6.125, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f0_24.add(mesh_truss_diag_f0_24);
  meshes["truss-diag-f0"] = mesh_truss_diag_f0_24;
  colliders["truss-diag-f0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_f0_24);

  const endpoint_truss_diag_f1_25 = makeAttachmentEndpoint(null);
  const node_truss_diag_f1_25 = new THREE.Group();
  node_truss_diag_f1_25.name = "Truss diagonal f1__pivot";
  node_truss_diag_f1_25.scale.set(1, 1, 1);
  if (endpoint_truss_diag_f1_25) {
    node_truss_diag_f1_25.position.copy(endpoint_truss_diag_f1_25.start);
    node_truss_diag_f1_25.rotation.set(0.0, 0.0, -0.7853981634);
  } else {
    node_truss_diag_f1_25.position.set(-6.225, -0.81, 1.7);
    node_truss_diag_f1_25.rotation.set(0.0, 0.0, -0.7853981634);
  }
  node_truss_diag_f1_25.userData.sculptComponent = {"id": "truss-diag-f1", "name": "Truss diagonal f1", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-6.225, -1.445, 1.7], "localEnd": [-6.225, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-6.225, -0.81, 1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [-5.175, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f1_25.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_f1_25);
  nodes["truss-diag-f1"] = node_truss_diag_f1_25;
  const mesh_truss_diag_f1_25Geometry = endpoint_truss_diag_f1_25
    ? new THREE.CylinderGeometry(endpoint_truss_diag_f1_25.endRadius, endpoint_truss_diag_f1_25.baseRadius, endpoint_truss_diag_f1_25.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_f1_25) {
    mesh_truss_diag_f1_25Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_f1_25 = new THREE.Mesh(
    mesh_truss_diag_f1_25Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_f1_25.name = "Truss diagonal f1";
  if (endpoint_truss_diag_f1_25) {
    mesh_truss_diag_f1_25.position.copy(endpoint_truss_diag_f1_25.midpoint);
    mesh_truss_diag_f1_25.quaternion.copy(endpoint_truss_diag_f1_25.quaternion);
  }
  mesh_truss_diag_f1_25.castShadow = options.castShadow ?? true;
  mesh_truss_diag_f1_25.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_f1_25.userData.sculptComponent = {"id": "truss-diag-f1", "name": "Truss diagonal f1", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-6.225, -1.445, 1.7], "localEnd": [-6.225, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-6.225, -0.81, 1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [-5.175, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f1_25.add(mesh_truss_diag_f1_25);
  meshes["truss-diag-f1"] = mesh_truss_diag_f1_25;
  colliders["truss-diag-f1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_f1_25);

  const endpoint_truss_diag_f2_26 = makeAttachmentEndpoint(null);
  const node_truss_diag_f2_26 = new THREE.Group();
  node_truss_diag_f2_26.name = "Truss diagonal f2__pivot";
  node_truss_diag_f2_26.scale.set(1, 1, 1);
  if (endpoint_truss_diag_f2_26) {
    node_truss_diag_f2_26.position.copy(endpoint_truss_diag_f2_26.start);
    node_truss_diag_f2_26.rotation.set(0.0, 0.0, 0.7853981634);
  } else {
    node_truss_diag_f2_26.position.set(-5.275, -0.81, 1.7);
    node_truss_diag_f2_26.rotation.set(0.0, 0.0, 0.7853981634);
  }
  node_truss_diag_f2_26.userData.sculptComponent = {"id": "truss-diag-f2", "name": "Truss diagonal f2", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-5.275, -1.445, 1.7], "localEnd": [-5.275, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-5.275, -0.81, 1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [-4.225, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f2_26.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_f2_26);
  nodes["truss-diag-f2"] = node_truss_diag_f2_26;
  const mesh_truss_diag_f2_26Geometry = endpoint_truss_diag_f2_26
    ? new THREE.CylinderGeometry(endpoint_truss_diag_f2_26.endRadius, endpoint_truss_diag_f2_26.baseRadius, endpoint_truss_diag_f2_26.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_f2_26) {
    mesh_truss_diag_f2_26Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_f2_26 = new THREE.Mesh(
    mesh_truss_diag_f2_26Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_f2_26.name = "Truss diagonal f2";
  if (endpoint_truss_diag_f2_26) {
    mesh_truss_diag_f2_26.position.copy(endpoint_truss_diag_f2_26.midpoint);
    mesh_truss_diag_f2_26.quaternion.copy(endpoint_truss_diag_f2_26.quaternion);
  }
  mesh_truss_diag_f2_26.castShadow = options.castShadow ?? true;
  mesh_truss_diag_f2_26.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_f2_26.userData.sculptComponent = {"id": "truss-diag-f2", "name": "Truss diagonal f2", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-5.275, -1.445, 1.7], "localEnd": [-5.275, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-5.275, -0.81, 1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [-4.225, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f2_26.add(mesh_truss_diag_f2_26);
  meshes["truss-diag-f2"] = mesh_truss_diag_f2_26;
  colliders["truss-diag-f2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_f2_26);

  const endpoint_truss_diag_f3_27 = makeAttachmentEndpoint(null);
  const node_truss_diag_f3_27 = new THREE.Group();
  node_truss_diag_f3_27.name = "Truss diagonal f3__pivot";
  node_truss_diag_f3_27.scale.set(1, 1, 1);
  if (endpoint_truss_diag_f3_27) {
    node_truss_diag_f3_27.position.copy(endpoint_truss_diag_f3_27.start);
    node_truss_diag_f3_27.rotation.set(0.0, 0.0, -0.7853981634);
  } else {
    node_truss_diag_f3_27.position.set(-4.325, -0.81, 1.7);
    node_truss_diag_f3_27.rotation.set(0.0, 0.0, -0.7853981634);
  }
  node_truss_diag_f3_27.userData.sculptComponent = {"id": "truss-diag-f3", "name": "Truss diagonal f3", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-4.325, -1.445, 1.7], "localEnd": [-4.325, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-4.325, -0.81, 1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [-3.2750000000000004, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f3_27.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_f3_27);
  nodes["truss-diag-f3"] = node_truss_diag_f3_27;
  const mesh_truss_diag_f3_27Geometry = endpoint_truss_diag_f3_27
    ? new THREE.CylinderGeometry(endpoint_truss_diag_f3_27.endRadius, endpoint_truss_diag_f3_27.baseRadius, endpoint_truss_diag_f3_27.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_f3_27) {
    mesh_truss_diag_f3_27Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_f3_27 = new THREE.Mesh(
    mesh_truss_diag_f3_27Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_f3_27.name = "Truss diagonal f3";
  if (endpoint_truss_diag_f3_27) {
    mesh_truss_diag_f3_27.position.copy(endpoint_truss_diag_f3_27.midpoint);
    mesh_truss_diag_f3_27.quaternion.copy(endpoint_truss_diag_f3_27.quaternion);
  }
  mesh_truss_diag_f3_27.castShadow = options.castShadow ?? true;
  mesh_truss_diag_f3_27.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_f3_27.userData.sculptComponent = {"id": "truss-diag-f3", "name": "Truss diagonal f3", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-4.325, -1.445, 1.7], "localEnd": [-4.325, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-4.325, -0.81, 1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [-3.2750000000000004, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f3_27.add(mesh_truss_diag_f3_27);
  meshes["truss-diag-f3"] = mesh_truss_diag_f3_27;
  colliders["truss-diag-f3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_f3_27);

  const endpoint_truss_diag_f4_28 = makeAttachmentEndpoint(null);
  const node_truss_diag_f4_28 = new THREE.Group();
  node_truss_diag_f4_28.name = "Truss diagonal f4__pivot";
  node_truss_diag_f4_28.scale.set(1, 1, 1);
  if (endpoint_truss_diag_f4_28) {
    node_truss_diag_f4_28.position.copy(endpoint_truss_diag_f4_28.start);
    node_truss_diag_f4_28.rotation.set(0.0, 0.0, 0.7853981634);
  } else {
    node_truss_diag_f4_28.position.set(-3.375, -0.81, 1.7);
    node_truss_diag_f4_28.rotation.set(0.0, 0.0, 0.7853981634);
  }
  node_truss_diag_f4_28.userData.sculptComponent = {"id": "truss-diag-f4", "name": "Truss diagonal f4", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-3.375, -1.445, 1.7], "localEnd": [-3.375, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-3.375, -0.81, 1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [-2.325, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f4_28.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_f4_28);
  nodes["truss-diag-f4"] = node_truss_diag_f4_28;
  const mesh_truss_diag_f4_28Geometry = endpoint_truss_diag_f4_28
    ? new THREE.CylinderGeometry(endpoint_truss_diag_f4_28.endRadius, endpoint_truss_diag_f4_28.baseRadius, endpoint_truss_diag_f4_28.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_f4_28) {
    mesh_truss_diag_f4_28Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_f4_28 = new THREE.Mesh(
    mesh_truss_diag_f4_28Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_f4_28.name = "Truss diagonal f4";
  if (endpoint_truss_diag_f4_28) {
    mesh_truss_diag_f4_28.position.copy(endpoint_truss_diag_f4_28.midpoint);
    mesh_truss_diag_f4_28.quaternion.copy(endpoint_truss_diag_f4_28.quaternion);
  }
  mesh_truss_diag_f4_28.castShadow = options.castShadow ?? true;
  mesh_truss_diag_f4_28.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_f4_28.userData.sculptComponent = {"id": "truss-diag-f4", "name": "Truss diagonal f4", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-3.375, -1.445, 1.7], "localEnd": [-3.375, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-3.375, -0.81, 1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [-2.325, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f4_28.add(mesh_truss_diag_f4_28);
  meshes["truss-diag-f4"] = mesh_truss_diag_f4_28;
  colliders["truss-diag-f4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_f4_28);

  const endpoint_truss_diag_f5_29 = makeAttachmentEndpoint(null);
  const node_truss_diag_f5_29 = new THREE.Group();
  node_truss_diag_f5_29.name = "Truss diagonal f5__pivot";
  node_truss_diag_f5_29.scale.set(1, 1, 1);
  if (endpoint_truss_diag_f5_29) {
    node_truss_diag_f5_29.position.copy(endpoint_truss_diag_f5_29.start);
    node_truss_diag_f5_29.rotation.set(0.0, 0.0, -0.7853981634);
  } else {
    node_truss_diag_f5_29.position.set(-2.425, -0.81, 1.7);
    node_truss_diag_f5_29.rotation.set(0.0, 0.0, -0.7853981634);
  }
  node_truss_diag_f5_29.userData.sculptComponent = {"id": "truss-diag-f5", "name": "Truss diagonal f5", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-2.425, -1.445, 1.7], "localEnd": [-2.425, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-2.425, -0.81, 1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [-1.375, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f5_29.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_f5_29);
  nodes["truss-diag-f5"] = node_truss_diag_f5_29;
  const mesh_truss_diag_f5_29Geometry = endpoint_truss_diag_f5_29
    ? new THREE.CylinderGeometry(endpoint_truss_diag_f5_29.endRadius, endpoint_truss_diag_f5_29.baseRadius, endpoint_truss_diag_f5_29.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_f5_29) {
    mesh_truss_diag_f5_29Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_f5_29 = new THREE.Mesh(
    mesh_truss_diag_f5_29Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_f5_29.name = "Truss diagonal f5";
  if (endpoint_truss_diag_f5_29) {
    mesh_truss_diag_f5_29.position.copy(endpoint_truss_diag_f5_29.midpoint);
    mesh_truss_diag_f5_29.quaternion.copy(endpoint_truss_diag_f5_29.quaternion);
  }
  mesh_truss_diag_f5_29.castShadow = options.castShadow ?? true;
  mesh_truss_diag_f5_29.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_f5_29.userData.sculptComponent = {"id": "truss-diag-f5", "name": "Truss diagonal f5", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-2.425, -1.445, 1.7], "localEnd": [-2.425, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-2.425, -0.81, 1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [-1.375, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f5_29.add(mesh_truss_diag_f5_29);
  meshes["truss-diag-f5"] = mesh_truss_diag_f5_29;
  colliders["truss-diag-f5"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_f5_29);

  const endpoint_truss_diag_f6_30 = makeAttachmentEndpoint(null);
  const node_truss_diag_f6_30 = new THREE.Group();
  node_truss_diag_f6_30.name = "Truss diagonal f6__pivot";
  node_truss_diag_f6_30.scale.set(1, 1, 1);
  if (endpoint_truss_diag_f6_30) {
    node_truss_diag_f6_30.position.copy(endpoint_truss_diag_f6_30.start);
    node_truss_diag_f6_30.rotation.set(0.0, 0.0, 0.7853981634);
  } else {
    node_truss_diag_f6_30.position.set(-1.475, -0.81, 1.7);
    node_truss_diag_f6_30.rotation.set(0.0, 0.0, 0.7853981634);
  }
  node_truss_diag_f6_30.userData.sculptComponent = {"id": "truss-diag-f6", "name": "Truss diagonal f6", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-1.475, -1.445, 1.7], "localEnd": [-1.475, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-1.475, -0.81, 1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [-0.4250000000000007, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f6_30.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_f6_30);
  nodes["truss-diag-f6"] = node_truss_diag_f6_30;
  const mesh_truss_diag_f6_30Geometry = endpoint_truss_diag_f6_30
    ? new THREE.CylinderGeometry(endpoint_truss_diag_f6_30.endRadius, endpoint_truss_diag_f6_30.baseRadius, endpoint_truss_diag_f6_30.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_f6_30) {
    mesh_truss_diag_f6_30Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_f6_30 = new THREE.Mesh(
    mesh_truss_diag_f6_30Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_f6_30.name = "Truss diagonal f6";
  if (endpoint_truss_diag_f6_30) {
    mesh_truss_diag_f6_30.position.copy(endpoint_truss_diag_f6_30.midpoint);
    mesh_truss_diag_f6_30.quaternion.copy(endpoint_truss_diag_f6_30.quaternion);
  }
  mesh_truss_diag_f6_30.castShadow = options.castShadow ?? true;
  mesh_truss_diag_f6_30.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_f6_30.userData.sculptComponent = {"id": "truss-diag-f6", "name": "Truss diagonal f6", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-1.475, -1.445, 1.7], "localEnd": [-1.475, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-1.475, -0.81, 1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [-0.4250000000000007, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f6_30.add(mesh_truss_diag_f6_30);
  meshes["truss-diag-f6"] = mesh_truss_diag_f6_30;
  colliders["truss-diag-f6"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_f6_30);

  const endpoint_truss_diag_f7_31 = makeAttachmentEndpoint(null);
  const node_truss_diag_f7_31 = new THREE.Group();
  node_truss_diag_f7_31.name = "Truss diagonal f7__pivot";
  node_truss_diag_f7_31.scale.set(1, 1, 1);
  if (endpoint_truss_diag_f7_31) {
    node_truss_diag_f7_31.position.copy(endpoint_truss_diag_f7_31.start);
    node_truss_diag_f7_31.rotation.set(0.0, 0.0, -0.7853981634);
  } else {
    node_truss_diag_f7_31.position.set(-0.525, -0.81, 1.7);
    node_truss_diag_f7_31.rotation.set(0.0, 0.0, -0.7853981634);
  }
  node_truss_diag_f7_31.userData.sculptComponent = {"id": "truss-diag-f7", "name": "Truss diagonal f7", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-0.525, -1.445, 1.7], "localEnd": [-0.525, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-0.525, -0.81, 1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [0.5249999999999995, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f7_31.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_f7_31);
  nodes["truss-diag-f7"] = node_truss_diag_f7_31;
  const mesh_truss_diag_f7_31Geometry = endpoint_truss_diag_f7_31
    ? new THREE.CylinderGeometry(endpoint_truss_diag_f7_31.endRadius, endpoint_truss_diag_f7_31.baseRadius, endpoint_truss_diag_f7_31.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_f7_31) {
    mesh_truss_diag_f7_31Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_f7_31 = new THREE.Mesh(
    mesh_truss_diag_f7_31Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_f7_31.name = "Truss diagonal f7";
  if (endpoint_truss_diag_f7_31) {
    mesh_truss_diag_f7_31.position.copy(endpoint_truss_diag_f7_31.midpoint);
    mesh_truss_diag_f7_31.quaternion.copy(endpoint_truss_diag_f7_31.quaternion);
  }
  mesh_truss_diag_f7_31.castShadow = options.castShadow ?? true;
  mesh_truss_diag_f7_31.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_f7_31.userData.sculptComponent = {"id": "truss-diag-f7", "name": "Truss diagonal f7", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-0.525, -1.445, 1.7], "localEnd": [-0.525, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-0.525, -0.81, 1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [0.5249999999999995, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f7_31.add(mesh_truss_diag_f7_31);
  meshes["truss-diag-f7"] = mesh_truss_diag_f7_31;
  colliders["truss-diag-f7"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_f7_31);

  const endpoint_truss_diag_f8_32 = makeAttachmentEndpoint(null);
  const node_truss_diag_f8_32 = new THREE.Group();
  node_truss_diag_f8_32.name = "Truss diagonal f8__pivot";
  node_truss_diag_f8_32.scale.set(1, 1, 1);
  if (endpoint_truss_diag_f8_32) {
    node_truss_diag_f8_32.position.copy(endpoint_truss_diag_f8_32.start);
    node_truss_diag_f8_32.rotation.set(0.0, 0.0, 0.7853981634);
  } else {
    node_truss_diag_f8_32.position.set(0.425, -0.81, 1.7);
    node_truss_diag_f8_32.rotation.set(0.0, 0.0, 0.7853981634);
  }
  node_truss_diag_f8_32.userData.sculptComponent = {"id": "truss-diag-f8", "name": "Truss diagonal f8", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [0.425, -1.445, 1.7], "localEnd": [0.425, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [0.425, -0.81, 1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [1.4749999999999996, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f8_32.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_f8_32);
  nodes["truss-diag-f8"] = node_truss_diag_f8_32;
  const mesh_truss_diag_f8_32Geometry = endpoint_truss_diag_f8_32
    ? new THREE.CylinderGeometry(endpoint_truss_diag_f8_32.endRadius, endpoint_truss_diag_f8_32.baseRadius, endpoint_truss_diag_f8_32.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_f8_32) {
    mesh_truss_diag_f8_32Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_f8_32 = new THREE.Mesh(
    mesh_truss_diag_f8_32Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_f8_32.name = "Truss diagonal f8";
  if (endpoint_truss_diag_f8_32) {
    mesh_truss_diag_f8_32.position.copy(endpoint_truss_diag_f8_32.midpoint);
    mesh_truss_diag_f8_32.quaternion.copy(endpoint_truss_diag_f8_32.quaternion);
  }
  mesh_truss_diag_f8_32.castShadow = options.castShadow ?? true;
  mesh_truss_diag_f8_32.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_f8_32.userData.sculptComponent = {"id": "truss-diag-f8", "name": "Truss diagonal f8", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [0.425, -1.445, 1.7], "localEnd": [0.425, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [0.425, -0.81, 1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [1.4749999999999996, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f8_32.add(mesh_truss_diag_f8_32);
  meshes["truss-diag-f8"] = mesh_truss_diag_f8_32;
  colliders["truss-diag-f8"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_f8_32);

  const endpoint_truss_diag_f9_33 = makeAttachmentEndpoint(null);
  const node_truss_diag_f9_33 = new THREE.Group();
  node_truss_diag_f9_33.name = "Truss diagonal f9__pivot";
  node_truss_diag_f9_33.scale.set(1, 1, 1);
  if (endpoint_truss_diag_f9_33) {
    node_truss_diag_f9_33.position.copy(endpoint_truss_diag_f9_33.start);
    node_truss_diag_f9_33.rotation.set(0.0, 0.0, -0.7853981634);
  } else {
    node_truss_diag_f9_33.position.set(1.375, -0.81, 1.7);
    node_truss_diag_f9_33.rotation.set(0.0, 0.0, -0.7853981634);
  }
  node_truss_diag_f9_33.userData.sculptComponent = {"id": "truss-diag-f9", "name": "Truss diagonal f9", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [1.375, -1.445, 1.7], "localEnd": [1.375, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [1.375, -0.81, 1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [2.424999999999999, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f9_33.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_f9_33);
  nodes["truss-diag-f9"] = node_truss_diag_f9_33;
  const mesh_truss_diag_f9_33Geometry = endpoint_truss_diag_f9_33
    ? new THREE.CylinderGeometry(endpoint_truss_diag_f9_33.endRadius, endpoint_truss_diag_f9_33.baseRadius, endpoint_truss_diag_f9_33.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_f9_33) {
    mesh_truss_diag_f9_33Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_f9_33 = new THREE.Mesh(
    mesh_truss_diag_f9_33Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_f9_33.name = "Truss diagonal f9";
  if (endpoint_truss_diag_f9_33) {
    mesh_truss_diag_f9_33.position.copy(endpoint_truss_diag_f9_33.midpoint);
    mesh_truss_diag_f9_33.quaternion.copy(endpoint_truss_diag_f9_33.quaternion);
  }
  mesh_truss_diag_f9_33.castShadow = options.castShadow ?? true;
  mesh_truss_diag_f9_33.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_f9_33.userData.sculptComponent = {"id": "truss-diag-f9", "name": "Truss diagonal f9", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [1.375, -1.445, 1.7], "localEnd": [1.375, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [1.375, -0.81, 1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [2.424999999999999, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f9_33.add(mesh_truss_diag_f9_33);
  meshes["truss-diag-f9"] = mesh_truss_diag_f9_33;
  colliders["truss-diag-f9"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_f9_33);

  const endpoint_truss_diag_f10_34 = makeAttachmentEndpoint(null);
  const node_truss_diag_f10_34 = new THREE.Group();
  node_truss_diag_f10_34.name = "Truss diagonal f10__pivot";
  node_truss_diag_f10_34.scale.set(1, 1, 1);
  if (endpoint_truss_diag_f10_34) {
    node_truss_diag_f10_34.position.copy(endpoint_truss_diag_f10_34.start);
    node_truss_diag_f10_34.rotation.set(0.0, 0.0, 0.7853981634);
  } else {
    node_truss_diag_f10_34.position.set(2.325, -0.81, 1.7);
    node_truss_diag_f10_34.rotation.set(0.0, 0.0, 0.7853981634);
  }
  node_truss_diag_f10_34.userData.sculptComponent = {"id": "truss-diag-f10", "name": "Truss diagonal f10", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [2.325, -1.445, 1.7], "localEnd": [2.325, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [2.325, -0.81, 1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [3.375, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f10_34.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_f10_34);
  nodes["truss-diag-f10"] = node_truss_diag_f10_34;
  const mesh_truss_diag_f10_34Geometry = endpoint_truss_diag_f10_34
    ? new THREE.CylinderGeometry(endpoint_truss_diag_f10_34.endRadius, endpoint_truss_diag_f10_34.baseRadius, endpoint_truss_diag_f10_34.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_f10_34) {
    mesh_truss_diag_f10_34Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_f10_34 = new THREE.Mesh(
    mesh_truss_diag_f10_34Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_f10_34.name = "Truss diagonal f10";
  if (endpoint_truss_diag_f10_34) {
    mesh_truss_diag_f10_34.position.copy(endpoint_truss_diag_f10_34.midpoint);
    mesh_truss_diag_f10_34.quaternion.copy(endpoint_truss_diag_f10_34.quaternion);
  }
  mesh_truss_diag_f10_34.castShadow = options.castShadow ?? true;
  mesh_truss_diag_f10_34.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_f10_34.userData.sculptComponent = {"id": "truss-diag-f10", "name": "Truss diagonal f10", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [2.325, -1.445, 1.7], "localEnd": [2.325, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [2.325, -0.81, 1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [3.375, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f10_34.add(mesh_truss_diag_f10_34);
  meshes["truss-diag-f10"] = mesh_truss_diag_f10_34;
  colliders["truss-diag-f10"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_f10_34);

  const endpoint_truss_diag_f11_35 = makeAttachmentEndpoint(null);
  const node_truss_diag_f11_35 = new THREE.Group();
  node_truss_diag_f11_35.name = "Truss diagonal f11__pivot";
  node_truss_diag_f11_35.scale.set(1, 1, 1);
  if (endpoint_truss_diag_f11_35) {
    node_truss_diag_f11_35.position.copy(endpoint_truss_diag_f11_35.start);
    node_truss_diag_f11_35.rotation.set(0.0, 0.0, -0.7853981634);
  } else {
    node_truss_diag_f11_35.position.set(3.275, -0.81, 1.7);
    node_truss_diag_f11_35.rotation.set(0.0, 0.0, -0.7853981634);
  }
  node_truss_diag_f11_35.userData.sculptComponent = {"id": "truss-diag-f11", "name": "Truss diagonal f11", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [3.275, -1.445, 1.7], "localEnd": [3.275, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [3.275, -0.81, 1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [4.324999999999999, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f11_35.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_f11_35);
  nodes["truss-diag-f11"] = node_truss_diag_f11_35;
  const mesh_truss_diag_f11_35Geometry = endpoint_truss_diag_f11_35
    ? new THREE.CylinderGeometry(endpoint_truss_diag_f11_35.endRadius, endpoint_truss_diag_f11_35.baseRadius, endpoint_truss_diag_f11_35.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_f11_35) {
    mesh_truss_diag_f11_35Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_f11_35 = new THREE.Mesh(
    mesh_truss_diag_f11_35Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_f11_35.name = "Truss diagonal f11";
  if (endpoint_truss_diag_f11_35) {
    mesh_truss_diag_f11_35.position.copy(endpoint_truss_diag_f11_35.midpoint);
    mesh_truss_diag_f11_35.quaternion.copy(endpoint_truss_diag_f11_35.quaternion);
  }
  mesh_truss_diag_f11_35.castShadow = options.castShadow ?? true;
  mesh_truss_diag_f11_35.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_f11_35.userData.sculptComponent = {"id": "truss-diag-f11", "name": "Truss diagonal f11", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [3.275, -1.445, 1.7], "localEnd": [3.275, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [3.275, -0.81, 1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [4.324999999999999, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f11_35.add(mesh_truss_diag_f11_35);
  meshes["truss-diag-f11"] = mesh_truss_diag_f11_35;
  colliders["truss-diag-f11"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_f11_35);

  const endpoint_truss_diag_f12_36 = makeAttachmentEndpoint(null);
  const node_truss_diag_f12_36 = new THREE.Group();
  node_truss_diag_f12_36.name = "Truss diagonal f12__pivot";
  node_truss_diag_f12_36.scale.set(1, 1, 1);
  if (endpoint_truss_diag_f12_36) {
    node_truss_diag_f12_36.position.copy(endpoint_truss_diag_f12_36.start);
    node_truss_diag_f12_36.rotation.set(0.0, 0.0, 0.7853981634);
  } else {
    node_truss_diag_f12_36.position.set(4.225, -0.81, 1.7);
    node_truss_diag_f12_36.rotation.set(0.0, 0.0, 0.7853981634);
  }
  node_truss_diag_f12_36.userData.sculptComponent = {"id": "truss-diag-f12", "name": "Truss diagonal f12", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [4.225, -1.445, 1.7], "localEnd": [4.225, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [4.225, -0.81, 1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [5.274999999999999, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f12_36.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_f12_36);
  nodes["truss-diag-f12"] = node_truss_diag_f12_36;
  const mesh_truss_diag_f12_36Geometry = endpoint_truss_diag_f12_36
    ? new THREE.CylinderGeometry(endpoint_truss_diag_f12_36.endRadius, endpoint_truss_diag_f12_36.baseRadius, endpoint_truss_diag_f12_36.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_f12_36) {
    mesh_truss_diag_f12_36Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_f12_36 = new THREE.Mesh(
    mesh_truss_diag_f12_36Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_f12_36.name = "Truss diagonal f12";
  if (endpoint_truss_diag_f12_36) {
    mesh_truss_diag_f12_36.position.copy(endpoint_truss_diag_f12_36.midpoint);
    mesh_truss_diag_f12_36.quaternion.copy(endpoint_truss_diag_f12_36.quaternion);
  }
  mesh_truss_diag_f12_36.castShadow = options.castShadow ?? true;
  mesh_truss_diag_f12_36.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_f12_36.userData.sculptComponent = {"id": "truss-diag-f12", "name": "Truss diagonal f12", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [4.225, -1.445, 1.7], "localEnd": [4.225, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [4.225, -0.81, 1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [5.274999999999999, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f12_36.add(mesh_truss_diag_f12_36);
  meshes["truss-diag-f12"] = mesh_truss_diag_f12_36;
  colliders["truss-diag-f12"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_f12_36);

  const endpoint_truss_diag_f13_37 = makeAttachmentEndpoint(null);
  const node_truss_diag_f13_37 = new THREE.Group();
  node_truss_diag_f13_37.name = "Truss diagonal f13__pivot";
  node_truss_diag_f13_37.scale.set(1, 1, 1);
  if (endpoint_truss_diag_f13_37) {
    node_truss_diag_f13_37.position.copy(endpoint_truss_diag_f13_37.start);
    node_truss_diag_f13_37.rotation.set(0.0, 0.0, -0.7853981634);
  } else {
    node_truss_diag_f13_37.position.set(5.175, -0.81, 1.7);
    node_truss_diag_f13_37.rotation.set(0.0, 0.0, -0.7853981634);
  }
  node_truss_diag_f13_37.userData.sculptComponent = {"id": "truss-diag-f13", "name": "Truss diagonal f13", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [5.175, -1.445, 1.7], "localEnd": [5.175, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [5.175, -0.81, 1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [6.225, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f13_37.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_f13_37);
  nodes["truss-diag-f13"] = node_truss_diag_f13_37;
  const mesh_truss_diag_f13_37Geometry = endpoint_truss_diag_f13_37
    ? new THREE.CylinderGeometry(endpoint_truss_diag_f13_37.endRadius, endpoint_truss_diag_f13_37.baseRadius, endpoint_truss_diag_f13_37.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_f13_37) {
    mesh_truss_diag_f13_37Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_f13_37 = new THREE.Mesh(
    mesh_truss_diag_f13_37Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_f13_37.name = "Truss diagonal f13";
  if (endpoint_truss_diag_f13_37) {
    mesh_truss_diag_f13_37.position.copy(endpoint_truss_diag_f13_37.midpoint);
    mesh_truss_diag_f13_37.quaternion.copy(endpoint_truss_diag_f13_37.quaternion);
  }
  mesh_truss_diag_f13_37.castShadow = options.castShadow ?? true;
  mesh_truss_diag_f13_37.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_f13_37.userData.sculptComponent = {"id": "truss-diag-f13", "name": "Truss diagonal f13", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [5.175, -1.445, 1.7], "localEnd": [5.175, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [5.175, -0.81, 1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [6.225, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f13_37.add(mesh_truss_diag_f13_37);
  meshes["truss-diag-f13"] = mesh_truss_diag_f13_37;
  colliders["truss-diag-f13"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_f13_37);

  const endpoint_truss_diag_f14_38 = makeAttachmentEndpoint(null);
  const node_truss_diag_f14_38 = new THREE.Group();
  node_truss_diag_f14_38.name = "Truss diagonal f14__pivot";
  node_truss_diag_f14_38.scale.set(1, 1, 1);
  if (endpoint_truss_diag_f14_38) {
    node_truss_diag_f14_38.position.copy(endpoint_truss_diag_f14_38.start);
    node_truss_diag_f14_38.rotation.set(0.0, 0.0, 0.7853981634);
  } else {
    node_truss_diag_f14_38.position.set(6.125, -0.81, 1.7);
    node_truss_diag_f14_38.rotation.set(0.0, 0.0, 0.7853981634);
  }
  node_truss_diag_f14_38.userData.sculptComponent = {"id": "truss-diag-f14", "name": "Truss diagonal f14", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [6.125, -1.445, 1.7], "localEnd": [6.125, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [6.125, -0.81, 1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [7.174999999999999, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f14_38.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_f14_38);
  nodes["truss-diag-f14"] = node_truss_diag_f14_38;
  const mesh_truss_diag_f14_38Geometry = endpoint_truss_diag_f14_38
    ? new THREE.CylinderGeometry(endpoint_truss_diag_f14_38.endRadius, endpoint_truss_diag_f14_38.baseRadius, endpoint_truss_diag_f14_38.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_f14_38) {
    mesh_truss_diag_f14_38Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_f14_38 = new THREE.Mesh(
    mesh_truss_diag_f14_38Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_f14_38.name = "Truss diagonal f14";
  if (endpoint_truss_diag_f14_38) {
    mesh_truss_diag_f14_38.position.copy(endpoint_truss_diag_f14_38.midpoint);
    mesh_truss_diag_f14_38.quaternion.copy(endpoint_truss_diag_f14_38.quaternion);
  }
  mesh_truss_diag_f14_38.castShadow = options.castShadow ?? true;
  mesh_truss_diag_f14_38.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_f14_38.userData.sculptComponent = {"id": "truss-diag-f14", "name": "Truss diagonal f14", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [6.125, -1.445, 1.7], "localEnd": [6.125, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [6.125, -0.81, 1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [7.174999999999999, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f14_38.add(mesh_truss_diag_f14_38);
  meshes["truss-diag-f14"] = mesh_truss_diag_f14_38;
  colliders["truss-diag-f14"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_f14_38);

  const endpoint_truss_diag_f15_39 = makeAttachmentEndpoint(null);
  const node_truss_diag_f15_39 = new THREE.Group();
  node_truss_diag_f15_39.name = "Truss diagonal f15__pivot";
  node_truss_diag_f15_39.scale.set(1, 1, 1);
  if (endpoint_truss_diag_f15_39) {
    node_truss_diag_f15_39.position.copy(endpoint_truss_diag_f15_39.start);
    node_truss_diag_f15_39.rotation.set(0.0, 0.0, -0.7853981634);
  } else {
    node_truss_diag_f15_39.position.set(7.075, -0.81, 1.7);
    node_truss_diag_f15_39.rotation.set(0.0, 0.0, -0.7853981634);
  }
  node_truss_diag_f15_39.userData.sculptComponent = {"id": "truss-diag-f15", "name": "Truss diagonal f15", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [7.075, -1.445, 1.7], "localEnd": [7.075, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [7.075, -0.81, 1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [8.125, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f15_39.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_f15_39);
  nodes["truss-diag-f15"] = node_truss_diag_f15_39;
  const mesh_truss_diag_f15_39Geometry = endpoint_truss_diag_f15_39
    ? new THREE.CylinderGeometry(endpoint_truss_diag_f15_39.endRadius, endpoint_truss_diag_f15_39.baseRadius, endpoint_truss_diag_f15_39.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_f15_39) {
    mesh_truss_diag_f15_39Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_f15_39 = new THREE.Mesh(
    mesh_truss_diag_f15_39Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_f15_39.name = "Truss diagonal f15";
  if (endpoint_truss_diag_f15_39) {
    mesh_truss_diag_f15_39.position.copy(endpoint_truss_diag_f15_39.midpoint);
    mesh_truss_diag_f15_39.quaternion.copy(endpoint_truss_diag_f15_39.quaternion);
  }
  mesh_truss_diag_f15_39.castShadow = options.castShadow ?? true;
  mesh_truss_diag_f15_39.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_f15_39.userData.sculptComponent = {"id": "truss-diag-f15", "name": "Truss diagonal f15", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [7.075, -1.445, 1.7], "localEnd": [7.075, -0.175, 1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [7.075, -0.81, 1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [8.125, 5.05, 3.7]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_f15_39.add(mesh_truss_diag_f15_39);
  meshes["truss-diag-f15"] = mesh_truss_diag_f15_39;
  colliders["truss-diag-f15"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_f15_39);

  const endpoint_truss_top_b_40 = makeAttachmentEndpoint(null);
  const node_truss_top_b_40 = new THREE.Group();
  node_truss_top_b_40.name = "Truss top chord b__pivot";
  node_truss_top_b_40.scale.set(1, 1, 1);
  if (endpoint_truss_top_b_40) {
    node_truss_top_b_40.position.copy(endpoint_truss_top_b_40.start);
    node_truss_top_b_40.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_truss_top_b_40.position.set(0.0, -0.36, -1.7);
    node_truss_top_b_40.rotation.set(0.0, 0.0, 0.0);
  }
  node_truss_top_b_40.userData.sculptComponent = {"id": "truss-top-b", "name": "Truss top chord b", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel chord; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [0.0, -0.41, -1.7], "localEnd": [0.0, -0.31, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 15.4, "height": 0.1, "depth": 0.1, "units": "m", "confidence": 0.6}, "transform": {"position": [0.0, -0.36, -1.7], "rotation": [0, 0, 0], "worldPosition": [1.05, 5.5, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_top_b_40.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_top_b_40);
  nodes["truss-top-b"] = node_truss_top_b_40;
  const mesh_truss_top_b_40Geometry = endpoint_truss_top_b_40
    ? new THREE.CylinderGeometry(endpoint_truss_top_b_40.endRadius, endpoint_truss_top_b_40.baseRadius, endpoint_truss_top_b_40.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_top_b_40) {
    mesh_truss_top_b_40Geometry.scale(15.4, 0.1, 0.1);
  }
  const mesh_truss_top_b_40 = new THREE.Mesh(
    mesh_truss_top_b_40Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_top_b_40.name = "Truss top chord b";
  if (endpoint_truss_top_b_40) {
    mesh_truss_top_b_40.position.copy(endpoint_truss_top_b_40.midpoint);
    mesh_truss_top_b_40.quaternion.copy(endpoint_truss_top_b_40.quaternion);
  }
  mesh_truss_top_b_40.castShadow = options.castShadow ?? true;
  mesh_truss_top_b_40.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_top_b_40.userData.sculptComponent = {"id": "truss-top-b", "name": "Truss top chord b", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel chord; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [0.0, -0.41, -1.7], "localEnd": [0.0, -0.31, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 15.4, "height": 0.1, "depth": 0.1, "units": "m", "confidence": 0.6}, "transform": {"position": [0.0, -0.36, -1.7], "rotation": [0, 0, 0], "worldPosition": [1.05, 5.5, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_top_b_40.add(mesh_truss_top_b_40);
  meshes["truss-top-b"] = mesh_truss_top_b_40;
  colliders["truss-top-b"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_top_b_40);

  const endpoint_truss_bottom_b_41 = makeAttachmentEndpoint(null);
  const node_truss_bottom_b_41 = new THREE.Group();
  node_truss_bottom_b_41.name = "Truss bottom chord b__pivot";
  node_truss_bottom_b_41.scale.set(1, 1, 1);
  if (endpoint_truss_bottom_b_41) {
    node_truss_bottom_b_41.position.copy(endpoint_truss_bottom_b_41.start);
    node_truss_bottom_b_41.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_truss_bottom_b_41.position.set(0.0, -1.26, -1.7);
    node_truss_bottom_b_41.rotation.set(0.0, 0.0, 0.0);
  }
  node_truss_bottom_b_41.userData.sculptComponent = {"id": "truss-bottom-b", "name": "Truss bottom chord b", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel chord; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [0.0, -1.31, -1.7], "localEnd": [0.0, -1.21, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 15.4, "height": 0.1, "depth": 0.1, "units": "m", "confidence": 0.6}, "transform": {"position": [0.0, -1.26, -1.7], "rotation": [0, 0, 0], "worldPosition": [1.05, 4.6, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_bottom_b_41.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_bottom_b_41);
  nodes["truss-bottom-b"] = node_truss_bottom_b_41;
  const mesh_truss_bottom_b_41Geometry = endpoint_truss_bottom_b_41
    ? new THREE.CylinderGeometry(endpoint_truss_bottom_b_41.endRadius, endpoint_truss_bottom_b_41.baseRadius, endpoint_truss_bottom_b_41.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_bottom_b_41) {
    mesh_truss_bottom_b_41Geometry.scale(15.4, 0.1, 0.1);
  }
  const mesh_truss_bottom_b_41 = new THREE.Mesh(
    mesh_truss_bottom_b_41Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_bottom_b_41.name = "Truss bottom chord b";
  if (endpoint_truss_bottom_b_41) {
    mesh_truss_bottom_b_41.position.copy(endpoint_truss_bottom_b_41.midpoint);
    mesh_truss_bottom_b_41.quaternion.copy(endpoint_truss_bottom_b_41.quaternion);
  }
  mesh_truss_bottom_b_41.castShadow = options.castShadow ?? true;
  mesh_truss_bottom_b_41.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_bottom_b_41.userData.sculptComponent = {"id": "truss-bottom-b", "name": "Truss bottom chord b", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel chord; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [0.0, -1.31, -1.7], "localEnd": [0.0, -1.21, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 15.4, "height": 0.1, "depth": 0.1, "units": "m", "confidence": 0.6}, "transform": {"position": [0.0, -1.26, -1.7], "rotation": [0, 0, 0], "worldPosition": [1.05, 4.6, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_bottom_b_41.add(mesh_truss_bottom_b_41);
  meshes["truss-bottom-b"] = mesh_truss_bottom_b_41;
  colliders["truss-bottom-b"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_bottom_b_41);

  const endpoint_truss_diag_b0_42 = makeAttachmentEndpoint(null);
  const node_truss_diag_b0_42 = new THREE.Group();
  node_truss_diag_b0_42.name = "Truss diagonal b0__pivot";
  node_truss_diag_b0_42.scale.set(1, 1, 1);
  if (endpoint_truss_diag_b0_42) {
    node_truss_diag_b0_42.position.copy(endpoint_truss_diag_b0_42.start);
    node_truss_diag_b0_42.rotation.set(0.0, 0.0, 0.7853981634);
  } else {
    node_truss_diag_b0_42.position.set(-7.175, -0.81, -1.7);
    node_truss_diag_b0_42.rotation.set(0.0, 0.0, 0.7853981634);
  }
  node_truss_diag_b0_42.userData.sculptComponent = {"id": "truss-diag-b0", "name": "Truss diagonal b0", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-7.175, -1.445, -1.7], "localEnd": [-7.175, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-7.175, -0.81, -1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [-6.125, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b0_42.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_b0_42);
  nodes["truss-diag-b0"] = node_truss_diag_b0_42;
  const mesh_truss_diag_b0_42Geometry = endpoint_truss_diag_b0_42
    ? new THREE.CylinderGeometry(endpoint_truss_diag_b0_42.endRadius, endpoint_truss_diag_b0_42.baseRadius, endpoint_truss_diag_b0_42.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_b0_42) {
    mesh_truss_diag_b0_42Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_b0_42 = new THREE.Mesh(
    mesh_truss_diag_b0_42Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_b0_42.name = "Truss diagonal b0";
  if (endpoint_truss_diag_b0_42) {
    mesh_truss_diag_b0_42.position.copy(endpoint_truss_diag_b0_42.midpoint);
    mesh_truss_diag_b0_42.quaternion.copy(endpoint_truss_diag_b0_42.quaternion);
  }
  mesh_truss_diag_b0_42.castShadow = options.castShadow ?? true;
  mesh_truss_diag_b0_42.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_b0_42.userData.sculptComponent = {"id": "truss-diag-b0", "name": "Truss diagonal b0", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-7.175, -1.445, -1.7], "localEnd": [-7.175, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-7.175, -0.81, -1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [-6.125, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b0_42.add(mesh_truss_diag_b0_42);
  meshes["truss-diag-b0"] = mesh_truss_diag_b0_42;
  colliders["truss-diag-b0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_b0_42);

  const endpoint_truss_diag_b1_43 = makeAttachmentEndpoint(null);
  const node_truss_diag_b1_43 = new THREE.Group();
  node_truss_diag_b1_43.name = "Truss diagonal b1__pivot";
  node_truss_diag_b1_43.scale.set(1, 1, 1);
  if (endpoint_truss_diag_b1_43) {
    node_truss_diag_b1_43.position.copy(endpoint_truss_diag_b1_43.start);
    node_truss_diag_b1_43.rotation.set(0.0, 0.0, -0.7853981634);
  } else {
    node_truss_diag_b1_43.position.set(-6.225, -0.81, -1.7);
    node_truss_diag_b1_43.rotation.set(0.0, 0.0, -0.7853981634);
  }
  node_truss_diag_b1_43.userData.sculptComponent = {"id": "truss-diag-b1", "name": "Truss diagonal b1", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-6.225, -1.445, -1.7], "localEnd": [-6.225, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-6.225, -0.81, -1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [-5.175, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b1_43.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_b1_43);
  nodes["truss-diag-b1"] = node_truss_diag_b1_43;
  const mesh_truss_diag_b1_43Geometry = endpoint_truss_diag_b1_43
    ? new THREE.CylinderGeometry(endpoint_truss_diag_b1_43.endRadius, endpoint_truss_diag_b1_43.baseRadius, endpoint_truss_diag_b1_43.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_b1_43) {
    mesh_truss_diag_b1_43Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_b1_43 = new THREE.Mesh(
    mesh_truss_diag_b1_43Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_b1_43.name = "Truss diagonal b1";
  if (endpoint_truss_diag_b1_43) {
    mesh_truss_diag_b1_43.position.copy(endpoint_truss_diag_b1_43.midpoint);
    mesh_truss_diag_b1_43.quaternion.copy(endpoint_truss_diag_b1_43.quaternion);
  }
  mesh_truss_diag_b1_43.castShadow = options.castShadow ?? true;
  mesh_truss_diag_b1_43.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_b1_43.userData.sculptComponent = {"id": "truss-diag-b1", "name": "Truss diagonal b1", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-6.225, -1.445, -1.7], "localEnd": [-6.225, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-6.225, -0.81, -1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [-5.175, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b1_43.add(mesh_truss_diag_b1_43);
  meshes["truss-diag-b1"] = mesh_truss_diag_b1_43;
  colliders["truss-diag-b1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_b1_43);

  const endpoint_truss_diag_b2_44 = makeAttachmentEndpoint(null);
  const node_truss_diag_b2_44 = new THREE.Group();
  node_truss_diag_b2_44.name = "Truss diagonal b2__pivot";
  node_truss_diag_b2_44.scale.set(1, 1, 1);
  if (endpoint_truss_diag_b2_44) {
    node_truss_diag_b2_44.position.copy(endpoint_truss_diag_b2_44.start);
    node_truss_diag_b2_44.rotation.set(0.0, 0.0, 0.7853981634);
  } else {
    node_truss_diag_b2_44.position.set(-5.275, -0.81, -1.7);
    node_truss_diag_b2_44.rotation.set(0.0, 0.0, 0.7853981634);
  }
  node_truss_diag_b2_44.userData.sculptComponent = {"id": "truss-diag-b2", "name": "Truss diagonal b2", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-5.275, -1.445, -1.7], "localEnd": [-5.275, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-5.275, -0.81, -1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [-4.225, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b2_44.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_b2_44);
  nodes["truss-diag-b2"] = node_truss_diag_b2_44;
  const mesh_truss_diag_b2_44Geometry = endpoint_truss_diag_b2_44
    ? new THREE.CylinderGeometry(endpoint_truss_diag_b2_44.endRadius, endpoint_truss_diag_b2_44.baseRadius, endpoint_truss_diag_b2_44.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_b2_44) {
    mesh_truss_diag_b2_44Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_b2_44 = new THREE.Mesh(
    mesh_truss_diag_b2_44Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_b2_44.name = "Truss diagonal b2";
  if (endpoint_truss_diag_b2_44) {
    mesh_truss_diag_b2_44.position.copy(endpoint_truss_diag_b2_44.midpoint);
    mesh_truss_diag_b2_44.quaternion.copy(endpoint_truss_diag_b2_44.quaternion);
  }
  mesh_truss_diag_b2_44.castShadow = options.castShadow ?? true;
  mesh_truss_diag_b2_44.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_b2_44.userData.sculptComponent = {"id": "truss-diag-b2", "name": "Truss diagonal b2", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-5.275, -1.445, -1.7], "localEnd": [-5.275, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-5.275, -0.81, -1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [-4.225, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b2_44.add(mesh_truss_diag_b2_44);
  meshes["truss-diag-b2"] = mesh_truss_diag_b2_44;
  colliders["truss-diag-b2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_b2_44);

  const endpoint_truss_diag_b3_45 = makeAttachmentEndpoint(null);
  const node_truss_diag_b3_45 = new THREE.Group();
  node_truss_diag_b3_45.name = "Truss diagonal b3__pivot";
  node_truss_diag_b3_45.scale.set(1, 1, 1);
  if (endpoint_truss_diag_b3_45) {
    node_truss_diag_b3_45.position.copy(endpoint_truss_diag_b3_45.start);
    node_truss_diag_b3_45.rotation.set(0.0, 0.0, -0.7853981634);
  } else {
    node_truss_diag_b3_45.position.set(-4.325, -0.81, -1.7);
    node_truss_diag_b3_45.rotation.set(0.0, 0.0, -0.7853981634);
  }
  node_truss_diag_b3_45.userData.sculptComponent = {"id": "truss-diag-b3", "name": "Truss diagonal b3", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-4.325, -1.445, -1.7], "localEnd": [-4.325, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-4.325, -0.81, -1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [-3.2750000000000004, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b3_45.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_b3_45);
  nodes["truss-diag-b3"] = node_truss_diag_b3_45;
  const mesh_truss_diag_b3_45Geometry = endpoint_truss_diag_b3_45
    ? new THREE.CylinderGeometry(endpoint_truss_diag_b3_45.endRadius, endpoint_truss_diag_b3_45.baseRadius, endpoint_truss_diag_b3_45.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_b3_45) {
    mesh_truss_diag_b3_45Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_b3_45 = new THREE.Mesh(
    mesh_truss_diag_b3_45Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_b3_45.name = "Truss diagonal b3";
  if (endpoint_truss_diag_b3_45) {
    mesh_truss_diag_b3_45.position.copy(endpoint_truss_diag_b3_45.midpoint);
    mesh_truss_diag_b3_45.quaternion.copy(endpoint_truss_diag_b3_45.quaternion);
  }
  mesh_truss_diag_b3_45.castShadow = options.castShadow ?? true;
  mesh_truss_diag_b3_45.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_b3_45.userData.sculptComponent = {"id": "truss-diag-b3", "name": "Truss diagonal b3", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-4.325, -1.445, -1.7], "localEnd": [-4.325, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-4.325, -0.81, -1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [-3.2750000000000004, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b3_45.add(mesh_truss_diag_b3_45);
  meshes["truss-diag-b3"] = mesh_truss_diag_b3_45;
  colliders["truss-diag-b3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_b3_45);

  const endpoint_truss_diag_b4_46 = makeAttachmentEndpoint(null);
  const node_truss_diag_b4_46 = new THREE.Group();
  node_truss_diag_b4_46.name = "Truss diagonal b4__pivot";
  node_truss_diag_b4_46.scale.set(1, 1, 1);
  if (endpoint_truss_diag_b4_46) {
    node_truss_diag_b4_46.position.copy(endpoint_truss_diag_b4_46.start);
    node_truss_diag_b4_46.rotation.set(0.0, 0.0, 0.7853981634);
  } else {
    node_truss_diag_b4_46.position.set(-3.375, -0.81, -1.7);
    node_truss_diag_b4_46.rotation.set(0.0, 0.0, 0.7853981634);
  }
  node_truss_diag_b4_46.userData.sculptComponent = {"id": "truss-diag-b4", "name": "Truss diagonal b4", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-3.375, -1.445, -1.7], "localEnd": [-3.375, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-3.375, -0.81, -1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [-2.325, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b4_46.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_b4_46);
  nodes["truss-diag-b4"] = node_truss_diag_b4_46;
  const mesh_truss_diag_b4_46Geometry = endpoint_truss_diag_b4_46
    ? new THREE.CylinderGeometry(endpoint_truss_diag_b4_46.endRadius, endpoint_truss_diag_b4_46.baseRadius, endpoint_truss_diag_b4_46.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_b4_46) {
    mesh_truss_diag_b4_46Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_b4_46 = new THREE.Mesh(
    mesh_truss_diag_b4_46Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_b4_46.name = "Truss diagonal b4";
  if (endpoint_truss_diag_b4_46) {
    mesh_truss_diag_b4_46.position.copy(endpoint_truss_diag_b4_46.midpoint);
    mesh_truss_diag_b4_46.quaternion.copy(endpoint_truss_diag_b4_46.quaternion);
  }
  mesh_truss_diag_b4_46.castShadow = options.castShadow ?? true;
  mesh_truss_diag_b4_46.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_b4_46.userData.sculptComponent = {"id": "truss-diag-b4", "name": "Truss diagonal b4", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-3.375, -1.445, -1.7], "localEnd": [-3.375, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-3.375, -0.81, -1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [-2.325, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b4_46.add(mesh_truss_diag_b4_46);
  meshes["truss-diag-b4"] = mesh_truss_diag_b4_46;
  colliders["truss-diag-b4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_b4_46);

  const endpoint_truss_diag_b5_47 = makeAttachmentEndpoint(null);
  const node_truss_diag_b5_47 = new THREE.Group();
  node_truss_diag_b5_47.name = "Truss diagonal b5__pivot";
  node_truss_diag_b5_47.scale.set(1, 1, 1);
  if (endpoint_truss_diag_b5_47) {
    node_truss_diag_b5_47.position.copy(endpoint_truss_diag_b5_47.start);
    node_truss_diag_b5_47.rotation.set(0.0, 0.0, -0.7853981634);
  } else {
    node_truss_diag_b5_47.position.set(-2.425, -0.81, -1.7);
    node_truss_diag_b5_47.rotation.set(0.0, 0.0, -0.7853981634);
  }
  node_truss_diag_b5_47.userData.sculptComponent = {"id": "truss-diag-b5", "name": "Truss diagonal b5", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-2.425, -1.445, -1.7], "localEnd": [-2.425, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-2.425, -0.81, -1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [-1.375, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b5_47.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_b5_47);
  nodes["truss-diag-b5"] = node_truss_diag_b5_47;
  const mesh_truss_diag_b5_47Geometry = endpoint_truss_diag_b5_47
    ? new THREE.CylinderGeometry(endpoint_truss_diag_b5_47.endRadius, endpoint_truss_diag_b5_47.baseRadius, endpoint_truss_diag_b5_47.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_b5_47) {
    mesh_truss_diag_b5_47Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_b5_47 = new THREE.Mesh(
    mesh_truss_diag_b5_47Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_b5_47.name = "Truss diagonal b5";
  if (endpoint_truss_diag_b5_47) {
    mesh_truss_diag_b5_47.position.copy(endpoint_truss_diag_b5_47.midpoint);
    mesh_truss_diag_b5_47.quaternion.copy(endpoint_truss_diag_b5_47.quaternion);
  }
  mesh_truss_diag_b5_47.castShadow = options.castShadow ?? true;
  mesh_truss_diag_b5_47.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_b5_47.userData.sculptComponent = {"id": "truss-diag-b5", "name": "Truss diagonal b5", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-2.425, -1.445, -1.7], "localEnd": [-2.425, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-2.425, -0.81, -1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [-1.375, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b5_47.add(mesh_truss_diag_b5_47);
  meshes["truss-diag-b5"] = mesh_truss_diag_b5_47;
  colliders["truss-diag-b5"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_b5_47);

  const endpoint_truss_diag_b6_48 = makeAttachmentEndpoint(null);
  const node_truss_diag_b6_48 = new THREE.Group();
  node_truss_diag_b6_48.name = "Truss diagonal b6__pivot";
  node_truss_diag_b6_48.scale.set(1, 1, 1);
  if (endpoint_truss_diag_b6_48) {
    node_truss_diag_b6_48.position.copy(endpoint_truss_diag_b6_48.start);
    node_truss_diag_b6_48.rotation.set(0.0, 0.0, 0.7853981634);
  } else {
    node_truss_diag_b6_48.position.set(-1.475, -0.81, -1.7);
    node_truss_diag_b6_48.rotation.set(0.0, 0.0, 0.7853981634);
  }
  node_truss_diag_b6_48.userData.sculptComponent = {"id": "truss-diag-b6", "name": "Truss diagonal b6", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-1.475, -1.445, -1.7], "localEnd": [-1.475, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-1.475, -0.81, -1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [-0.4250000000000007, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b6_48.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_b6_48);
  nodes["truss-diag-b6"] = node_truss_diag_b6_48;
  const mesh_truss_diag_b6_48Geometry = endpoint_truss_diag_b6_48
    ? new THREE.CylinderGeometry(endpoint_truss_diag_b6_48.endRadius, endpoint_truss_diag_b6_48.baseRadius, endpoint_truss_diag_b6_48.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_b6_48) {
    mesh_truss_diag_b6_48Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_b6_48 = new THREE.Mesh(
    mesh_truss_diag_b6_48Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_b6_48.name = "Truss diagonal b6";
  if (endpoint_truss_diag_b6_48) {
    mesh_truss_diag_b6_48.position.copy(endpoint_truss_diag_b6_48.midpoint);
    mesh_truss_diag_b6_48.quaternion.copy(endpoint_truss_diag_b6_48.quaternion);
  }
  mesh_truss_diag_b6_48.castShadow = options.castShadow ?? true;
  mesh_truss_diag_b6_48.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_b6_48.userData.sculptComponent = {"id": "truss-diag-b6", "name": "Truss diagonal b6", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-1.475, -1.445, -1.7], "localEnd": [-1.475, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-1.475, -0.81, -1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [-0.4250000000000007, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b6_48.add(mesh_truss_diag_b6_48);
  meshes["truss-diag-b6"] = mesh_truss_diag_b6_48;
  colliders["truss-diag-b6"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_b6_48);

  const endpoint_truss_diag_b7_49 = makeAttachmentEndpoint(null);
  const node_truss_diag_b7_49 = new THREE.Group();
  node_truss_diag_b7_49.name = "Truss diagonal b7__pivot";
  node_truss_diag_b7_49.scale.set(1, 1, 1);
  if (endpoint_truss_diag_b7_49) {
    node_truss_diag_b7_49.position.copy(endpoint_truss_diag_b7_49.start);
    node_truss_diag_b7_49.rotation.set(0.0, 0.0, -0.7853981634);
  } else {
    node_truss_diag_b7_49.position.set(-0.525, -0.81, -1.7);
    node_truss_diag_b7_49.rotation.set(0.0, 0.0, -0.7853981634);
  }
  node_truss_diag_b7_49.userData.sculptComponent = {"id": "truss-diag-b7", "name": "Truss diagonal b7", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-0.525, -1.445, -1.7], "localEnd": [-0.525, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-0.525, -0.81, -1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [0.5249999999999995, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b7_49.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_b7_49);
  nodes["truss-diag-b7"] = node_truss_diag_b7_49;
  const mesh_truss_diag_b7_49Geometry = endpoint_truss_diag_b7_49
    ? new THREE.CylinderGeometry(endpoint_truss_diag_b7_49.endRadius, endpoint_truss_diag_b7_49.baseRadius, endpoint_truss_diag_b7_49.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_b7_49) {
    mesh_truss_diag_b7_49Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_b7_49 = new THREE.Mesh(
    mesh_truss_diag_b7_49Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_b7_49.name = "Truss diagonal b7";
  if (endpoint_truss_diag_b7_49) {
    mesh_truss_diag_b7_49.position.copy(endpoint_truss_diag_b7_49.midpoint);
    mesh_truss_diag_b7_49.quaternion.copy(endpoint_truss_diag_b7_49.quaternion);
  }
  mesh_truss_diag_b7_49.castShadow = options.castShadow ?? true;
  mesh_truss_diag_b7_49.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_b7_49.userData.sculptComponent = {"id": "truss-diag-b7", "name": "Truss diagonal b7", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [-0.525, -1.445, -1.7], "localEnd": [-0.525, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [-0.525, -0.81, -1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [0.5249999999999995, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b7_49.add(mesh_truss_diag_b7_49);
  meshes["truss-diag-b7"] = mesh_truss_diag_b7_49;
  colliders["truss-diag-b7"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_b7_49);

  const endpoint_truss_diag_b8_50 = makeAttachmentEndpoint(null);
  const node_truss_diag_b8_50 = new THREE.Group();
  node_truss_diag_b8_50.name = "Truss diagonal b8__pivot";
  node_truss_diag_b8_50.scale.set(1, 1, 1);
  if (endpoint_truss_diag_b8_50) {
    node_truss_diag_b8_50.position.copy(endpoint_truss_diag_b8_50.start);
    node_truss_diag_b8_50.rotation.set(0.0, 0.0, 0.7853981634);
  } else {
    node_truss_diag_b8_50.position.set(0.425, -0.81, -1.7);
    node_truss_diag_b8_50.rotation.set(0.0, 0.0, 0.7853981634);
  }
  node_truss_diag_b8_50.userData.sculptComponent = {"id": "truss-diag-b8", "name": "Truss diagonal b8", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [0.425, -1.445, -1.7], "localEnd": [0.425, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [0.425, -0.81, -1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [1.4749999999999996, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b8_50.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_b8_50);
  nodes["truss-diag-b8"] = node_truss_diag_b8_50;
  const mesh_truss_diag_b8_50Geometry = endpoint_truss_diag_b8_50
    ? new THREE.CylinderGeometry(endpoint_truss_diag_b8_50.endRadius, endpoint_truss_diag_b8_50.baseRadius, endpoint_truss_diag_b8_50.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_b8_50) {
    mesh_truss_diag_b8_50Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_b8_50 = new THREE.Mesh(
    mesh_truss_diag_b8_50Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_b8_50.name = "Truss diagonal b8";
  if (endpoint_truss_diag_b8_50) {
    mesh_truss_diag_b8_50.position.copy(endpoint_truss_diag_b8_50.midpoint);
    mesh_truss_diag_b8_50.quaternion.copy(endpoint_truss_diag_b8_50.quaternion);
  }
  mesh_truss_diag_b8_50.castShadow = options.castShadow ?? true;
  mesh_truss_diag_b8_50.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_b8_50.userData.sculptComponent = {"id": "truss-diag-b8", "name": "Truss diagonal b8", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [0.425, -1.445, -1.7], "localEnd": [0.425, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [0.425, -0.81, -1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [1.4749999999999996, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b8_50.add(mesh_truss_diag_b8_50);
  meshes["truss-diag-b8"] = mesh_truss_diag_b8_50;
  colliders["truss-diag-b8"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_b8_50);

  const endpoint_truss_diag_b9_51 = makeAttachmentEndpoint(null);
  const node_truss_diag_b9_51 = new THREE.Group();
  node_truss_diag_b9_51.name = "Truss diagonal b9__pivot";
  node_truss_diag_b9_51.scale.set(1, 1, 1);
  if (endpoint_truss_diag_b9_51) {
    node_truss_diag_b9_51.position.copy(endpoint_truss_diag_b9_51.start);
    node_truss_diag_b9_51.rotation.set(0.0, 0.0, -0.7853981634);
  } else {
    node_truss_diag_b9_51.position.set(1.375, -0.81, -1.7);
    node_truss_diag_b9_51.rotation.set(0.0, 0.0, -0.7853981634);
  }
  node_truss_diag_b9_51.userData.sculptComponent = {"id": "truss-diag-b9", "name": "Truss diagonal b9", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [1.375, -1.445, -1.7], "localEnd": [1.375, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [1.375, -0.81, -1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [2.424999999999999, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b9_51.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_b9_51);
  nodes["truss-diag-b9"] = node_truss_diag_b9_51;
  const mesh_truss_diag_b9_51Geometry = endpoint_truss_diag_b9_51
    ? new THREE.CylinderGeometry(endpoint_truss_diag_b9_51.endRadius, endpoint_truss_diag_b9_51.baseRadius, endpoint_truss_diag_b9_51.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_b9_51) {
    mesh_truss_diag_b9_51Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_b9_51 = new THREE.Mesh(
    mesh_truss_diag_b9_51Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_b9_51.name = "Truss diagonal b9";
  if (endpoint_truss_diag_b9_51) {
    mesh_truss_diag_b9_51.position.copy(endpoint_truss_diag_b9_51.midpoint);
    mesh_truss_diag_b9_51.quaternion.copy(endpoint_truss_diag_b9_51.quaternion);
  }
  mesh_truss_diag_b9_51.castShadow = options.castShadow ?? true;
  mesh_truss_diag_b9_51.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_b9_51.userData.sculptComponent = {"id": "truss-diag-b9", "name": "Truss diagonal b9", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [1.375, -1.445, -1.7], "localEnd": [1.375, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [1.375, -0.81, -1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [2.424999999999999, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b9_51.add(mesh_truss_diag_b9_51);
  meshes["truss-diag-b9"] = mesh_truss_diag_b9_51;
  colliders["truss-diag-b9"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_b9_51);

  const endpoint_truss_diag_b10_52 = makeAttachmentEndpoint(null);
  const node_truss_diag_b10_52 = new THREE.Group();
  node_truss_diag_b10_52.name = "Truss diagonal b10__pivot";
  node_truss_diag_b10_52.scale.set(1, 1, 1);
  if (endpoint_truss_diag_b10_52) {
    node_truss_diag_b10_52.position.copy(endpoint_truss_diag_b10_52.start);
    node_truss_diag_b10_52.rotation.set(0.0, 0.0, 0.7853981634);
  } else {
    node_truss_diag_b10_52.position.set(2.325, -0.81, -1.7);
    node_truss_diag_b10_52.rotation.set(0.0, 0.0, 0.7853981634);
  }
  node_truss_diag_b10_52.userData.sculptComponent = {"id": "truss-diag-b10", "name": "Truss diagonal b10", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [2.325, -1.445, -1.7], "localEnd": [2.325, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [2.325, -0.81, -1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [3.375, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b10_52.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_b10_52);
  nodes["truss-diag-b10"] = node_truss_diag_b10_52;
  const mesh_truss_diag_b10_52Geometry = endpoint_truss_diag_b10_52
    ? new THREE.CylinderGeometry(endpoint_truss_diag_b10_52.endRadius, endpoint_truss_diag_b10_52.baseRadius, endpoint_truss_diag_b10_52.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_b10_52) {
    mesh_truss_diag_b10_52Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_b10_52 = new THREE.Mesh(
    mesh_truss_diag_b10_52Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_b10_52.name = "Truss diagonal b10";
  if (endpoint_truss_diag_b10_52) {
    mesh_truss_diag_b10_52.position.copy(endpoint_truss_diag_b10_52.midpoint);
    mesh_truss_diag_b10_52.quaternion.copy(endpoint_truss_diag_b10_52.quaternion);
  }
  mesh_truss_diag_b10_52.castShadow = options.castShadow ?? true;
  mesh_truss_diag_b10_52.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_b10_52.userData.sculptComponent = {"id": "truss-diag-b10", "name": "Truss diagonal b10", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [2.325, -1.445, -1.7], "localEnd": [2.325, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [2.325, -0.81, -1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [3.375, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b10_52.add(mesh_truss_diag_b10_52);
  meshes["truss-diag-b10"] = mesh_truss_diag_b10_52;
  colliders["truss-diag-b10"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_b10_52);

  const endpoint_truss_diag_b11_53 = makeAttachmentEndpoint(null);
  const node_truss_diag_b11_53 = new THREE.Group();
  node_truss_diag_b11_53.name = "Truss diagonal b11__pivot";
  node_truss_diag_b11_53.scale.set(1, 1, 1);
  if (endpoint_truss_diag_b11_53) {
    node_truss_diag_b11_53.position.copy(endpoint_truss_diag_b11_53.start);
    node_truss_diag_b11_53.rotation.set(0.0, 0.0, -0.7853981634);
  } else {
    node_truss_diag_b11_53.position.set(3.275, -0.81, -1.7);
    node_truss_diag_b11_53.rotation.set(0.0, 0.0, -0.7853981634);
  }
  node_truss_diag_b11_53.userData.sculptComponent = {"id": "truss-diag-b11", "name": "Truss diagonal b11", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [3.275, -1.445, -1.7], "localEnd": [3.275, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [3.275, -0.81, -1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [4.324999999999999, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b11_53.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_b11_53);
  nodes["truss-diag-b11"] = node_truss_diag_b11_53;
  const mesh_truss_diag_b11_53Geometry = endpoint_truss_diag_b11_53
    ? new THREE.CylinderGeometry(endpoint_truss_diag_b11_53.endRadius, endpoint_truss_diag_b11_53.baseRadius, endpoint_truss_diag_b11_53.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_b11_53) {
    mesh_truss_diag_b11_53Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_b11_53 = new THREE.Mesh(
    mesh_truss_diag_b11_53Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_b11_53.name = "Truss diagonal b11";
  if (endpoint_truss_diag_b11_53) {
    mesh_truss_diag_b11_53.position.copy(endpoint_truss_diag_b11_53.midpoint);
    mesh_truss_diag_b11_53.quaternion.copy(endpoint_truss_diag_b11_53.quaternion);
  }
  mesh_truss_diag_b11_53.castShadow = options.castShadow ?? true;
  mesh_truss_diag_b11_53.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_b11_53.userData.sculptComponent = {"id": "truss-diag-b11", "name": "Truss diagonal b11", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [3.275, -1.445, -1.7], "localEnd": [3.275, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [3.275, -0.81, -1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [4.324999999999999, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b11_53.add(mesh_truss_diag_b11_53);
  meshes["truss-diag-b11"] = mesh_truss_diag_b11_53;
  colliders["truss-diag-b11"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_b11_53);

  const endpoint_truss_diag_b12_54 = makeAttachmentEndpoint(null);
  const node_truss_diag_b12_54 = new THREE.Group();
  node_truss_diag_b12_54.name = "Truss diagonal b12__pivot";
  node_truss_diag_b12_54.scale.set(1, 1, 1);
  if (endpoint_truss_diag_b12_54) {
    node_truss_diag_b12_54.position.copy(endpoint_truss_diag_b12_54.start);
    node_truss_diag_b12_54.rotation.set(0.0, 0.0, 0.7853981634);
  } else {
    node_truss_diag_b12_54.position.set(4.225, -0.81, -1.7);
    node_truss_diag_b12_54.rotation.set(0.0, 0.0, 0.7853981634);
  }
  node_truss_diag_b12_54.userData.sculptComponent = {"id": "truss-diag-b12", "name": "Truss diagonal b12", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [4.225, -1.445, -1.7], "localEnd": [4.225, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [4.225, -0.81, -1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [5.274999999999999, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b12_54.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_b12_54);
  nodes["truss-diag-b12"] = node_truss_diag_b12_54;
  const mesh_truss_diag_b12_54Geometry = endpoint_truss_diag_b12_54
    ? new THREE.CylinderGeometry(endpoint_truss_diag_b12_54.endRadius, endpoint_truss_diag_b12_54.baseRadius, endpoint_truss_diag_b12_54.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_b12_54) {
    mesh_truss_diag_b12_54Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_b12_54 = new THREE.Mesh(
    mesh_truss_diag_b12_54Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_b12_54.name = "Truss diagonal b12";
  if (endpoint_truss_diag_b12_54) {
    mesh_truss_diag_b12_54.position.copy(endpoint_truss_diag_b12_54.midpoint);
    mesh_truss_diag_b12_54.quaternion.copy(endpoint_truss_diag_b12_54.quaternion);
  }
  mesh_truss_diag_b12_54.castShadow = options.castShadow ?? true;
  mesh_truss_diag_b12_54.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_b12_54.userData.sculptComponent = {"id": "truss-diag-b12", "name": "Truss diagonal b12", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [4.225, -1.445, -1.7], "localEnd": [4.225, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [4.225, -0.81, -1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [5.274999999999999, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b12_54.add(mesh_truss_diag_b12_54);
  meshes["truss-diag-b12"] = mesh_truss_diag_b12_54;
  colliders["truss-diag-b12"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_b12_54);

  const endpoint_truss_diag_b13_55 = makeAttachmentEndpoint(null);
  const node_truss_diag_b13_55 = new THREE.Group();
  node_truss_diag_b13_55.name = "Truss diagonal b13__pivot";
  node_truss_diag_b13_55.scale.set(1, 1, 1);
  if (endpoint_truss_diag_b13_55) {
    node_truss_diag_b13_55.position.copy(endpoint_truss_diag_b13_55.start);
    node_truss_diag_b13_55.rotation.set(0.0, 0.0, -0.7853981634);
  } else {
    node_truss_diag_b13_55.position.set(5.175, -0.81, -1.7);
    node_truss_diag_b13_55.rotation.set(0.0, 0.0, -0.7853981634);
  }
  node_truss_diag_b13_55.userData.sculptComponent = {"id": "truss-diag-b13", "name": "Truss diagonal b13", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [5.175, -1.445, -1.7], "localEnd": [5.175, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [5.175, -0.81, -1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [6.225, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b13_55.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_b13_55);
  nodes["truss-diag-b13"] = node_truss_diag_b13_55;
  const mesh_truss_diag_b13_55Geometry = endpoint_truss_diag_b13_55
    ? new THREE.CylinderGeometry(endpoint_truss_diag_b13_55.endRadius, endpoint_truss_diag_b13_55.baseRadius, endpoint_truss_diag_b13_55.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_b13_55) {
    mesh_truss_diag_b13_55Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_b13_55 = new THREE.Mesh(
    mesh_truss_diag_b13_55Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_b13_55.name = "Truss diagonal b13";
  if (endpoint_truss_diag_b13_55) {
    mesh_truss_diag_b13_55.position.copy(endpoint_truss_diag_b13_55.midpoint);
    mesh_truss_diag_b13_55.quaternion.copy(endpoint_truss_diag_b13_55.quaternion);
  }
  mesh_truss_diag_b13_55.castShadow = options.castShadow ?? true;
  mesh_truss_diag_b13_55.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_b13_55.userData.sculptComponent = {"id": "truss-diag-b13", "name": "Truss diagonal b13", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [5.175, -1.445, -1.7], "localEnd": [5.175, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [5.175, -0.81, -1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [6.225, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b13_55.add(mesh_truss_diag_b13_55);
  meshes["truss-diag-b13"] = mesh_truss_diag_b13_55;
  colliders["truss-diag-b13"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_b13_55);

  const endpoint_truss_diag_b14_56 = makeAttachmentEndpoint(null);
  const node_truss_diag_b14_56 = new THREE.Group();
  node_truss_diag_b14_56.name = "Truss diagonal b14__pivot";
  node_truss_diag_b14_56.scale.set(1, 1, 1);
  if (endpoint_truss_diag_b14_56) {
    node_truss_diag_b14_56.position.copy(endpoint_truss_diag_b14_56.start);
    node_truss_diag_b14_56.rotation.set(0.0, 0.0, 0.7853981634);
  } else {
    node_truss_diag_b14_56.position.set(6.125, -0.81, -1.7);
    node_truss_diag_b14_56.rotation.set(0.0, 0.0, 0.7853981634);
  }
  node_truss_diag_b14_56.userData.sculptComponent = {"id": "truss-diag-b14", "name": "Truss diagonal b14", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [6.125, -1.445, -1.7], "localEnd": [6.125, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [6.125, -0.81, -1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [7.174999999999999, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b14_56.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_b14_56);
  nodes["truss-diag-b14"] = node_truss_diag_b14_56;
  const mesh_truss_diag_b14_56Geometry = endpoint_truss_diag_b14_56
    ? new THREE.CylinderGeometry(endpoint_truss_diag_b14_56.endRadius, endpoint_truss_diag_b14_56.baseRadius, endpoint_truss_diag_b14_56.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_b14_56) {
    mesh_truss_diag_b14_56Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_b14_56 = new THREE.Mesh(
    mesh_truss_diag_b14_56Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_b14_56.name = "Truss diagonal b14";
  if (endpoint_truss_diag_b14_56) {
    mesh_truss_diag_b14_56.position.copy(endpoint_truss_diag_b14_56.midpoint);
    mesh_truss_diag_b14_56.quaternion.copy(endpoint_truss_diag_b14_56.quaternion);
  }
  mesh_truss_diag_b14_56.castShadow = options.castShadow ?? true;
  mesh_truss_diag_b14_56.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_b14_56.userData.sculptComponent = {"id": "truss-diag-b14", "name": "Truss diagonal b14", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [6.125, -1.445, -1.7], "localEnd": [6.125, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [6.125, -0.81, -1.7], "rotation": [0, 0, 0.7853981634], "worldPosition": [7.174999999999999, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b14_56.add(mesh_truss_diag_b14_56);
  meshes["truss-diag-b14"] = mesh_truss_diag_b14_56;
  colliders["truss-diag-b14"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_b14_56);

  const endpoint_truss_diag_b15_57 = makeAttachmentEndpoint(null);
  const node_truss_diag_b15_57 = new THREE.Group();
  node_truss_diag_b15_57.name = "Truss diagonal b15__pivot";
  node_truss_diag_b15_57.scale.set(1, 1, 1);
  if (endpoint_truss_diag_b15_57) {
    node_truss_diag_b15_57.position.copy(endpoint_truss_diag_b15_57.start);
    node_truss_diag_b15_57.rotation.set(0.0, 0.0, -0.7853981634);
  } else {
    node_truss_diag_b15_57.position.set(7.075, -0.81, -1.7);
    node_truss_diag_b15_57.rotation.set(0.0, 0.0, -0.7853981634);
  }
  node_truss_diag_b15_57.userData.sculptComponent = {"id": "truss-diag-b15", "name": "Truss diagonal b15", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [7.075, -1.445, -1.7], "localEnd": [7.075, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [7.075, -0.81, -1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [8.125, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b15_57.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["canopy"] ?? root).add(node_truss_diag_b15_57);
  nodes["truss-diag-b15"] = node_truss_diag_b15_57;
  const mesh_truss_diag_b15_57Geometry = endpoint_truss_diag_b15_57
    ? new THREE.CylinderGeometry(endpoint_truss_diag_b15_57.endRadius, endpoint_truss_diag_b15_57.baseRadius, endpoint_truss_diag_b15_57.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_truss_diag_b15_57) {
    mesh_truss_diag_b15_57Geometry.scale(0.07, 1.27, 0.07);
  }
  const mesh_truss_diag_b15_57 = new THREE.Mesh(
    mesh_truss_diag_b15_57Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_truss_diag_b15_57.name = "Truss diagonal b15";
  if (endpoint_truss_diag_b15_57) {
    mesh_truss_diag_b15_57.position.copy(endpoint_truss_diag_b15_57.midpoint);
    mesh_truss_diag_b15_57.quaternion.copy(endpoint_truss_diag_b15_57.quaternion);
  }
  mesh_truss_diag_b15_57.castShadow = options.castShadow ?? true;
  mesh_truss_diag_b15_57.receiveShadow = options.receiveShadow ?? true;
  mesh_truss_diag_b15_57.userData.sculptComponent = {"id": "truss-diag-b15", "name": "Truss diagonal b15", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A steel diagonal of the truss web, turned 45 degrees in the plane of the truss; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-14.06, 5.5], [10.32, 5.5], [10.32, 10.18], [-0.34, 6.88], [-8.6, 9.8], [-8.6, 8.28], [-14.06, 5.99]], "depth": 50}, "boxSegments": 1}, "parent": "canopy", "attachment": {"parentSocket": "canopy", "localStart": [7.075, -1.445, -1.7], "localEnd": [7.075, -0.175, -1.7], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.07, "height": 1.27, "depth": 0.07, "units": "m", "confidence": 0.6}, "transform": {"position": [7.075, -0.81, -1.7], "rotation": [0, 0, -0.7853981634], "worldPosition": [8.125, 5.05, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "painted steel", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "steel", "colorMaterialRecipe": {"materialId": "steel", "dominantAlbedo": "rgba(30, 32, 35, 1.0)", "secondaryAlbedo": "rgba(25, 27, 29, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "profileUnits": "m (dimensions are 1 so the profile is not scaled)", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "metal"}, "materialRegions": [{"regionId": "metal", "materialId": "metal", "profileId": "metal.aluminum", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/krog-street-market/material-evidence/00-metal.png", "bbox": {"x": 913, "y": 1134, "width": 340, "height": 140}, "sourceWidth": 4032, "sourceHeight": 3024, "loaderWarnings": [], "coverage": 0.0039}}]};
  node_truss_diag_b15_57.add(mesh_truss_diag_b15_57);
  meshes["truss-diag-b15"] = mesh_truss_diag_b15_57;
  colliders["truss-diag-b15"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_truss_diag_b15_57);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createKrogStreetMarketLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Krog Street Market look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"role": "key", "type": "directional", "color": "#FFE7C4", "intensity": 1.5, "direction": [0.5, 0.8, 0.3], "notes": "The game sun"}, {"role": "fill", "type": "hemisphere", "skyColor": "#CFE8FF", "groundColor": "#5A6A48", "intensity": 0.7}, {"role": "environment", "type": "none", "notes": "The photo is at dusk; the game shows the landmark by day, so the lighting follows the game."}, {"role": "exposure", "type": "tone-mapping", "notes": "Exposure 1.0 and the game's default tone mapping (none, sRGB output). Ground shadow: the game has no shadow map on this level; the roof below gets no contact shadow from the tower (accepted for the frame rate gate)."}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createKrogStreetMarketEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameKrogStreetMarketCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createKrogStreetMarketPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureKrogStreetMarketRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createKrogStreetMarketInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
