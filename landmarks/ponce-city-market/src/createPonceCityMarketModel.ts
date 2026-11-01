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

// Generated from ObjectSculptSpec target: Ponce City Market
// Sculpt build pass: material-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createPonceCityMarketModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Ponce City Market";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {"schemaVersion": 1, "status": "proceed", "registry": "/Users/william-meroxa/.img2threejs/releases/a669e9a97cea4452b1c2310c5cca6aa0f6657c1f/img2threejs/docs/materials/material-reference.json", "analysisArtifact": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-analysis.json", "targetThreshold": 0.7, "unresolvedNotObservedMaterials": [], "regions": [{"componentId": "tower-shaft", "regionId": "brick", "specMaterialId": "brick", "profileId": "stone.natural", "status": "proceed"}, {"componentId": "tower-cornice", "regionId": "trim", "specMaterialId": "trim", "profileId": "stone.natural", "status": "proceed"}, {"componentId": "hip-roof", "regionId": "copper", "specMaterialId": "copper-patina", "profileId": "metal.copper", "status": "proceed"}, {"componentId": "sign-letters", "regionId": "sign", "specMaterialId": "sign-yellow", "profileId": "coating.painted-metal", "status": "proceed"}, {"componentId": "sign-frame", "regionId": "steel", "specMaterialId": "steel", "profileId": "coating.painted-metal", "status": "proceed"}], "controlledViewsRequired": ["albedo-unlit", "environment-reflection", "grazing", "neutral-studio", "reference-beauty"]};
  root.userData.materialReferenceRegistry = "/Users/william-meroxa/.img2threejs/releases/a669e9a97cea4452b1c2310c5cca6aa0f6657c1f/img2threejs/docs/materials/material-reference.json";

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["brick"] = createSculptMaterial(
    "brick",
    {"id": "brick", "name": "Red brick", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#7E3B33", "color": "#7E3B33", "albedo": {"dominant": "#9A4A36", "secondary": ["#9A4A36"], "samplingNotes": "Flat game color (vertex color); de-lit by eye from the dusk photo."}, "colorVariation": {"palette": ["#9A4A36"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.78, "map": "material-evidence/brick/brick_roughness.png", "notes": "Evidence map from extract_pbr_evidence.py; the game uses the base value only (toon shading)."}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "band-joint-ao", "type": "ambient-occlusion", "region": "the brick just under each stone band", "amount": 0.25, "notes": "In the game this is a darker vertex-color row."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "finishClass": "worn-composite", "texturePalette": ["#73686A", "#726668", "#695C5E", "#6A5B5E", "#6C5A5D"], "proceduralTexture": "mottle", "clearcoat": {"base": 0.0, "variation": 0.0}, "clearcoatRoughness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0, "variation": 0.0}, "ior": {"base": 1.5, "value": 1.5}, "envMapIntensity": 0.5, "referenceMaterialId": "stone.natural", "materialFamily": "stone", "materialSubtype": "natural", "materialFinish": "rough-or-polished", "materialReference": {"registry": "/Users/william-meroxa/.img2threejs/releases/a669e9a97cea4452b1c2310c5cca6aa0f6657c1f/img2threejs/docs/materials/material-reference.json", "profileId": "stone.natural", "method": "family-subtype-finish", "confidence": 0.86, "sourceRefs": ["three.mesh-standard", "three.mesh-physical", "adobe.pbr-guide-1", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap", "normalMap"], "optionalMaps": ["aoMap", "displacementMap", "clearcoatMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing", "reference-beauty"]}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-00-brick/brick_albedo.png", "url": "brick_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-00-brick/brick_roughness.png", "url": "brick_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-00-brick/brick_height.png", "url": "brick_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-00-brick/brick_normal.png", "url": "brick_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-00-brick/brick_ao.png", "url": "brick_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 300, "sourceHeight": 220, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 300, "height": 220}, "mask": {"backgroundColor": "#605055", "backgroundNoise": 18.493, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.6712}, "mapStats": {"valueRange": 0.4752, "heightP90Gradient": 0.15156, "roughnessBase": 0.805, "roughnessVariation": 0.18, "normalStrength": 0.334, "blurRadius": 10}, "palette": ["#5E4C4D", "#8C8385", "#7C6B69", "#362A2C", "#AFA297"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "textureAnalysis": {"finishClass": "worn-composite", "recipe": {"metalness": 0.0, "roughness": 0.9, "clearcoat": 0.0, "clearcoatRoughness": 0.0, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 0.5, "anisotropy": 0.0, "procedural": "mottle"}, "palette": ["#72686A", "#726668", "#695C5E", "#695B5E", "#6C5A5D"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 100.4, "meanSaturation": 0.149, "gradientStrength": 0.153, "mottle": 0.069, "streakRatio": 0.89, "hueSpread": 0.079, "specularFraction": 0.001}}, "materialEvidence": {"componentId": "tower-shaft", "regionId": "brick", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}, "observations": ["near-neutral colour response", "visible meso/micro variation", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "tower-shaft", "regionId": "brick", "materialId": null, "family": "stone", "subtype": "natural", "finish": "rough-or-polished", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}},
    options
  );
  materialMap["trim"] = createSculptMaterial(
    "trim",
    {"id": "trim", "name": "Cornice stone", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#DCD6CA", "color": "#DCD6CA", "albedo": {"dominant": "#D9D2C4", "secondary": ["#D9D2C4"], "samplingNotes": "Flat game color (vertex color); de-lit by eye from the dusk photo."}, "colorVariation": {"palette": ["#D9D2C4"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.78, "map": "material-evidence/trim/trim_roughness.png", "notes": "Evidence map from extract_pbr_evidence.py; the game uses the base value only (toon shading)."}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "finishClass": "brushed-steel", "texturePalette": ["#B3C1C9", "#B4C0C8", "#8E989F", "#7E858B", "#6B7176"], "proceduralTexture": "brushed", "clearcoat": {"base": 0.0, "variation": 0.0}, "clearcoatRoughness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0, "variation": 0.0}, "ior": {"base": 1.5, "value": 1.5}, "envMapIntensity": 1.0, "anisotropy": {"base": 1.0}, "referenceMaterialId": "stone.natural", "materialFamily": "stone", "materialSubtype": "natural", "materialFinish": "rough-or-polished", "materialReference": {"registry": "/Users/william-meroxa/.img2threejs/releases/a669e9a97cea4452b1c2310c5cca6aa0f6657c1f/img2threejs/docs/materials/material-reference.json", "profileId": "stone.natural", "method": "family-subtype-finish", "confidence": 0.788, "sourceRefs": ["three.mesh-standard", "three.mesh-physical", "adobe.pbr-guide-1", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap", "normalMap"], "optionalMaps": ["aoMap", "displacementMap", "clearcoatMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing", "reference-beauty"]}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/01-trim.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.788, "estimatedFidelity": 0.788, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-01-trim/trim_albedo.png", "url": "trim_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-01-trim/trim_roughness.png", "url": "trim_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-01-trim/trim_height.png", "url": "trim_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-01-trim/trim_normal.png", "url": "trim_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-01-trim/trim_ao.png", "url": "trim_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 120, "sourceHeight": 10, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 120, "height": 10}, "mask": {"backgroundColor": "#8A939A", "backgroundNoise": 84.499, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.455, "heightP90Gradient": 0.05039, "roughnessBase": 0.729, "roughnessVariation": 0.096, "normalStrength": 0.215, "blurRadius": 10}, "palette": ["#96A0A7", "#696E73", "#848D93", "#C7D5DC", "#ABB7BF"]}, "warnings": ["foreground mask is tiny; material extraction is likely unreliable", "image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "textureAnalysis": {"finishClass": "brushed-steel", "recipe": {"metalness": 1.0, "roughness": 0.35, "clearcoat": 0.0, "clearcoatRoughness": 0.0, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 1.0, "procedural": "brushed"}, "palette": ["#B2C1C9", "#B4C0C8", "#8E989F", "#7E858B", "#6B7176"], "paletteHueRisk": [], "gradientAxis": "vertical", "stats": {"meanLum": 156.7, "meanSaturation": 0.098, "gradientStrength": 0.355, "mottle": 0.033, "streakRatio": 2.82, "hueSpread": 0.0, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "tower-cornice", "regionId": "trim", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/01-trim.png", "bbox": {"x": 2350, "y": 623, "width": 120, "height": 10}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0001}, "observations": ["near-neutral colour response", "directional surface frequency", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "tower-cornice", "regionId": "trim", "materialId": null, "family": "stone", "subtype": "natural", "finish": "rough-or-polished", "aliases": [], "confidence": 0.788, "source": "vision"}, "alternatives": []}},
    options
  );
  materialMap["copper-patina"] = createSculptMaterial(
    "copper-patina",
    {"id": "copper-patina", "name": "Patinated copper", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#6E9C98", "color": "#6E9C98", "albedo": {"dominant": "#5FA391", "secondary": ["#5FA391"], "samplingNotes": "Flat game color (vertex color); de-lit by eye from the dusk photo."}, "colorVariation": {"palette": ["#5FA391"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.28, "map": "material-evidence/copper-patina/copper-patina_roughness.png", "notes": "Evidence map from extract_pbr_evidence.py; the game uses the base value only (toon shading)."}, "metalness": {"base": 1.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "finishClass": "painted-metal", "texturePalette": ["#5D6772", "#778890", "#82939A", "#6B828D", "#4A4A55"], "proceduralTexture": "flat-clearcoat", "clearcoat": {"base": 1.0, "variation": 0.0}, "clearcoatRoughness": {"base": 0.05, "variation": 0.0}, "transmission": {"base": 0.0, "variation": 0.0}, "ior": {"base": 1.5, "value": 1.5}, "envMapIntensity": 1.0, "referenceMaterialId": "metal.copper", "materialFamily": "metal", "materialSubtype": "copper", "materialFinish": "polished-or-aged", "materialReference": {"registry": "/Users/william-meroxa/.img2threejs/releases/a669e9a97cea4452b1c2310c5cca6aa0f6657c1f/img2threejs/docs/materials/material-reference.json", "profileId": "metal.copper", "method": "family-subtype-finish", "confidence": 0.86, "sourceRefs": ["three.mesh-standard", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-2", "google.filament-pbr"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "metalnessMap", "aoMap"], "validationViews": ["albedo-unlit", "environment-reflection", "grazing", "reference-beauty"]}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/02-copper.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-02-copper/copper-patina_albedo.png", "url": "copper-patina_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-02-copper/copper-patina_roughness.png", "url": "copper-patina_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-02-copper/copper-patina_height.png", "url": "copper-patina_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-02-copper/copper-patina_normal.png", "url": "copper-patina_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-02-copper/copper-patina_ao.png", "url": "copper-patina_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 110, "sourceHeight": 25, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 110, "height": 25}, "mask": {"backgroundColor": "#6D7C89", "backgroundNoise": 87.304, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.7193}, "mapStats": {"valueRange": 0.3738, "heightP90Gradient": 0.05325, "roughnessBase": 0.714, "roughnessVariation": 0.106, "normalStrength": 0.219, "blurRadius": 10}, "palette": ["#7D98A1", "#3F4350", "#85A0A8", "#738A94", "#55616D"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#5D6772", "#778891", "#81949A", "#6B828D", "#4A4A55"], "paletteHueRisk": [{"stop": "#5D6772", "hueRisk": "blue-collapse", "suggestedRgb": [114, 103, 93]}, {"stop": "#778891", "hueRisk": "blue-collapse", "suggestedRgb": [145, 136, 119]}, {"stop": "#6B828D", "hueRisk": "blue-collapse", "suggestedRgb": [141, 130, 107]}], "gradientAxis": "horizontal", "stats": {"meanLum": 124.3, "meanSaturation": 0.192, "gradientStrength": 0.294, "mottle": 0.027, "streakRatio": 2.7, "hueSpread": 0.02, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "hip-roof", "regionId": "copper", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/02-copper.png", "bbox": {"x": 2360, "y": 585, "width": 110, "height": 25}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0003}, "observations": ["chromatic base-colour response", "directional surface frequency", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "hip-roof", "regionId": "copper", "materialId": null, "family": "metal", "subtype": "copper", "finish": "polished-or-aged", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}, "needsEnvironment": true, "patina": {"amount": 0.8, "color": "#5FA391", "notes": "Aged copper: the blue-green patina is the base color."}},
    options
  );
  materialMap["steel"] = createSculptMaterial(
    "steel",
    {"id": "steel", "name": "Painted steel", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#2B2E33", "color": "#2B2E33", "albedo": {"dominant": "#2B2E33", "secondary": ["#2B2E33"], "samplingNotes": "Flat game color (vertex color); de-lit by eye from the dusk photo."}, "colorVariation": {"palette": ["#2B2E33"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.45, "map": "material-evidence/steel/steel_roughness.png", "notes": "Evidence map from extract_pbr_evidence.py; the game uses the base value only (toon shading)."}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "finishClass": "gem-metal", "texturePalette": ["#DFD77F", "#AF8912", "#A37730", "#CCAE4A", "#DED15A"], "proceduralTexture": "gradient-smoke", "clearcoat": {"base": 0.75, "variation": 0.0}, "clearcoatRoughness": {"base": 0.12, "variation": 0.0}, "transmission": {"base": 0.0, "variation": 0.0}, "ior": {"base": 1.5, "value": 1.5, "variation": 0.0}, "envMapIntensity": 1.3, "referenceMaterialId": "coating.painted-metal", "materialFamily": "coating", "materialSubtype": "paint-over-metal", "materialFinish": "gloss-or-satin", "materialReference": {"registry": "/Users/william-meroxa/.img2threejs/releases/a669e9a97cea4452b1c2310c5cca6aa0f6657c1f/img2threejs/docs/materials/material-reference.json", "profileId": "coating.painted-metal", "method": "family-subtype-finish", "confidence": 0.86, "sourceRefs": ["three.mesh-physical", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-1", "adobe.pbr-guide-2"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "clearcoatMap", "clearcoatRoughnessMap", "metalnessMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing", "environment-reflection", "reference-beauty"]}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/04-steel.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-04-steel/steel_albedo.png", "url": "steel_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-04-steel/steel_roughness.png", "url": "steel_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-04-steel/steel_height.png", "url": "steel_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-04-steel/steel_normal.png", "url": "steel_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-04-steel/steel_ao.png", "url": "steel_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 265, "sourceHeight": 44, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 265, "height": 44}, "mask": {"backgroundColor": "#917D61", "backgroundNoise": 123.73, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.5877}, "mapStats": {"valueRange": 0.6352, "heightP90Gradient": 0.19043, "roughnessBase": 0.831, "roughnessVariation": 0.184, "normalStrength": 0.379, "blurRadius": 10}, "palette": ["#F8E878", "#B18A16", "#906B33", "#CFBB46", "#6B4C30"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "textureAnalysis": {"finishClass": "gem-metal", "recipe": {"metalness": 0.75, "roughness": 0.14, "clearcoat": 0.6, "clearcoatRoughness": 0.06, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.3, "anisotropy": 0.0, "procedural": "gradient-smoke"}, "palette": ["#DFD781", "#AE8916", "#A3772F", "#C9AE4E", "#DED15D"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 186.5, "meanSaturation": 0.542, "gradientStrength": 0.531, "mottle": 0.178, "streakRatio": 8.0, "hueSpread": 0.021, "specularFraction": 0.404}}, "materialEvidence": {"componentId": "sign-frame", "regionId": "steel", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/04-steel.png", "bbox": {"x": 1906, "y": 725, "width": 265, "height": 44}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0013}, "observations": ["chromatic base-colour response", "directional surface frequency", "visible meso/micro variation", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "sign-frame", "regionId": "steel", "materialId": null, "family": "coating", "subtype": "paint-over-metal", "finish": "gloss-or-satin", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}},
    options
  );
  materialMap["sign-yellow"] = createSculptMaterial(
    "sign-yellow",
    {"id": "sign-yellow", "name": "Sign yellow", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#F2C230", "color": "#F2C230", "albedo": {"dominant": "#F2C230", "secondary": ["#F2C230"], "samplingNotes": "Flat game color (vertex color); de-lit by eye from the dusk photo."}, "colorVariation": {"palette": ["#F2C230"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.45, "map": "material-evidence/sign-yellow/sign-yellow_roughness.png", "notes": "Evidence map from extract_pbr_evidence.py; the game uses the base value only (toon shading)."}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "finishClass": "gem-metal", "texturePalette": ["#DFD77F", "#AF8912", "#A37730", "#CCAE4A", "#DED15A"], "proceduralTexture": "gradient-smoke", "clearcoat": {"base": 0.75, "variation": 0.0}, "clearcoatRoughness": {"base": 0.12, "variation": 0.0}, "transmission": {"base": 0.0, "variation": 0.0}, "ior": {"base": 1.5, "value": 1.5, "variation": 0.0}, "envMapIntensity": 1.3, "referenceMaterialId": "coating.painted-metal", "materialFamily": "coating", "materialSubtype": "paint-over-metal", "materialFinish": "gloss-or-satin", "materialReference": {"registry": "/Users/william-meroxa/.img2threejs/releases/a669e9a97cea4452b1c2310c5cca6aa0f6657c1f/img2threejs/docs/materials/material-reference.json", "profileId": "coating.painted-metal", "method": "family-subtype-finish", "confidence": 0.86, "sourceRefs": ["three.mesh-physical", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-1", "adobe.pbr-guide-2"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "clearcoatMap", "clearcoatRoughnessMap", "metalnessMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing", "environment-reflection", "reference-beauty"]}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/03-sign.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-03-sign/sign-yellow_albedo.png", "url": "sign-yellow_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-03-sign/sign-yellow_roughness.png", "url": "sign-yellow_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-03-sign/sign-yellow_height.png", "url": "sign-yellow_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-03-sign/sign-yellow_normal.png", "url": "sign-yellow_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-03-sign/sign-yellow_ao.png", "url": "sign-yellow_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 265, "sourceHeight": 44, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 265, "height": 44}, "mask": {"backgroundColor": "#917D61", "backgroundNoise": 123.73, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.5877}, "mapStats": {"valueRange": 0.6352, "heightP90Gradient": 0.19043, "roughnessBase": 0.831, "roughnessVariation": 0.184, "normalStrength": 0.379, "blurRadius": 10}, "palette": ["#F8E878", "#B18A16", "#906B33", "#CFBB46", "#6B4C30"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "textureAnalysis": {"finishClass": "gem-metal", "recipe": {"metalness": 0.75, "roughness": 0.14, "clearcoat": 0.6, "clearcoatRoughness": 0.06, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.3, "anisotropy": 0.0, "procedural": "gradient-smoke"}, "palette": ["#DFD781", "#AE8916", "#A3772F", "#C9AE4E", "#DED15D"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 186.5, "meanSaturation": 0.542, "gradientStrength": 0.531, "mottle": 0.178, "streakRatio": 8.0, "hueSpread": 0.021, "specularFraction": 0.404}}, "materialEvidence": {"componentId": "sign-letters", "regionId": "sign", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/03-sign.png", "bbox": {"x": 1906, "y": 725, "width": 265, "height": 44}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0013}, "observations": ["chromatic base-colour response", "directional surface frequency", "visible meso/micro variation", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "sign-letters", "regionId": "sign", "materialId": null, "family": "coating", "subtype": "paint-over-metal", "finish": "gloss-or-satin", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}, "canvasText": {"text": "PONCE CITY MARKET", "color": "#F2C230", "background": "#2B2E33", "font": "900 block sans-serif", "drawnBy": "src/render/landmark-signs.js createSignTexture"}},
    options
  );
  materialMap["gold"] = createSculptMaterial(
    "gold",
    {"id": "gold", "name": "Gold finial", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#D4A93A", "color": "#D4A93A", "albedo": {"dominant": "#2B2E33", "secondary": ["#2B2E33"], "samplingNotes": "Flat game color (vertex color); de-lit by eye from the dusk photo."}, "colorVariation": {"palette": ["#2B2E33"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.35, "map": "material-evidence/gold/gold_roughness.png", "notes": "Evidence map from extract_pbr_evidence.py; the game uses the base value only (toon shading)."}, "metalness": 1.0, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "finishClass": "gem-metal", "texturePalette": ["#DFD77F", "#AF8912", "#A37730", "#CCAE4A", "#DED15A"], "proceduralTexture": "gradient-smoke", "clearcoat": {"base": 0.75, "variation": 0.0}, "clearcoatRoughness": {"base": 0.12, "variation": 0.0}, "transmission": {"base": 0.0, "variation": 0.0}, "ior": {"base": 1.5, "value": 1.5, "variation": 0.0}, "envMapIntensity": 1.3, "referenceMaterialId": "coating.painted-metal", "materialFamily": "coating", "materialSubtype": "paint-over-metal", "materialFinish": "gloss-or-satin", "materialReference": {"registry": "/Users/william-meroxa/.img2threejs/releases/a669e9a97cea4452b1c2310c5cca6aa0f6657c1f/img2threejs/docs/materials/material-reference.json", "profileId": "coating.painted-metal", "method": "family-subtype-finish", "confidence": 0.86, "sourceRefs": ["three.mesh-physical", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-1", "adobe.pbr-guide-2"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "clearcoatMap", "clearcoatRoughnessMap", "metalnessMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing", "environment-reflection", "reference-beauty"]}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/04-steel.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-04-steel/steel_albedo.png", "url": "steel_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-04-steel/steel_roughness.png", "url": "steel_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-04-steel/steel_height.png", "url": "steel_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-04-steel/steel_normal.png", "url": "steel_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-04-steel/steel_ao.png", "url": "steel_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 265, "sourceHeight": 44, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 265, "height": 44}, "mask": {"backgroundColor": "#917D61", "backgroundNoise": 123.73, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.5877}, "mapStats": {"valueRange": 0.6352, "heightP90Gradient": 0.19043, "roughnessBase": 0.831, "roughnessVariation": 0.184, "normalStrength": 0.379, "blurRadius": 10}, "palette": ["#F8E878", "#B18A16", "#906B33", "#CFBB46", "#6B4C30"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "textureAnalysis": {"finishClass": "gem-metal", "recipe": {"metalness": 0.75, "roughness": 0.14, "clearcoat": 0.6, "clearcoatRoughness": 0.06, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.3, "anisotropy": 0.0, "procedural": "gradient-smoke"}, "palette": ["#DFD781", "#AE8916", "#A3772F", "#C9AE4E", "#DED15D"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 186.5, "meanSaturation": 0.542, "gradientStrength": 0.531, "mottle": 0.178, "streakRatio": 8.0, "hueSpread": 0.021, "specularFraction": 0.404}}, "materialEvidence": {"componentId": "sign-frame", "regionId": "steel", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/04-steel.png", "bbox": {"x": 1906, "y": 725, "width": 265, "height": 44}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0013}, "observations": ["chromatic base-colour response", "directional surface frequency", "visible meso/micro variation", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "sign-frame", "regionId": "steel", "materialId": null, "family": "coating", "subtype": "paint-over-metal", "finish": "gloss-or-satin", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}},
    options
  );
  materialMap["glass-dark"] = createSculptMaterial(
    "glass-dark",
    {"id": "glass-dark", "name": "Dark window glass", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#2C3440", "color": "#2C3440", "albedo": {"dominant": "#2B2E33", "secondary": ["#2B2E33"], "samplingNotes": "Flat game color (vertex color); de-lit by eye from the dusk photo."}, "colorVariation": {"palette": ["#2B2E33"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.2, "map": "material-evidence/glass-dark/glass-dark_roughness.png", "notes": "Evidence map from extract_pbr_evidence.py; the game uses the base value only (toon shading)."}, "metalness": 0.0, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "finishClass": "gem-metal", "texturePalette": ["#DFD77F", "#AF8912", "#A37730", "#CCAE4A", "#DED15A"], "proceduralTexture": "gradient-smoke", "clearcoat": {"base": 0.75, "variation": 0.0}, "clearcoatRoughness": {"base": 0.12, "variation": 0.0}, "transmission": {"base": 0.0, "variation": 0.0}, "ior": {"base": 1.5, "value": 1.5, "variation": 0.0}, "envMapIntensity": 1.3, "referenceMaterialId": "coating.painted-metal", "materialFamily": "coating", "materialSubtype": "paint-over-metal", "materialFinish": "gloss-or-satin", "materialReference": {"registry": "/Users/william-meroxa/.img2threejs/releases/a669e9a97cea4452b1c2310c5cca6aa0f6657c1f/img2threejs/docs/materials/material-reference.json", "profileId": "coating.painted-metal", "method": "family-subtype-finish", "confidence": 0.86, "sourceRefs": ["three.mesh-physical", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-1", "adobe.pbr-guide-2"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "clearcoatMap", "clearcoatRoughnessMap", "metalnessMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing", "environment-reflection", "reference-beauty"]}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/04-steel.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-04-steel/steel_albedo.png", "url": "steel_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-04-steel/steel_roughness.png", "url": "steel_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-04-steel/steel_height.png", "url": "steel_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-04-steel/steel_normal.png", "url": "steel_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/pbr-04-steel/steel_ao.png", "url": "steel_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 265, "sourceHeight": 44, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 265, "height": 44}, "mask": {"backgroundColor": "#917D61", "backgroundNoise": 123.73, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.5877}, "mapStats": {"valueRange": 0.6352, "heightP90Gradient": 0.19043, "roughnessBase": 0.831, "roughnessVariation": 0.184, "normalStrength": 0.379, "blurRadius": 10}, "palette": ["#F8E878", "#B18A16", "#906B33", "#CFBB46", "#6B4C30"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "textureAnalysis": {"finishClass": "gem-metal", "recipe": {"metalness": 0.75, "roughness": 0.14, "clearcoat": 0.6, "clearcoatRoughness": 0.06, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.3, "anisotropy": 0.0, "procedural": "gradient-smoke"}, "palette": ["#DFD781", "#AE8916", "#A3772F", "#C9AE4E", "#DED15D"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 186.5, "meanSaturation": 0.542, "gradientStrength": 0.531, "mottle": 0.178, "streakRatio": 8.0, "hueSpread": 0.021, "specularFraction": 0.404}}, "materialEvidence": {"componentId": "sign-frame", "regionId": "steel", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/04-steel.png", "bbox": {"x": 1906, "y": 725, "width": 265, "height": 44}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0013}, "observations": ["chromatic base-colour response", "directional surface frequency", "visible meso/micro variation", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "sign-frame", "regionId": "steel", "materialId": null, "family": "coating", "subtype": "paint-over-metal", "finish": "gloss-or-satin", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_tower_shaft_0 = makeAttachmentEndpoint(null);
  const node_tower_shaft_0 = new THREE.Group();
  node_tower_shaft_0.name = "Tower shaft__pivot";
  node_tower_shaft_0.scale.set(1, 1, 1);
  if (endpoint_tower_shaft_0) {
    node_tower_shaft_0.position.copy(endpoint_tower_shaft_0.start);
    node_tower_shaft_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tower_shaft_0.position.set(0.0, 5.0, 0.0);
    node_tower_shaft_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_tower_shaft_0.userData.sculptComponent = {"id": "tower-shaft", "name": "Tower shaft", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A square brick shaft: planar faces at hard edges.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 8, "height": 10, "depth": 8, "units": "m", "confidence": 0.75}, "transform": {"position": [0, 5, 0], "rotation": [0, 0, 0], "worldPosition": [0, 5, 0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brick", "materialLayers": ["brick"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["band-joint-ao"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "brick", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "brick", "dominantAlbedo": "rgba(126, 59, 51, 1.0)", "secondaryAlbedo": "rgba(107, 50, 43, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_tower_shaft_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_tower_shaft_0);
  nodes["tower-shaft"] = node_tower_shaft_0;
  const mesh_tower_shaft_0Geometry = endpoint_tower_shaft_0
    ? new THREE.CylinderGeometry(endpoint_tower_shaft_0.endRadius, endpoint_tower_shaft_0.baseRadius, endpoint_tower_shaft_0.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_tower_shaft_0) {
    mesh_tower_shaft_0Geometry.scale(8.0, 10.0, 8.0);
  }
  const mesh_tower_shaft_0 = new THREE.Mesh(
    mesh_tower_shaft_0Geometry,
    materialMap["brick"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tower_shaft_0.name = "Tower shaft";
  if (endpoint_tower_shaft_0) {
    mesh_tower_shaft_0.position.copy(endpoint_tower_shaft_0.midpoint);
    mesh_tower_shaft_0.quaternion.copy(endpoint_tower_shaft_0.quaternion);
  }
  mesh_tower_shaft_0.castShadow = options.castShadow ?? true;
  mesh_tower_shaft_0.receiveShadow = options.receiveShadow ?? true;
  mesh_tower_shaft_0.userData.sculptComponent = {"id": "tower-shaft", "name": "Tower shaft", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A square brick shaft: planar faces at hard edges.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 8, "height": 10, "depth": 8, "units": "m", "confidence": 0.75}, "transform": {"position": [0, 5, 0], "rotation": [0, 0, 0], "worldPosition": [0, 5, 0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brick", "materialLayers": ["brick"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["band-joint-ao"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "brick", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "brick", "dominantAlbedo": "rgba(126, 59, 51, 1.0)", "secondaryAlbedo": "rgba(107, 50, 43, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_tower_shaft_0.add(mesh_tower_shaft_0);
  meshes["tower-shaft"] = mesh_tower_shaft_0;
  colliders["tower-shaft"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_tower_shaft_0);

  const endpoint_lower_band_1 = makeAttachmentEndpoint(null);
  const node_lower_band_1 = new THREE.Group();
  node_lower_band_1.name = "Stone band under the belvedere__pivot";
  node_lower_band_1.scale.set(1, 1, 1);
  if (endpoint_lower_band_1) {
    node_lower_band_1.position.copy(endpoint_lower_band_1.start);
    node_lower_band_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lower_band_1.position.set(0.0, 5.3, 0.0);
    node_lower_band_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_lower_band_1.userData.sculptComponent = {"id": "lower-band", "name": "Stone band under the belvedere", "level": "meso", "role": "trim", "importance": 0.7, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A thin projecting slab; planar faces.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tower-shaft", "attachment": {"parentSocket": "tower-shaft", "localStart": [0, 5.0, 0], "localEnd": [0, 5.6, 0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 8.6, "height": 0.6, "depth": 8.6, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 5.3, 0], "rotation": [0, 0, 0], "worldPosition": [0, 10.3, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_lower_band_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["tower-shaft"] ?? root).add(node_lower_band_1);
  nodes["lower-band"] = node_lower_band_1;
  const mesh_lower_band_1Geometry = endpoint_lower_band_1
    ? new THREE.CylinderGeometry(endpoint_lower_band_1.endRadius, endpoint_lower_band_1.baseRadius, endpoint_lower_band_1.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_lower_band_1) {
    mesh_lower_band_1Geometry.scale(8.6, 0.6, 8.6);
  }
  const mesh_lower_band_1 = new THREE.Mesh(
    mesh_lower_band_1Geometry,
    materialMap["trim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lower_band_1.name = "Stone band under the belvedere";
  if (endpoint_lower_band_1) {
    mesh_lower_band_1.position.copy(endpoint_lower_band_1.midpoint);
    mesh_lower_band_1.quaternion.copy(endpoint_lower_band_1.quaternion);
  }
  mesh_lower_band_1.castShadow = options.castShadow ?? true;
  mesh_lower_band_1.receiveShadow = options.receiveShadow ?? true;
  mesh_lower_band_1.userData.sculptComponent = {"id": "lower-band", "name": "Stone band under the belvedere", "level": "meso", "role": "trim", "importance": 0.7, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A thin projecting slab; planar faces.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tower-shaft", "attachment": {"parentSocket": "tower-shaft", "localStart": [0, 5.0, 0], "localEnd": [0, 5.6, 0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 8.6, "height": 0.6, "depth": 8.6, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 5.3, 0], "rotation": [0, 0, 0], "worldPosition": [0, 10.3, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_lower_band_1.add(mesh_lower_band_1);
  meshes["lower-band"] = mesh_lower_band_1;
  colliders["lower-band"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_lower_band_1);

  const endpoint_belvedere_2 = makeAttachmentEndpoint(null);
  const node_belvedere_2 = new THREE.Group();
  node_belvedere_2.name = "Brick belvedere__pivot";
  node_belvedere_2.scale.set(1, 1, 1);
  if (endpoint_belvedere_2) {
    node_belvedere_2.position.copy(endpoint_belvedere_2.start);
    node_belvedere_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_belvedere_2.position.set(0.0, 2.8, 0.0);
    node_belvedere_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_belvedere_2.userData.sculptComponent = {"id": "belvedere", "name": "Brick belvedere", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Same square plan as the shaft; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "lower-band", "attachment": {"parentSocket": "lower-band", "localStart": [0, 0.3, 0], "localEnd": [0, 5.3, 0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 8, "height": 5, "depth": 8, "units": "m", "confidence": 0.75}, "transform": {"position": [0, 2.8, 0], "rotation": [0, 0, 0], "worldPosition": [0, 13.1, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brick", "materialLayers": ["brick"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["arched-window-row"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "brick", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "brick", "dominantAlbedo": "rgba(126, 59, 51, 1.0)", "secondaryAlbedo": "rgba(107, 50, 43, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_belvedere_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["lower-band"] ?? root).add(node_belvedere_2);
  nodes["belvedere"] = node_belvedere_2;
  const mesh_belvedere_2Geometry = endpoint_belvedere_2
    ? new THREE.CylinderGeometry(endpoint_belvedere_2.endRadius, endpoint_belvedere_2.baseRadius, endpoint_belvedere_2.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_belvedere_2) {
    mesh_belvedere_2Geometry.scale(8.0, 5.0, 8.0);
  }
  const mesh_belvedere_2 = new THREE.Mesh(
    mesh_belvedere_2Geometry,
    materialMap["brick"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_belvedere_2.name = "Brick belvedere";
  if (endpoint_belvedere_2) {
    mesh_belvedere_2.position.copy(endpoint_belvedere_2.midpoint);
    mesh_belvedere_2.quaternion.copy(endpoint_belvedere_2.quaternion);
  }
  mesh_belvedere_2.castShadow = options.castShadow ?? true;
  mesh_belvedere_2.receiveShadow = options.receiveShadow ?? true;
  mesh_belvedere_2.userData.sculptComponent = {"id": "belvedere", "name": "Brick belvedere", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Same square plan as the shaft; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "lower-band", "attachment": {"parentSocket": "lower-band", "localStart": [0, 0.3, 0], "localEnd": [0, 5.3, 0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 8, "height": 5, "depth": 8, "units": "m", "confidence": 0.75}, "transform": {"position": [0, 2.8, 0], "rotation": [0, 0, 0], "worldPosition": [0, 13.1, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brick", "materialLayers": ["brick"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["arched-window-row"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "brick", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "brick", "dominantAlbedo": "rgba(126, 59, 51, 1.0)", "secondaryAlbedo": "rgba(107, 50, 43, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_belvedere_2.add(mesh_belvedere_2);
  meshes["belvedere"] = mesh_belvedere_2;
  colliders["belvedere"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_belvedere_2);

  const endpoint_upper_band_3 = makeAttachmentEndpoint(null);
  const node_upper_band_3 = new THREE.Group();
  node_upper_band_3.name = "Stone cornice under the roof__pivot";
  node_upper_band_3.scale.set(1, 1, 1);
  if (endpoint_upper_band_3) {
    node_upper_band_3.position.copy(endpoint_upper_band_3.start);
    node_upper_band_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_upper_band_3.position.set(0.0, 2.85, 0.0);
    node_upper_band_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_upper_band_3.userData.sculptComponent = {"id": "upper-band", "name": "Stone cornice under the roof", "level": "meso", "role": "trim", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A projecting cornice slab under the eave; planar faces.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [0, 2.5, 0], "localEnd": [0, 3.2, 0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 9.2, "height": 0.7, "depth": 9.2, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 2.85, 0], "rotation": [0, 0, 0], "worldPosition": [0, 15.95, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_upper_band_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_upper_band_3);
  nodes["upper-band"] = node_upper_band_3;
  const mesh_upper_band_3Geometry = endpoint_upper_band_3
    ? new THREE.CylinderGeometry(endpoint_upper_band_3.endRadius, endpoint_upper_band_3.baseRadius, endpoint_upper_band_3.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_upper_band_3) {
    mesh_upper_band_3Geometry.scale(9.2, 0.7, 9.2);
  }
  const mesh_upper_band_3 = new THREE.Mesh(
    mesh_upper_band_3Geometry,
    materialMap["trim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_upper_band_3.name = "Stone cornice under the roof";
  if (endpoint_upper_band_3) {
    mesh_upper_band_3.position.copy(endpoint_upper_band_3.midpoint);
    mesh_upper_band_3.quaternion.copy(endpoint_upper_band_3.quaternion);
  }
  mesh_upper_band_3.castShadow = options.castShadow ?? true;
  mesh_upper_band_3.receiveShadow = options.receiveShadow ?? true;
  mesh_upper_band_3.userData.sculptComponent = {"id": "upper-band", "name": "Stone cornice under the roof", "level": "meso", "role": "trim", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A projecting cornice slab under the eave; planar faces.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [0, 2.5, 0], "localEnd": [0, 3.2, 0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 9.2, "height": 0.7, "depth": 9.2, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 2.85, 0], "rotation": [0, 0, 0], "worldPosition": [0, 15.95, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_upper_band_3.add(mesh_upper_band_3);
  meshes["upper-band"] = mesh_upper_band_3;
  colliders["upper-band"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_upper_band_3);

  const attachment_hip_roof_4 = {"parentSocket": "upper-band", "localStart": [0, 0.35, 0], "localEnd": [0, 2.15, 0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 6.7882, "endRadius": 2.5456};
  const endpoint_hip_roof_4 = makeAttachmentEndpoint(attachment_hip_roof_4);
  const node_hip_roof_4 = new THREE.Group();
  node_hip_roof_4.name = "Hipped copper roof__pivot";
  node_hip_roof_4.scale.set(1, 1, 1);
  if (endpoint_hip_roof_4) {
    node_hip_roof_4.position.copy(endpoint_hip_roof_4.start);
    node_hip_roof_4.rotation.set(0.0, 0.7853981634, 0.0);
  } else {
    node_hip_roof_4.position.set(0.0, 1.25, 0.0);
    node_hip_roof_4.rotation.set(0.0, 0.7853981634, 0.0);
  }
  node_hip_roof_4.userData.sculptComponent = {"id": "hip-roof", "name": "Hipped copper roof", "level": "macro", "role": "detail", "importance": 1.0, "confidence": 0.8, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "A low pyramid of 4 planar faces: a cone with 4 radial segments, turned 45 degrees so the edges sit on the diagonals.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "radialSegments": 4}, "parent": "upper-band", "attachment": {"parentSocket": "upper-band", "localStart": [0, 0.35, 0], "localEnd": [0, 2.15, 0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 6.7882, "endRadius": 2.5456}, "dimensions": {"width": 9.6, "height": 1.8, "depth": 9.6, "units": "m", "confidence": 0.8, "radius": 6.7882}, "transform": {"position": [0, 1.25, 0], "rotation": [0, 0.7853981634, 0], "worldPosition": [0, 17.2, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "copper-patina", "materialLayers": ["copper-patina"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["wide-eave"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "copper-patina", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "copper-patina", "dominantAlbedo": "rgba(110, 156, 152, 1.0)", "secondaryAlbedo": "rgba(93, 132, 129, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "topWidth": 3.6};
  node_hip_roof_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["upper-band"] ?? root).add(node_hip_roof_4);
  nodes["hip-roof"] = node_hip_roof_4;
  const mesh_hip_roof_4Geometry = endpoint_hip_roof_4
    ? new THREE.CylinderGeometry(endpoint_hip_roof_4.endRadius, endpoint_hip_roof_4.baseRadius, endpoint_hip_roof_4.length, 4, 1)
    : new THREE.ConeGeometry(0.5, 1, 10, 1);
  if (!endpoint_hip_roof_4) {
    mesh_hip_roof_4Geometry.scale(9.6, 1.8, 9.6);
  }
  const mesh_hip_roof_4 = new THREE.Mesh(
    mesh_hip_roof_4Geometry,
    materialMap["copper-patina"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hip_roof_4.name = "Hipped copper roof";
  if (endpoint_hip_roof_4) {
    mesh_hip_roof_4.position.copy(endpoint_hip_roof_4.midpoint);
    mesh_hip_roof_4.quaternion.copy(endpoint_hip_roof_4.quaternion);
  }
  mesh_hip_roof_4.castShadow = options.castShadow ?? true;
  mesh_hip_roof_4.receiveShadow = options.receiveShadow ?? true;
  mesh_hip_roof_4.userData.sculptComponent = {"id": "hip-roof", "name": "Hipped copper roof", "level": "macro", "role": "detail", "importance": 1.0, "confidence": 0.8, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "A low pyramid of 4 planar faces: a cone with 4 radial segments, turned 45 degrees so the edges sit on the diagonals.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "radialSegments": 4}, "parent": "upper-band", "attachment": {"parentSocket": "upper-band", "localStart": [0, 0.35, 0], "localEnd": [0, 2.15, 0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 6.7882, "endRadius": 2.5456}, "dimensions": {"width": 9.6, "height": 1.8, "depth": 9.6, "units": "m", "confidence": 0.8, "radius": 6.7882}, "transform": {"position": [0, 1.25, 0], "rotation": [0, 0.7853981634, 0], "worldPosition": [0, 17.2, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "copper-patina", "materialLayers": ["copper-patina"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["wide-eave"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "copper-patina", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "copper-patina", "dominantAlbedo": "rgba(110, 156, 152, 1.0)", "secondaryAlbedo": "rgba(93, 132, 129, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "topWidth": 3.6};
  node_hip_roof_4.add(mesh_hip_roof_4);
  meshes["hip-roof"] = mesh_hip_roof_4;
  colliders["hip-roof"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_hip_roof_4);

  const endpoint_roof_cap_5 = makeAttachmentEndpoint(null);
  const node_roof_cap_5 = new THREE.Group();
  node_roof_cap_5.name = "Raised flat roof cap__pivot";
  node_roof_cap_5.scale.set(1, 1, 1);
  if (endpoint_roof_cap_5) {
    node_roof_cap_5.position.copy(endpoint_roof_cap_5.start);
    node_roof_cap_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_roof_cap_5.position.set(0.0, 2.6, 0.0);
    node_roof_cap_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_roof_cap_5.userData.sculptComponent = {"id": "roof-cap", "name": "Raised flat roof cap", "level": "meso", "role": "trim", "importance": 0.7, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A raised flat-topped square block on the flat top of the hipped roof (parented to the cornice, which is not turned); a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "upper-band", "attachment": {"parentSocket": "upper-band", "localStart": [0, 2.15, 0], "localEnd": [0, 3.05, 0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 3.4, "height": 0.9, "depth": 3.4, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 2.6, 0], "rotation": [0, 0, 0], "worldPosition": [0, 18.55, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "copper-patina", "materialLayers": ["copper-patina"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "copper-patina", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "copper-patina", "dominantAlbedo": "rgba(110, 156, 152, 1.0)", "secondaryAlbedo": "rgba(93, 132, 129, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_roof_cap_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["upper-band"] ?? root).add(node_roof_cap_5);
  nodes["roof-cap"] = node_roof_cap_5;
  const mesh_roof_cap_5Geometry = endpoint_roof_cap_5
    ? new THREE.CylinderGeometry(endpoint_roof_cap_5.endRadius, endpoint_roof_cap_5.baseRadius, endpoint_roof_cap_5.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_roof_cap_5) {
    mesh_roof_cap_5Geometry.scale(3.4, 0.9, 3.4);
  }
  const mesh_roof_cap_5 = new THREE.Mesh(
    mesh_roof_cap_5Geometry,
    materialMap["copper-patina"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_roof_cap_5.name = "Raised flat roof cap";
  if (endpoint_roof_cap_5) {
    mesh_roof_cap_5.position.copy(endpoint_roof_cap_5.midpoint);
    mesh_roof_cap_5.quaternion.copy(endpoint_roof_cap_5.quaternion);
  }
  mesh_roof_cap_5.castShadow = options.castShadow ?? true;
  mesh_roof_cap_5.receiveShadow = options.receiveShadow ?? true;
  mesh_roof_cap_5.userData.sculptComponent = {"id": "roof-cap", "name": "Raised flat roof cap", "level": "meso", "role": "trim", "importance": 0.7, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A raised flat-topped square block on the flat top of the hipped roof (parented to the cornice, which is not turned); a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "upper-band", "attachment": {"parentSocket": "upper-band", "localStart": [0, 2.15, 0], "localEnd": [0, 3.05, 0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 3.4, "height": 0.9, "depth": 3.4, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 2.6, 0], "rotation": [0, 0, 0], "worldPosition": [0, 18.55, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "copper-patina", "materialLayers": ["copper-patina"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "copper-patina", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "copper-patina", "dominantAlbedo": "rgba(110, 156, 152, 1.0)", "secondaryAlbedo": "rgba(93, 132, 129, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_roof_cap_5.add(mesh_roof_cap_5);
  meshes["roof-cap"] = mesh_roof_cap_5;
  colliders["roof-cap"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_roof_cap_5);

  const endpoint_cap_trim_6 = makeAttachmentEndpoint(null);
  const node_cap_trim_6 = new THREE.Group();
  node_cap_trim_6.name = "Cap edge trim__pivot";
  node_cap_trim_6.scale.set(1, 1, 1);
  if (endpoint_cap_trim_6) {
    node_cap_trim_6.position.copy(endpoint_cap_trim_6.start);
    node_cap_trim_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cap_trim_6.position.set(0.0, 0.45, 0.0);
    node_cap_trim_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_cap_trim_6.userData.sculptComponent = {"id": "cap-trim", "name": "Cap edge trim", "level": "micro", "role": "trim", "importance": 0.5, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A thin light edge on the cap; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "roof-cap", "attachment": {"parentSocket": "roof-cap", "localStart": [0, 0.375, 0], "localEnd": [0, 0.525, 0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 3.6, "height": 0.15, "depth": 3.6, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.45, 0], "rotation": [0, 0, 0], "worldPosition": [0, 19.0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_cap_trim_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["roof-cap"] ?? root).add(node_cap_trim_6);
  nodes["cap-trim"] = node_cap_trim_6;
  const mesh_cap_trim_6Geometry = endpoint_cap_trim_6
    ? new THREE.CylinderGeometry(endpoint_cap_trim_6.endRadius, endpoint_cap_trim_6.baseRadius, endpoint_cap_trim_6.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_cap_trim_6) {
    mesh_cap_trim_6Geometry.scale(3.6, 0.15, 3.6);
  }
  const mesh_cap_trim_6 = new THREE.Mesh(
    mesh_cap_trim_6Geometry,
    materialMap["trim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cap_trim_6.name = "Cap edge trim";
  if (endpoint_cap_trim_6) {
    mesh_cap_trim_6.position.copy(endpoint_cap_trim_6.midpoint);
    mesh_cap_trim_6.quaternion.copy(endpoint_cap_trim_6.quaternion);
  }
  mesh_cap_trim_6.castShadow = options.castShadow ?? true;
  mesh_cap_trim_6.receiveShadow = options.receiveShadow ?? true;
  mesh_cap_trim_6.userData.sculptComponent = {"id": "cap-trim", "name": "Cap edge trim", "level": "micro", "role": "trim", "importance": 0.5, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A thin light edge on the cap; a box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "roof-cap", "attachment": {"parentSocket": "roof-cap", "localStart": [0, 0.375, 0], "localEnd": [0, 0.525, 0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 3.6, "height": 0.15, "depth": 3.6, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.45, 0], "rotation": [0, 0, 0], "worldPosition": [0, 19.0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_cap_trim_6.add(mesh_cap_trim_6);
  meshes["cap-trim"] = mesh_cap_trim_6;
  colliders["cap-trim"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_cap_trim_6);

  const attachment_finial_7 = {"parentSocket": "roof-cap", "localStart": [0, 0.5, 0], "localEnd": [0, 2.1, 0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.15, "endRadius": 0.15};
  const endpoint_finial_7 = makeAttachmentEndpoint(attachment_finial_7);
  const node_finial_7 = new THREE.Group();
  node_finial_7.name = "Gold finial and pole__pivot";
  node_finial_7.scale.set(1, 1, 1);
  if (endpoint_finial_7) {
    node_finial_7.position.copy(endpoint_finial_7.start);
    node_finial_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_finial_7.position.set(0.0, 1.3, 0.0);
    node_finial_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_finial_7.userData.sculptComponent = {"id": "finial", "name": "Gold finial and pole", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A round pole about 0.3 m wide (measured from the reference crop: about 2 px against a 55 px tower); a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "roof-cap", "attachment": {"parentSocket": "roof-cap", "localStart": [0, 0.5, 0], "localEnd": [0, 2.1, 0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.15, "endRadius": 0.15}, "dimensions": {"width": 0.3, "height": 1.6, "depth": 0.3, "units": "m", "confidence": 0.7, "radius": 0.15}, "transform": {"position": [0, 1.3, 0], "rotation": [0, 0, 0], "worldPosition": [0, 19.85, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "gold", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "gold", "dominantAlbedo": "rgba(212, 169, 58, 1.0)", "secondaryAlbedo": "rgba(180, 143, 49, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_finial_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["roof-cap"] ?? root).add(node_finial_7);
  nodes["finial"] = node_finial_7;
  const mesh_finial_7Geometry = endpoint_finial_7
    ? new THREE.CylinderGeometry(endpoint_finial_7.endRadius, endpoint_finial_7.baseRadius, endpoint_finial_7.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_finial_7) {
    mesh_finial_7Geometry.scale(0.3, 1.6, 0.3);
  }
  const mesh_finial_7 = new THREE.Mesh(
    mesh_finial_7Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_finial_7.name = "Gold finial and pole";
  if (endpoint_finial_7) {
    mesh_finial_7.position.copy(endpoint_finial_7.midpoint);
    mesh_finial_7.quaternion.copy(endpoint_finial_7.quaternion);
  }
  mesh_finial_7.castShadow = options.castShadow ?? true;
  mesh_finial_7.receiveShadow = options.receiveShadow ?? true;
  mesh_finial_7.userData.sculptComponent = {"id": "finial", "name": "Gold finial and pole", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A round pole about 0.3 m wide (measured from the reference crop: about 2 px against a 55 px tower); a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "roof-cap", "attachment": {"parentSocket": "roof-cap", "localStart": [0, 0.5, 0], "localEnd": [0, 2.1, 0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.15, "endRadius": 0.15}, "dimensions": {"width": 0.3, "height": 1.6, "depth": 0.3, "units": "m", "confidence": 0.7, "radius": 0.15}, "transform": {"position": [0, 1.3, 0], "rotation": [0, 0, 0], "worldPosition": [0, 19.85, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "gold", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "gold", "dominantAlbedo": "rgba(212, 169, 58, 1.0)", "secondaryAlbedo": "rgba(180, 143, 49, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_finial_7.add(mesh_finial_7);
  meshes["finial"] = mesh_finial_7;
  colliders["finial"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_finial_7);

  const endpoint_finial_ball_8 = makeAttachmentEndpoint(null);
  const node_finial_ball_8 = new THREE.Group();
  node_finial_ball_8.name = "Gold finial ball__pivot";
  node_finial_ball_8.scale.set(1, 1, 1);
  if (endpoint_finial_ball_8) {
    node_finial_ball_8.position.copy(endpoint_finial_ball_8.start);
    node_finial_ball_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_finial_ball_8.position.set(0.0, 0.9, 0.0);
    node_finial_ball_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_finial_ball_8.userData.sculptComponent = {"id": "finial-ball", "name": "Gold finial ball", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.6, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "A small ball on the pole top; a sphere.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "finial", "attachment": {"parentSocket": "finial", "localStart": [0, 0.6, 0], "localEnd": [0, 1.2, 0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.6, "height": 0.6, "depth": 0.6, "units": "m", "confidence": 0.6}, "transform": {"position": [0, 0.9, 0], "rotation": [0, 0, 0], "worldPosition": [0, 20.75, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "gold", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "gold", "dominantAlbedo": "rgba(212, 169, 58, 1.0)", "secondaryAlbedo": "rgba(180, 143, 49, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_finial_ball_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["finial"] ?? root).add(node_finial_ball_8);
  nodes["finial-ball"] = node_finial_ball_8;
  const mesh_finial_ball_8Geometry = endpoint_finial_ball_8
    ? new THREE.CylinderGeometry(endpoint_finial_ball_8.endRadius, endpoint_finial_ball_8.baseRadius, endpoint_finial_ball_8.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_finial_ball_8) {
    mesh_finial_ball_8Geometry.scale(0.6, 0.6, 0.6);
  }
  const mesh_finial_ball_8 = new THREE.Mesh(
    mesh_finial_ball_8Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_finial_ball_8.name = "Gold finial ball";
  if (endpoint_finial_ball_8) {
    mesh_finial_ball_8.position.copy(endpoint_finial_ball_8.midpoint);
    mesh_finial_ball_8.quaternion.copy(endpoint_finial_ball_8.quaternion);
  }
  mesh_finial_ball_8.castShadow = options.castShadow ?? true;
  mesh_finial_ball_8.receiveShadow = options.receiveShadow ?? true;
  mesh_finial_ball_8.userData.sculptComponent = {"id": "finial-ball", "name": "Gold finial ball", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.6, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "A small ball on the pole top; a sphere.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "finial", "attachment": {"parentSocket": "finial", "localStart": [0, 0.6, 0], "localEnd": [0, 1.2, 0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.6, "height": 0.6, "depth": 0.6, "units": "m", "confidence": 0.6}, "transform": {"position": [0, 0.9, 0], "rotation": [0, 0, 0], "worldPosition": [0, 20.75, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "gold", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "gold", "dominantAlbedo": "rgba(212, 169, 58, 1.0)", "secondaryAlbedo": "rgba(180, 143, 49, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_finial_ball_8.add(mesh_finial_ball_8);
  meshes["finial-ball"] = mesh_finial_ball_8;
  colliders["finial-ball"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_finial_ball_8);

  const endpoint_arch_s0_9 = makeAttachmentEndpoint(null);
  const node_arch_s0_9 = new THREE.Group();
  node_arch_s0_9.name = "Arched window s0__pivot";
  node_arch_s0_9.scale.set(1, 1, 1);
  if (endpoint_arch_s0_9) {
    node_arch_s0_9.position.copy(endpoint_arch_s0_9.start);
    node_arch_s0_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_s0_9.position.set(-2.4, -0.2, 4.04);
    node_arch_s0_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_s0_9.userData.sculptComponent = {"id": "arch-s0", "name": "Arched window s0", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-2.4, -1.3, 4.04], "localEnd": [-2.4, 0.9, 4.04], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.0, "height": 2.2, "depth": 0.16, "units": "m", "confidence": 0.7}, "transform": {"position": [-2.4, -0.2, 4.04], "rotation": [0, 0, 0], "worldPosition": [-2.4, 12.9, 4.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_s0_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_s0_9);
  nodes["arch-s0"] = node_arch_s0_9;
  const mesh_arch_s0_9Geometry = endpoint_arch_s0_9
    ? new THREE.CylinderGeometry(endpoint_arch_s0_9.endRadius, endpoint_arch_s0_9.baseRadius, endpoint_arch_s0_9.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_s0_9) {
    mesh_arch_s0_9Geometry.scale(1.0, 2.2, 0.16);
  }
  const mesh_arch_s0_9 = new THREE.Mesh(
    mesh_arch_s0_9Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_s0_9.name = "Arched window s0";
  if (endpoint_arch_s0_9) {
    mesh_arch_s0_9.position.copy(endpoint_arch_s0_9.midpoint);
    mesh_arch_s0_9.quaternion.copy(endpoint_arch_s0_9.quaternion);
  }
  mesh_arch_s0_9.castShadow = options.castShadow ?? true;
  mesh_arch_s0_9.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_s0_9.userData.sculptComponent = {"id": "arch-s0", "name": "Arched window s0", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-2.4, -1.3, 4.04], "localEnd": [-2.4, 0.9, 4.04], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.0, "height": 2.2, "depth": 0.16, "units": "m", "confidence": 0.7}, "transform": {"position": [-2.4, -0.2, 4.04], "rotation": [0, 0, 0], "worldPosition": [-2.4, 12.9, 4.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_s0_9.add(mesh_arch_s0_9);
  meshes["arch-s0"] = mesh_arch_s0_9;
  colliders["arch-s0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_s0_9);

  const attachment_arch_head_s0_10 = {"parentSocket": "belvedere", "localStart": [-2.4, 0.9, 3.97], "localEnd": [-2.4, 0.9, 4.13], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5};
  const endpoint_arch_head_s0_10 = makeAttachmentEndpoint(attachment_arch_head_s0_10);
  const node_arch_head_s0_10 = new THREE.Group();
  node_arch_head_s0_10.name = "Arch head s0__pivot";
  node_arch_head_s0_10.scale.set(1, 1, 1);
  if (endpoint_arch_head_s0_10) {
    node_arch_head_s0_10.position.copy(endpoint_arch_head_s0_10.start);
    node_arch_head_s0_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_head_s0_10.position.set(-2.4, 0.9, 4.05);
    node_arch_head_s0_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_head_s0_10.userData.sculptComponent = {"id": "arch-head-s0", "name": "Arch head s0", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-2.4, 0.9, 3.97], "localEnd": [-2.4, 0.9, 4.13], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [-2.4, 0.9, 4.05], "rotation": [0, 0, 0], "worldPosition": [-2.4, 14.0, 4.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [0, 0, 1]};
  node_arch_head_s0_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_head_s0_10);
  nodes["arch-head-s0"] = node_arch_head_s0_10;
  const mesh_arch_head_s0_10Geometry = endpoint_arch_head_s0_10
    ? new THREE.CylinderGeometry(endpoint_arch_head_s0_10.endRadius, endpoint_arch_head_s0_10.baseRadius, endpoint_arch_head_s0_10.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_arch_head_s0_10) {
    mesh_arch_head_s0_10Geometry.scale(1.0, 0.16, 1.0);
  }
  const mesh_arch_head_s0_10 = new THREE.Mesh(
    mesh_arch_head_s0_10Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_head_s0_10.name = "Arch head s0";
  if (endpoint_arch_head_s0_10) {
    mesh_arch_head_s0_10.position.copy(endpoint_arch_head_s0_10.midpoint);
    mesh_arch_head_s0_10.quaternion.copy(endpoint_arch_head_s0_10.quaternion);
  }
  mesh_arch_head_s0_10.castShadow = options.castShadow ?? true;
  mesh_arch_head_s0_10.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_head_s0_10.userData.sculptComponent = {"id": "arch-head-s0", "name": "Arch head s0", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-2.4, 0.9, 3.97], "localEnd": [-2.4, 0.9, 4.13], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [-2.4, 0.9, 4.05], "rotation": [0, 0, 0], "worldPosition": [-2.4, 14.0, 4.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [0, 0, 1]};
  node_arch_head_s0_10.add(mesh_arch_head_s0_10);
  meshes["arch-head-s0"] = mesh_arch_head_s0_10;
  colliders["arch-head-s0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_head_s0_10);

  const endpoint_arch_frame_s0_11 = makeAttachmentEndpoint(null);
  const node_arch_frame_s0_11 = new THREE.Group();
  node_arch_frame_s0_11.name = "Window surround s0__pivot";
  node_arch_frame_s0_11.scale.set(1, 1, 1);
  if (endpoint_arch_frame_s0_11) {
    node_arch_frame_s0_11.position.copy(endpoint_arch_frame_s0_11.start);
    node_arch_frame_s0_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_frame_s0_11.position.set(-2.4, 0.1, 4.0);
    node_arch_frame_s0_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_frame_s0_11.userData.sculptComponent = {"id": "arch-frame-s0", "name": "Window surround s0", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-2.4, -1.6, 4.0], "localEnd": [-2.4, 1.8, 4.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.6, "height": 3.4, "depth": 0.06, "units": "m", "confidence": 0.6}, "transform": {"position": [-2.4, 0.1, 4.0], "rotation": [0, 0, 0], "worldPosition": [-2.4, 13.2, 4.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_s0_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_frame_s0_11);
  nodes["arch-frame-s0"] = node_arch_frame_s0_11;
  const mesh_arch_frame_s0_11Geometry = endpoint_arch_frame_s0_11
    ? new THREE.CylinderGeometry(endpoint_arch_frame_s0_11.endRadius, endpoint_arch_frame_s0_11.baseRadius, endpoint_arch_frame_s0_11.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_frame_s0_11) {
    mesh_arch_frame_s0_11Geometry.scale(1.6, 3.4, 0.06);
  }
  const mesh_arch_frame_s0_11 = new THREE.Mesh(
    mesh_arch_frame_s0_11Geometry,
    materialMap["trim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_frame_s0_11.name = "Window surround s0";
  if (endpoint_arch_frame_s0_11) {
    mesh_arch_frame_s0_11.position.copy(endpoint_arch_frame_s0_11.midpoint);
    mesh_arch_frame_s0_11.quaternion.copy(endpoint_arch_frame_s0_11.quaternion);
  }
  mesh_arch_frame_s0_11.castShadow = options.castShadow ?? true;
  mesh_arch_frame_s0_11.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_frame_s0_11.userData.sculptComponent = {"id": "arch-frame-s0", "name": "Window surround s0", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-2.4, -1.6, 4.0], "localEnd": [-2.4, 1.8, 4.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.6, "height": 3.4, "depth": 0.06, "units": "m", "confidence": 0.6}, "transform": {"position": [-2.4, 0.1, 4.0], "rotation": [0, 0, 0], "worldPosition": [-2.4, 13.2, 4.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_s0_11.add(mesh_arch_frame_s0_11);
  meshes["arch-frame-s0"] = mesh_arch_frame_s0_11;
  colliders["arch-frame-s0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_frame_s0_11);

  const endpoint_arch_s1_12 = makeAttachmentEndpoint(null);
  const node_arch_s1_12 = new THREE.Group();
  node_arch_s1_12.name = "Arched window s1__pivot";
  node_arch_s1_12.scale.set(1, 1, 1);
  if (endpoint_arch_s1_12) {
    node_arch_s1_12.position.copy(endpoint_arch_s1_12.start);
    node_arch_s1_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_s1_12.position.set(0.0, -0.2, 4.04);
    node_arch_s1_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_s1_12.userData.sculptComponent = {"id": "arch-s1", "name": "Arched window s1", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [0.0, -1.3, 4.04], "localEnd": [0.0, 0.9, 4.04], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.0, "height": 2.2, "depth": 0.16, "units": "m", "confidence": 0.7}, "transform": {"position": [0.0, -0.2, 4.04], "rotation": [0, 0, 0], "worldPosition": [0.0, 12.9, 4.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_s1_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_s1_12);
  nodes["arch-s1"] = node_arch_s1_12;
  const mesh_arch_s1_12Geometry = endpoint_arch_s1_12
    ? new THREE.CylinderGeometry(endpoint_arch_s1_12.endRadius, endpoint_arch_s1_12.baseRadius, endpoint_arch_s1_12.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_s1_12) {
    mesh_arch_s1_12Geometry.scale(1.0, 2.2, 0.16);
  }
  const mesh_arch_s1_12 = new THREE.Mesh(
    mesh_arch_s1_12Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_s1_12.name = "Arched window s1";
  if (endpoint_arch_s1_12) {
    mesh_arch_s1_12.position.copy(endpoint_arch_s1_12.midpoint);
    mesh_arch_s1_12.quaternion.copy(endpoint_arch_s1_12.quaternion);
  }
  mesh_arch_s1_12.castShadow = options.castShadow ?? true;
  mesh_arch_s1_12.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_s1_12.userData.sculptComponent = {"id": "arch-s1", "name": "Arched window s1", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [0.0, -1.3, 4.04], "localEnd": [0.0, 0.9, 4.04], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.0, "height": 2.2, "depth": 0.16, "units": "m", "confidence": 0.7}, "transform": {"position": [0.0, -0.2, 4.04], "rotation": [0, 0, 0], "worldPosition": [0.0, 12.9, 4.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_s1_12.add(mesh_arch_s1_12);
  meshes["arch-s1"] = mesh_arch_s1_12;
  colliders["arch-s1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_s1_12);

  const attachment_arch_head_s1_13 = {"parentSocket": "belvedere", "localStart": [0.0, 0.9, 3.97], "localEnd": [0.0, 0.9, 4.13], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5};
  const endpoint_arch_head_s1_13 = makeAttachmentEndpoint(attachment_arch_head_s1_13);
  const node_arch_head_s1_13 = new THREE.Group();
  node_arch_head_s1_13.name = "Arch head s1__pivot";
  node_arch_head_s1_13.scale.set(1, 1, 1);
  if (endpoint_arch_head_s1_13) {
    node_arch_head_s1_13.position.copy(endpoint_arch_head_s1_13.start);
    node_arch_head_s1_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_head_s1_13.position.set(0.0, 0.9, 4.05);
    node_arch_head_s1_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_head_s1_13.userData.sculptComponent = {"id": "arch-head-s1", "name": "Arch head s1", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [0.0, 0.9, 3.97], "localEnd": [0.0, 0.9, 4.13], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [0.0, 0.9, 4.05], "rotation": [0, 0, 0], "worldPosition": [0.0, 14.0, 4.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [0, 0, 1]};
  node_arch_head_s1_13.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_head_s1_13);
  nodes["arch-head-s1"] = node_arch_head_s1_13;
  const mesh_arch_head_s1_13Geometry = endpoint_arch_head_s1_13
    ? new THREE.CylinderGeometry(endpoint_arch_head_s1_13.endRadius, endpoint_arch_head_s1_13.baseRadius, endpoint_arch_head_s1_13.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_arch_head_s1_13) {
    mesh_arch_head_s1_13Geometry.scale(1.0, 0.16, 1.0);
  }
  const mesh_arch_head_s1_13 = new THREE.Mesh(
    mesh_arch_head_s1_13Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_head_s1_13.name = "Arch head s1";
  if (endpoint_arch_head_s1_13) {
    mesh_arch_head_s1_13.position.copy(endpoint_arch_head_s1_13.midpoint);
    mesh_arch_head_s1_13.quaternion.copy(endpoint_arch_head_s1_13.quaternion);
  }
  mesh_arch_head_s1_13.castShadow = options.castShadow ?? true;
  mesh_arch_head_s1_13.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_head_s1_13.userData.sculptComponent = {"id": "arch-head-s1", "name": "Arch head s1", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [0.0, 0.9, 3.97], "localEnd": [0.0, 0.9, 4.13], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [0.0, 0.9, 4.05], "rotation": [0, 0, 0], "worldPosition": [0.0, 14.0, 4.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [0, 0, 1]};
  node_arch_head_s1_13.add(mesh_arch_head_s1_13);
  meshes["arch-head-s1"] = mesh_arch_head_s1_13;
  colliders["arch-head-s1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_head_s1_13);

  const endpoint_arch_frame_s1_14 = makeAttachmentEndpoint(null);
  const node_arch_frame_s1_14 = new THREE.Group();
  node_arch_frame_s1_14.name = "Window surround s1__pivot";
  node_arch_frame_s1_14.scale.set(1, 1, 1);
  if (endpoint_arch_frame_s1_14) {
    node_arch_frame_s1_14.position.copy(endpoint_arch_frame_s1_14.start);
    node_arch_frame_s1_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_frame_s1_14.position.set(0.0, 0.1, 4.0);
    node_arch_frame_s1_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_frame_s1_14.userData.sculptComponent = {"id": "arch-frame-s1", "name": "Window surround s1", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [0.0, -1.6, 4.0], "localEnd": [0.0, 1.8, 4.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.6, "height": 3.4, "depth": 0.06, "units": "m", "confidence": 0.6}, "transform": {"position": [0.0, 0.1, 4.0], "rotation": [0, 0, 0], "worldPosition": [0.0, 13.2, 4.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_s1_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_frame_s1_14);
  nodes["arch-frame-s1"] = node_arch_frame_s1_14;
  const mesh_arch_frame_s1_14Geometry = endpoint_arch_frame_s1_14
    ? new THREE.CylinderGeometry(endpoint_arch_frame_s1_14.endRadius, endpoint_arch_frame_s1_14.baseRadius, endpoint_arch_frame_s1_14.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_frame_s1_14) {
    mesh_arch_frame_s1_14Geometry.scale(1.6, 3.4, 0.06);
  }
  const mesh_arch_frame_s1_14 = new THREE.Mesh(
    mesh_arch_frame_s1_14Geometry,
    materialMap["trim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_frame_s1_14.name = "Window surround s1";
  if (endpoint_arch_frame_s1_14) {
    mesh_arch_frame_s1_14.position.copy(endpoint_arch_frame_s1_14.midpoint);
    mesh_arch_frame_s1_14.quaternion.copy(endpoint_arch_frame_s1_14.quaternion);
  }
  mesh_arch_frame_s1_14.castShadow = options.castShadow ?? true;
  mesh_arch_frame_s1_14.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_frame_s1_14.userData.sculptComponent = {"id": "arch-frame-s1", "name": "Window surround s1", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [0.0, -1.6, 4.0], "localEnd": [0.0, 1.8, 4.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.6, "height": 3.4, "depth": 0.06, "units": "m", "confidence": 0.6}, "transform": {"position": [0.0, 0.1, 4.0], "rotation": [0, 0, 0], "worldPosition": [0.0, 13.2, 4.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_s1_14.add(mesh_arch_frame_s1_14);
  meshes["arch-frame-s1"] = mesh_arch_frame_s1_14;
  colliders["arch-frame-s1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_frame_s1_14);

  const endpoint_arch_s2_15 = makeAttachmentEndpoint(null);
  const node_arch_s2_15 = new THREE.Group();
  node_arch_s2_15.name = "Arched window s2__pivot";
  node_arch_s2_15.scale.set(1, 1, 1);
  if (endpoint_arch_s2_15) {
    node_arch_s2_15.position.copy(endpoint_arch_s2_15.start);
    node_arch_s2_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_s2_15.position.set(2.4, -0.2, 4.04);
    node_arch_s2_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_s2_15.userData.sculptComponent = {"id": "arch-s2", "name": "Arched window s2", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [2.4, -1.3, 4.04], "localEnd": [2.4, 0.9, 4.04], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.0, "height": 2.2, "depth": 0.16, "units": "m", "confidence": 0.7}, "transform": {"position": [2.4, -0.2, 4.04], "rotation": [0, 0, 0], "worldPosition": [2.4, 12.9, 4.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_s2_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_s2_15);
  nodes["arch-s2"] = node_arch_s2_15;
  const mesh_arch_s2_15Geometry = endpoint_arch_s2_15
    ? new THREE.CylinderGeometry(endpoint_arch_s2_15.endRadius, endpoint_arch_s2_15.baseRadius, endpoint_arch_s2_15.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_s2_15) {
    mesh_arch_s2_15Geometry.scale(1.0, 2.2, 0.16);
  }
  const mesh_arch_s2_15 = new THREE.Mesh(
    mesh_arch_s2_15Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_s2_15.name = "Arched window s2";
  if (endpoint_arch_s2_15) {
    mesh_arch_s2_15.position.copy(endpoint_arch_s2_15.midpoint);
    mesh_arch_s2_15.quaternion.copy(endpoint_arch_s2_15.quaternion);
  }
  mesh_arch_s2_15.castShadow = options.castShadow ?? true;
  mesh_arch_s2_15.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_s2_15.userData.sculptComponent = {"id": "arch-s2", "name": "Arched window s2", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [2.4, -1.3, 4.04], "localEnd": [2.4, 0.9, 4.04], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.0, "height": 2.2, "depth": 0.16, "units": "m", "confidence": 0.7}, "transform": {"position": [2.4, -0.2, 4.04], "rotation": [0, 0, 0], "worldPosition": [2.4, 12.9, 4.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_s2_15.add(mesh_arch_s2_15);
  meshes["arch-s2"] = mesh_arch_s2_15;
  colliders["arch-s2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_s2_15);

  const attachment_arch_head_s2_16 = {"parentSocket": "belvedere", "localStart": [2.4, 0.9, 3.97], "localEnd": [2.4, 0.9, 4.13], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5};
  const endpoint_arch_head_s2_16 = makeAttachmentEndpoint(attachment_arch_head_s2_16);
  const node_arch_head_s2_16 = new THREE.Group();
  node_arch_head_s2_16.name = "Arch head s2__pivot";
  node_arch_head_s2_16.scale.set(1, 1, 1);
  if (endpoint_arch_head_s2_16) {
    node_arch_head_s2_16.position.copy(endpoint_arch_head_s2_16.start);
    node_arch_head_s2_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_head_s2_16.position.set(2.4, 0.9, 4.05);
    node_arch_head_s2_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_head_s2_16.userData.sculptComponent = {"id": "arch-head-s2", "name": "Arch head s2", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [2.4, 0.9, 3.97], "localEnd": [2.4, 0.9, 4.13], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [2.4, 0.9, 4.05], "rotation": [0, 0, 0], "worldPosition": [2.4, 14.0, 4.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [0, 0, 1]};
  node_arch_head_s2_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_head_s2_16);
  nodes["arch-head-s2"] = node_arch_head_s2_16;
  const mesh_arch_head_s2_16Geometry = endpoint_arch_head_s2_16
    ? new THREE.CylinderGeometry(endpoint_arch_head_s2_16.endRadius, endpoint_arch_head_s2_16.baseRadius, endpoint_arch_head_s2_16.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_arch_head_s2_16) {
    mesh_arch_head_s2_16Geometry.scale(1.0, 0.16, 1.0);
  }
  const mesh_arch_head_s2_16 = new THREE.Mesh(
    mesh_arch_head_s2_16Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_head_s2_16.name = "Arch head s2";
  if (endpoint_arch_head_s2_16) {
    mesh_arch_head_s2_16.position.copy(endpoint_arch_head_s2_16.midpoint);
    mesh_arch_head_s2_16.quaternion.copy(endpoint_arch_head_s2_16.quaternion);
  }
  mesh_arch_head_s2_16.castShadow = options.castShadow ?? true;
  mesh_arch_head_s2_16.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_head_s2_16.userData.sculptComponent = {"id": "arch-head-s2", "name": "Arch head s2", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [2.4, 0.9, 3.97], "localEnd": [2.4, 0.9, 4.13], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [2.4, 0.9, 4.05], "rotation": [0, 0, 0], "worldPosition": [2.4, 14.0, 4.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [0, 0, 1]};
  node_arch_head_s2_16.add(mesh_arch_head_s2_16);
  meshes["arch-head-s2"] = mesh_arch_head_s2_16;
  colliders["arch-head-s2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_head_s2_16);

  const endpoint_arch_frame_s2_17 = makeAttachmentEndpoint(null);
  const node_arch_frame_s2_17 = new THREE.Group();
  node_arch_frame_s2_17.name = "Window surround s2__pivot";
  node_arch_frame_s2_17.scale.set(1, 1, 1);
  if (endpoint_arch_frame_s2_17) {
    node_arch_frame_s2_17.position.copy(endpoint_arch_frame_s2_17.start);
    node_arch_frame_s2_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_frame_s2_17.position.set(2.4, 0.1, 4.0);
    node_arch_frame_s2_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_frame_s2_17.userData.sculptComponent = {"id": "arch-frame-s2", "name": "Window surround s2", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [2.4, -1.6, 4.0], "localEnd": [2.4, 1.8, 4.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.6, "height": 3.4, "depth": 0.06, "units": "m", "confidence": 0.6}, "transform": {"position": [2.4, 0.1, 4.0], "rotation": [0, 0, 0], "worldPosition": [2.4, 13.2, 4.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_s2_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_frame_s2_17);
  nodes["arch-frame-s2"] = node_arch_frame_s2_17;
  const mesh_arch_frame_s2_17Geometry = endpoint_arch_frame_s2_17
    ? new THREE.CylinderGeometry(endpoint_arch_frame_s2_17.endRadius, endpoint_arch_frame_s2_17.baseRadius, endpoint_arch_frame_s2_17.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_frame_s2_17) {
    mesh_arch_frame_s2_17Geometry.scale(1.6, 3.4, 0.06);
  }
  const mesh_arch_frame_s2_17 = new THREE.Mesh(
    mesh_arch_frame_s2_17Geometry,
    materialMap["trim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_frame_s2_17.name = "Window surround s2";
  if (endpoint_arch_frame_s2_17) {
    mesh_arch_frame_s2_17.position.copy(endpoint_arch_frame_s2_17.midpoint);
    mesh_arch_frame_s2_17.quaternion.copy(endpoint_arch_frame_s2_17.quaternion);
  }
  mesh_arch_frame_s2_17.castShadow = options.castShadow ?? true;
  mesh_arch_frame_s2_17.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_frame_s2_17.userData.sculptComponent = {"id": "arch-frame-s2", "name": "Window surround s2", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [2.4, -1.6, 4.0], "localEnd": [2.4, 1.8, 4.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.6, "height": 3.4, "depth": 0.06, "units": "m", "confidence": 0.6}, "transform": {"position": [2.4, 0.1, 4.0], "rotation": [0, 0, 0], "worldPosition": [2.4, 13.2, 4.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_s2_17.add(mesh_arch_frame_s2_17);
  meshes["arch-frame-s2"] = mesh_arch_frame_s2_17;
  colliders["arch-frame-s2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_frame_s2_17);

  const endpoint_arch_n0_18 = makeAttachmentEndpoint(null);
  const node_arch_n0_18 = new THREE.Group();
  node_arch_n0_18.name = "Arched window n0__pivot";
  node_arch_n0_18.scale.set(1, 1, 1);
  if (endpoint_arch_n0_18) {
    node_arch_n0_18.position.copy(endpoint_arch_n0_18.start);
    node_arch_n0_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_n0_18.position.set(-2.4, -0.2, -4.04);
    node_arch_n0_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_n0_18.userData.sculptComponent = {"id": "arch-n0", "name": "Arched window n0", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-2.4, -1.3, -4.04], "localEnd": [-2.4, 0.9, -4.04], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.0, "height": 2.2, "depth": 0.16, "units": "m", "confidence": 0.7}, "transform": {"position": [-2.4, -0.2, -4.04], "rotation": [0, 0, 0], "worldPosition": [-2.4, 12.9, -4.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_n0_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_n0_18);
  nodes["arch-n0"] = node_arch_n0_18;
  const mesh_arch_n0_18Geometry = endpoint_arch_n0_18
    ? new THREE.CylinderGeometry(endpoint_arch_n0_18.endRadius, endpoint_arch_n0_18.baseRadius, endpoint_arch_n0_18.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_n0_18) {
    mesh_arch_n0_18Geometry.scale(1.0, 2.2, 0.16);
  }
  const mesh_arch_n0_18 = new THREE.Mesh(
    mesh_arch_n0_18Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_n0_18.name = "Arched window n0";
  if (endpoint_arch_n0_18) {
    mesh_arch_n0_18.position.copy(endpoint_arch_n0_18.midpoint);
    mesh_arch_n0_18.quaternion.copy(endpoint_arch_n0_18.quaternion);
  }
  mesh_arch_n0_18.castShadow = options.castShadow ?? true;
  mesh_arch_n0_18.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_n0_18.userData.sculptComponent = {"id": "arch-n0", "name": "Arched window n0", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-2.4, -1.3, -4.04], "localEnd": [-2.4, 0.9, -4.04], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.0, "height": 2.2, "depth": 0.16, "units": "m", "confidence": 0.7}, "transform": {"position": [-2.4, -0.2, -4.04], "rotation": [0, 0, 0], "worldPosition": [-2.4, 12.9, -4.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_n0_18.add(mesh_arch_n0_18);
  meshes["arch-n0"] = mesh_arch_n0_18;
  colliders["arch-n0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_n0_18);

  const attachment_arch_head_n0_19 = {"parentSocket": "belvedere", "localStart": [-2.4, 0.9, -3.97], "localEnd": [-2.4, 0.9, -4.13], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5};
  const endpoint_arch_head_n0_19 = makeAttachmentEndpoint(attachment_arch_head_n0_19);
  const node_arch_head_n0_19 = new THREE.Group();
  node_arch_head_n0_19.name = "Arch head n0__pivot";
  node_arch_head_n0_19.scale.set(1, 1, 1);
  if (endpoint_arch_head_n0_19) {
    node_arch_head_n0_19.position.copy(endpoint_arch_head_n0_19.start);
    node_arch_head_n0_19.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_head_n0_19.position.set(-2.4, 0.9, -4.05);
    node_arch_head_n0_19.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_head_n0_19.userData.sculptComponent = {"id": "arch-head-n0", "name": "Arch head n0", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-2.4, 0.9, -3.97], "localEnd": [-2.4, 0.9, -4.13], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [-2.4, 0.9, -4.05], "rotation": [0, 0, 0], "worldPosition": [-2.4, 14.0, -4.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [0, 0, -1]};
  node_arch_head_n0_19.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_head_n0_19);
  nodes["arch-head-n0"] = node_arch_head_n0_19;
  const mesh_arch_head_n0_19Geometry = endpoint_arch_head_n0_19
    ? new THREE.CylinderGeometry(endpoint_arch_head_n0_19.endRadius, endpoint_arch_head_n0_19.baseRadius, endpoint_arch_head_n0_19.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_arch_head_n0_19) {
    mesh_arch_head_n0_19Geometry.scale(1.0, 0.16, 1.0);
  }
  const mesh_arch_head_n0_19 = new THREE.Mesh(
    mesh_arch_head_n0_19Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_head_n0_19.name = "Arch head n0";
  if (endpoint_arch_head_n0_19) {
    mesh_arch_head_n0_19.position.copy(endpoint_arch_head_n0_19.midpoint);
    mesh_arch_head_n0_19.quaternion.copy(endpoint_arch_head_n0_19.quaternion);
  }
  mesh_arch_head_n0_19.castShadow = options.castShadow ?? true;
  mesh_arch_head_n0_19.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_head_n0_19.userData.sculptComponent = {"id": "arch-head-n0", "name": "Arch head n0", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-2.4, 0.9, -3.97], "localEnd": [-2.4, 0.9, -4.13], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [-2.4, 0.9, -4.05], "rotation": [0, 0, 0], "worldPosition": [-2.4, 14.0, -4.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [0, 0, -1]};
  node_arch_head_n0_19.add(mesh_arch_head_n0_19);
  meshes["arch-head-n0"] = mesh_arch_head_n0_19;
  colliders["arch-head-n0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_head_n0_19);

  const endpoint_arch_frame_n0_20 = makeAttachmentEndpoint(null);
  const node_arch_frame_n0_20 = new THREE.Group();
  node_arch_frame_n0_20.name = "Window surround n0__pivot";
  node_arch_frame_n0_20.scale.set(1, 1, 1);
  if (endpoint_arch_frame_n0_20) {
    node_arch_frame_n0_20.position.copy(endpoint_arch_frame_n0_20.start);
    node_arch_frame_n0_20.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_frame_n0_20.position.set(-2.4, 0.1, -4.0);
    node_arch_frame_n0_20.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_frame_n0_20.userData.sculptComponent = {"id": "arch-frame-n0", "name": "Window surround n0", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-2.4, -1.6, -4.0], "localEnd": [-2.4, 1.8, -4.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.6, "height": 3.4, "depth": 0.06, "units": "m", "confidence": 0.6}, "transform": {"position": [-2.4, 0.1, -4.0], "rotation": [0, 0, 0], "worldPosition": [-2.4, 13.2, -4.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_n0_20.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_frame_n0_20);
  nodes["arch-frame-n0"] = node_arch_frame_n0_20;
  const mesh_arch_frame_n0_20Geometry = endpoint_arch_frame_n0_20
    ? new THREE.CylinderGeometry(endpoint_arch_frame_n0_20.endRadius, endpoint_arch_frame_n0_20.baseRadius, endpoint_arch_frame_n0_20.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_frame_n0_20) {
    mesh_arch_frame_n0_20Geometry.scale(1.6, 3.4, 0.06);
  }
  const mesh_arch_frame_n0_20 = new THREE.Mesh(
    mesh_arch_frame_n0_20Geometry,
    materialMap["trim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_frame_n0_20.name = "Window surround n0";
  if (endpoint_arch_frame_n0_20) {
    mesh_arch_frame_n0_20.position.copy(endpoint_arch_frame_n0_20.midpoint);
    mesh_arch_frame_n0_20.quaternion.copy(endpoint_arch_frame_n0_20.quaternion);
  }
  mesh_arch_frame_n0_20.castShadow = options.castShadow ?? true;
  mesh_arch_frame_n0_20.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_frame_n0_20.userData.sculptComponent = {"id": "arch-frame-n0", "name": "Window surround n0", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-2.4, -1.6, -4.0], "localEnd": [-2.4, 1.8, -4.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.6, "height": 3.4, "depth": 0.06, "units": "m", "confidence": 0.6}, "transform": {"position": [-2.4, 0.1, -4.0], "rotation": [0, 0, 0], "worldPosition": [-2.4, 13.2, -4.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_n0_20.add(mesh_arch_frame_n0_20);
  meshes["arch-frame-n0"] = mesh_arch_frame_n0_20;
  colliders["arch-frame-n0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_frame_n0_20);

  const endpoint_arch_n1_21 = makeAttachmentEndpoint(null);
  const node_arch_n1_21 = new THREE.Group();
  node_arch_n1_21.name = "Arched window n1__pivot";
  node_arch_n1_21.scale.set(1, 1, 1);
  if (endpoint_arch_n1_21) {
    node_arch_n1_21.position.copy(endpoint_arch_n1_21.start);
    node_arch_n1_21.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_n1_21.position.set(0.0, -0.2, -4.04);
    node_arch_n1_21.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_n1_21.userData.sculptComponent = {"id": "arch-n1", "name": "Arched window n1", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [0.0, -1.3, -4.04], "localEnd": [0.0, 0.9, -4.04], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.0, "height": 2.2, "depth": 0.16, "units": "m", "confidence": 0.7}, "transform": {"position": [0.0, -0.2, -4.04], "rotation": [0, 0, 0], "worldPosition": [0.0, 12.9, -4.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_n1_21.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_n1_21);
  nodes["arch-n1"] = node_arch_n1_21;
  const mesh_arch_n1_21Geometry = endpoint_arch_n1_21
    ? new THREE.CylinderGeometry(endpoint_arch_n1_21.endRadius, endpoint_arch_n1_21.baseRadius, endpoint_arch_n1_21.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_n1_21) {
    mesh_arch_n1_21Geometry.scale(1.0, 2.2, 0.16);
  }
  const mesh_arch_n1_21 = new THREE.Mesh(
    mesh_arch_n1_21Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_n1_21.name = "Arched window n1";
  if (endpoint_arch_n1_21) {
    mesh_arch_n1_21.position.copy(endpoint_arch_n1_21.midpoint);
    mesh_arch_n1_21.quaternion.copy(endpoint_arch_n1_21.quaternion);
  }
  mesh_arch_n1_21.castShadow = options.castShadow ?? true;
  mesh_arch_n1_21.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_n1_21.userData.sculptComponent = {"id": "arch-n1", "name": "Arched window n1", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [0.0, -1.3, -4.04], "localEnd": [0.0, 0.9, -4.04], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.0, "height": 2.2, "depth": 0.16, "units": "m", "confidence": 0.7}, "transform": {"position": [0.0, -0.2, -4.04], "rotation": [0, 0, 0], "worldPosition": [0.0, 12.9, -4.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_n1_21.add(mesh_arch_n1_21);
  meshes["arch-n1"] = mesh_arch_n1_21;
  colliders["arch-n1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_n1_21);

  const attachment_arch_head_n1_22 = {"parentSocket": "belvedere", "localStart": [0.0, 0.9, -3.97], "localEnd": [0.0, 0.9, -4.13], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5};
  const endpoint_arch_head_n1_22 = makeAttachmentEndpoint(attachment_arch_head_n1_22);
  const node_arch_head_n1_22 = new THREE.Group();
  node_arch_head_n1_22.name = "Arch head n1__pivot";
  node_arch_head_n1_22.scale.set(1, 1, 1);
  if (endpoint_arch_head_n1_22) {
    node_arch_head_n1_22.position.copy(endpoint_arch_head_n1_22.start);
    node_arch_head_n1_22.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_head_n1_22.position.set(0.0, 0.9, -4.05);
    node_arch_head_n1_22.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_head_n1_22.userData.sculptComponent = {"id": "arch-head-n1", "name": "Arch head n1", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [0.0, 0.9, -3.97], "localEnd": [0.0, 0.9, -4.13], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [0.0, 0.9, -4.05], "rotation": [0, 0, 0], "worldPosition": [0.0, 14.0, -4.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [0, 0, -1]};
  node_arch_head_n1_22.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_head_n1_22);
  nodes["arch-head-n1"] = node_arch_head_n1_22;
  const mesh_arch_head_n1_22Geometry = endpoint_arch_head_n1_22
    ? new THREE.CylinderGeometry(endpoint_arch_head_n1_22.endRadius, endpoint_arch_head_n1_22.baseRadius, endpoint_arch_head_n1_22.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_arch_head_n1_22) {
    mesh_arch_head_n1_22Geometry.scale(1.0, 0.16, 1.0);
  }
  const mesh_arch_head_n1_22 = new THREE.Mesh(
    mesh_arch_head_n1_22Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_head_n1_22.name = "Arch head n1";
  if (endpoint_arch_head_n1_22) {
    mesh_arch_head_n1_22.position.copy(endpoint_arch_head_n1_22.midpoint);
    mesh_arch_head_n1_22.quaternion.copy(endpoint_arch_head_n1_22.quaternion);
  }
  mesh_arch_head_n1_22.castShadow = options.castShadow ?? true;
  mesh_arch_head_n1_22.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_head_n1_22.userData.sculptComponent = {"id": "arch-head-n1", "name": "Arch head n1", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [0.0, 0.9, -3.97], "localEnd": [0.0, 0.9, -4.13], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [0.0, 0.9, -4.05], "rotation": [0, 0, 0], "worldPosition": [0.0, 14.0, -4.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [0, 0, -1]};
  node_arch_head_n1_22.add(mesh_arch_head_n1_22);
  meshes["arch-head-n1"] = mesh_arch_head_n1_22;
  colliders["arch-head-n1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_head_n1_22);

  const endpoint_arch_frame_n1_23 = makeAttachmentEndpoint(null);
  const node_arch_frame_n1_23 = new THREE.Group();
  node_arch_frame_n1_23.name = "Window surround n1__pivot";
  node_arch_frame_n1_23.scale.set(1, 1, 1);
  if (endpoint_arch_frame_n1_23) {
    node_arch_frame_n1_23.position.copy(endpoint_arch_frame_n1_23.start);
    node_arch_frame_n1_23.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_frame_n1_23.position.set(0.0, 0.1, -4.0);
    node_arch_frame_n1_23.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_frame_n1_23.userData.sculptComponent = {"id": "arch-frame-n1", "name": "Window surround n1", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [0.0, -1.6, -4.0], "localEnd": [0.0, 1.8, -4.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.6, "height": 3.4, "depth": 0.06, "units": "m", "confidence": 0.6}, "transform": {"position": [0.0, 0.1, -4.0], "rotation": [0, 0, 0], "worldPosition": [0.0, 13.2, -4.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_n1_23.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_frame_n1_23);
  nodes["arch-frame-n1"] = node_arch_frame_n1_23;
  const mesh_arch_frame_n1_23Geometry = endpoint_arch_frame_n1_23
    ? new THREE.CylinderGeometry(endpoint_arch_frame_n1_23.endRadius, endpoint_arch_frame_n1_23.baseRadius, endpoint_arch_frame_n1_23.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_frame_n1_23) {
    mesh_arch_frame_n1_23Geometry.scale(1.6, 3.4, 0.06);
  }
  const mesh_arch_frame_n1_23 = new THREE.Mesh(
    mesh_arch_frame_n1_23Geometry,
    materialMap["trim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_frame_n1_23.name = "Window surround n1";
  if (endpoint_arch_frame_n1_23) {
    mesh_arch_frame_n1_23.position.copy(endpoint_arch_frame_n1_23.midpoint);
    mesh_arch_frame_n1_23.quaternion.copy(endpoint_arch_frame_n1_23.quaternion);
  }
  mesh_arch_frame_n1_23.castShadow = options.castShadow ?? true;
  mesh_arch_frame_n1_23.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_frame_n1_23.userData.sculptComponent = {"id": "arch-frame-n1", "name": "Window surround n1", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [0.0, -1.6, -4.0], "localEnd": [0.0, 1.8, -4.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.6, "height": 3.4, "depth": 0.06, "units": "m", "confidence": 0.6}, "transform": {"position": [0.0, 0.1, -4.0], "rotation": [0, 0, 0], "worldPosition": [0.0, 13.2, -4.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_n1_23.add(mesh_arch_frame_n1_23);
  meshes["arch-frame-n1"] = mesh_arch_frame_n1_23;
  colliders["arch-frame-n1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_frame_n1_23);

  const endpoint_arch_n2_24 = makeAttachmentEndpoint(null);
  const node_arch_n2_24 = new THREE.Group();
  node_arch_n2_24.name = "Arched window n2__pivot";
  node_arch_n2_24.scale.set(1, 1, 1);
  if (endpoint_arch_n2_24) {
    node_arch_n2_24.position.copy(endpoint_arch_n2_24.start);
    node_arch_n2_24.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_n2_24.position.set(2.4, -0.2, -4.04);
    node_arch_n2_24.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_n2_24.userData.sculptComponent = {"id": "arch-n2", "name": "Arched window n2", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [2.4, -1.3, -4.04], "localEnd": [2.4, 0.9, -4.04], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.0, "height": 2.2, "depth": 0.16, "units": "m", "confidence": 0.7}, "transform": {"position": [2.4, -0.2, -4.04], "rotation": [0, 0, 0], "worldPosition": [2.4, 12.9, -4.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_n2_24.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_n2_24);
  nodes["arch-n2"] = node_arch_n2_24;
  const mesh_arch_n2_24Geometry = endpoint_arch_n2_24
    ? new THREE.CylinderGeometry(endpoint_arch_n2_24.endRadius, endpoint_arch_n2_24.baseRadius, endpoint_arch_n2_24.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_n2_24) {
    mesh_arch_n2_24Geometry.scale(1.0, 2.2, 0.16);
  }
  const mesh_arch_n2_24 = new THREE.Mesh(
    mesh_arch_n2_24Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_n2_24.name = "Arched window n2";
  if (endpoint_arch_n2_24) {
    mesh_arch_n2_24.position.copy(endpoint_arch_n2_24.midpoint);
    mesh_arch_n2_24.quaternion.copy(endpoint_arch_n2_24.quaternion);
  }
  mesh_arch_n2_24.castShadow = options.castShadow ?? true;
  mesh_arch_n2_24.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_n2_24.userData.sculptComponent = {"id": "arch-n2", "name": "Arched window n2", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [2.4, -1.3, -4.04], "localEnd": [2.4, 0.9, -4.04], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.0, "height": 2.2, "depth": 0.16, "units": "m", "confidence": 0.7}, "transform": {"position": [2.4, -0.2, -4.04], "rotation": [0, 0, 0], "worldPosition": [2.4, 12.9, -4.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_n2_24.add(mesh_arch_n2_24);
  meshes["arch-n2"] = mesh_arch_n2_24;
  colliders["arch-n2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_n2_24);

  const attachment_arch_head_n2_25 = {"parentSocket": "belvedere", "localStart": [2.4, 0.9, -3.97], "localEnd": [2.4, 0.9, -4.13], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5};
  const endpoint_arch_head_n2_25 = makeAttachmentEndpoint(attachment_arch_head_n2_25);
  const node_arch_head_n2_25 = new THREE.Group();
  node_arch_head_n2_25.name = "Arch head n2__pivot";
  node_arch_head_n2_25.scale.set(1, 1, 1);
  if (endpoint_arch_head_n2_25) {
    node_arch_head_n2_25.position.copy(endpoint_arch_head_n2_25.start);
    node_arch_head_n2_25.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_head_n2_25.position.set(2.4, 0.9, -4.05);
    node_arch_head_n2_25.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_head_n2_25.userData.sculptComponent = {"id": "arch-head-n2", "name": "Arch head n2", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [2.4, 0.9, -3.97], "localEnd": [2.4, 0.9, -4.13], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [2.4, 0.9, -4.05], "rotation": [0, 0, 0], "worldPosition": [2.4, 14.0, -4.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [0, 0, -1]};
  node_arch_head_n2_25.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_head_n2_25);
  nodes["arch-head-n2"] = node_arch_head_n2_25;
  const mesh_arch_head_n2_25Geometry = endpoint_arch_head_n2_25
    ? new THREE.CylinderGeometry(endpoint_arch_head_n2_25.endRadius, endpoint_arch_head_n2_25.baseRadius, endpoint_arch_head_n2_25.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_arch_head_n2_25) {
    mesh_arch_head_n2_25Geometry.scale(1.0, 0.16, 1.0);
  }
  const mesh_arch_head_n2_25 = new THREE.Mesh(
    mesh_arch_head_n2_25Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_head_n2_25.name = "Arch head n2";
  if (endpoint_arch_head_n2_25) {
    mesh_arch_head_n2_25.position.copy(endpoint_arch_head_n2_25.midpoint);
    mesh_arch_head_n2_25.quaternion.copy(endpoint_arch_head_n2_25.quaternion);
  }
  mesh_arch_head_n2_25.castShadow = options.castShadow ?? true;
  mesh_arch_head_n2_25.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_head_n2_25.userData.sculptComponent = {"id": "arch-head-n2", "name": "Arch head n2", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [2.4, 0.9, -3.97], "localEnd": [2.4, 0.9, -4.13], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [2.4, 0.9, -4.05], "rotation": [0, 0, 0], "worldPosition": [2.4, 14.0, -4.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [0, 0, -1]};
  node_arch_head_n2_25.add(mesh_arch_head_n2_25);
  meshes["arch-head-n2"] = mesh_arch_head_n2_25;
  colliders["arch-head-n2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_head_n2_25);

  const endpoint_arch_frame_n2_26 = makeAttachmentEndpoint(null);
  const node_arch_frame_n2_26 = new THREE.Group();
  node_arch_frame_n2_26.name = "Window surround n2__pivot";
  node_arch_frame_n2_26.scale.set(1, 1, 1);
  if (endpoint_arch_frame_n2_26) {
    node_arch_frame_n2_26.position.copy(endpoint_arch_frame_n2_26.start);
    node_arch_frame_n2_26.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_frame_n2_26.position.set(2.4, 0.1, -4.0);
    node_arch_frame_n2_26.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_frame_n2_26.userData.sculptComponent = {"id": "arch-frame-n2", "name": "Window surround n2", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [2.4, -1.6, -4.0], "localEnd": [2.4, 1.8, -4.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.6, "height": 3.4, "depth": 0.06, "units": "m", "confidence": 0.6}, "transform": {"position": [2.4, 0.1, -4.0], "rotation": [0, 0, 0], "worldPosition": [2.4, 13.2, -4.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_n2_26.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_frame_n2_26);
  nodes["arch-frame-n2"] = node_arch_frame_n2_26;
  const mesh_arch_frame_n2_26Geometry = endpoint_arch_frame_n2_26
    ? new THREE.CylinderGeometry(endpoint_arch_frame_n2_26.endRadius, endpoint_arch_frame_n2_26.baseRadius, endpoint_arch_frame_n2_26.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_frame_n2_26) {
    mesh_arch_frame_n2_26Geometry.scale(1.6, 3.4, 0.06);
  }
  const mesh_arch_frame_n2_26 = new THREE.Mesh(
    mesh_arch_frame_n2_26Geometry,
    materialMap["trim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_frame_n2_26.name = "Window surround n2";
  if (endpoint_arch_frame_n2_26) {
    mesh_arch_frame_n2_26.position.copy(endpoint_arch_frame_n2_26.midpoint);
    mesh_arch_frame_n2_26.quaternion.copy(endpoint_arch_frame_n2_26.quaternion);
  }
  mesh_arch_frame_n2_26.castShadow = options.castShadow ?? true;
  mesh_arch_frame_n2_26.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_frame_n2_26.userData.sculptComponent = {"id": "arch-frame-n2", "name": "Window surround n2", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [2.4, -1.6, -4.0], "localEnd": [2.4, 1.8, -4.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 1.6, "height": 3.4, "depth": 0.06, "units": "m", "confidence": 0.6}, "transform": {"position": [2.4, 0.1, -4.0], "rotation": [0, 0, 0], "worldPosition": [2.4, 13.2, -4.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_n2_26.add(mesh_arch_frame_n2_26);
  meshes["arch-frame-n2"] = mesh_arch_frame_n2_26;
  colliders["arch-frame-n2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_frame_n2_26);

  const endpoint_arch_e0_27 = makeAttachmentEndpoint(null);
  const node_arch_e0_27 = new THREE.Group();
  node_arch_e0_27.name = "Arched window e0__pivot";
  node_arch_e0_27.scale.set(1, 1, 1);
  if (endpoint_arch_e0_27) {
    node_arch_e0_27.position.copy(endpoint_arch_e0_27.start);
    node_arch_e0_27.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_e0_27.position.set(4.04, -0.2, -2.4);
    node_arch_e0_27.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_e0_27.userData.sculptComponent = {"id": "arch-e0", "name": "Arched window e0", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [4.04, -1.3, -2.4], "localEnd": [4.04, 0.9, -2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.16, "height": 2.2, "depth": 1.0, "units": "m", "confidence": 0.7}, "transform": {"position": [4.04, -0.2, -2.4], "rotation": [0, 0, 0], "worldPosition": [4.04, 12.9, -2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_e0_27.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_e0_27);
  nodes["arch-e0"] = node_arch_e0_27;
  const mesh_arch_e0_27Geometry = endpoint_arch_e0_27
    ? new THREE.CylinderGeometry(endpoint_arch_e0_27.endRadius, endpoint_arch_e0_27.baseRadius, endpoint_arch_e0_27.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_e0_27) {
    mesh_arch_e0_27Geometry.scale(0.16, 2.2, 1.0);
  }
  const mesh_arch_e0_27 = new THREE.Mesh(
    mesh_arch_e0_27Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_e0_27.name = "Arched window e0";
  if (endpoint_arch_e0_27) {
    mesh_arch_e0_27.position.copy(endpoint_arch_e0_27.midpoint);
    mesh_arch_e0_27.quaternion.copy(endpoint_arch_e0_27.quaternion);
  }
  mesh_arch_e0_27.castShadow = options.castShadow ?? true;
  mesh_arch_e0_27.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_e0_27.userData.sculptComponent = {"id": "arch-e0", "name": "Arched window e0", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [4.04, -1.3, -2.4], "localEnd": [4.04, 0.9, -2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.16, "height": 2.2, "depth": 1.0, "units": "m", "confidence": 0.7}, "transform": {"position": [4.04, -0.2, -2.4], "rotation": [0, 0, 0], "worldPosition": [4.04, 12.9, -2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_e0_27.add(mesh_arch_e0_27);
  meshes["arch-e0"] = mesh_arch_e0_27;
  colliders["arch-e0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_e0_27);

  const attachment_arch_head_e0_28 = {"parentSocket": "belvedere", "localStart": [3.97, 0.9, -2.4], "localEnd": [4.13, 0.9, -2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5};
  const endpoint_arch_head_e0_28 = makeAttachmentEndpoint(attachment_arch_head_e0_28);
  const node_arch_head_e0_28 = new THREE.Group();
  node_arch_head_e0_28.name = "Arch head e0__pivot";
  node_arch_head_e0_28.scale.set(1, 1, 1);
  if (endpoint_arch_head_e0_28) {
    node_arch_head_e0_28.position.copy(endpoint_arch_head_e0_28.start);
    node_arch_head_e0_28.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_head_e0_28.position.set(4.05, 0.9, -2.4);
    node_arch_head_e0_28.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_head_e0_28.userData.sculptComponent = {"id": "arch-head-e0", "name": "Arch head e0", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [3.97, 0.9, -2.4], "localEnd": [4.13, 0.9, -2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [4.05, 0.9, -2.4], "rotation": [0, 0, 0], "worldPosition": [4.05, 14.0, -2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [1, 0, 0]};
  node_arch_head_e0_28.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_head_e0_28);
  nodes["arch-head-e0"] = node_arch_head_e0_28;
  const mesh_arch_head_e0_28Geometry = endpoint_arch_head_e0_28
    ? new THREE.CylinderGeometry(endpoint_arch_head_e0_28.endRadius, endpoint_arch_head_e0_28.baseRadius, endpoint_arch_head_e0_28.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_arch_head_e0_28) {
    mesh_arch_head_e0_28Geometry.scale(1.0, 0.16, 1.0);
  }
  const mesh_arch_head_e0_28 = new THREE.Mesh(
    mesh_arch_head_e0_28Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_head_e0_28.name = "Arch head e0";
  if (endpoint_arch_head_e0_28) {
    mesh_arch_head_e0_28.position.copy(endpoint_arch_head_e0_28.midpoint);
    mesh_arch_head_e0_28.quaternion.copy(endpoint_arch_head_e0_28.quaternion);
  }
  mesh_arch_head_e0_28.castShadow = options.castShadow ?? true;
  mesh_arch_head_e0_28.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_head_e0_28.userData.sculptComponent = {"id": "arch-head-e0", "name": "Arch head e0", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [3.97, 0.9, -2.4], "localEnd": [4.13, 0.9, -2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [4.05, 0.9, -2.4], "rotation": [0, 0, 0], "worldPosition": [4.05, 14.0, -2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [1, 0, 0]};
  node_arch_head_e0_28.add(mesh_arch_head_e0_28);
  meshes["arch-head-e0"] = mesh_arch_head_e0_28;
  colliders["arch-head-e0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_head_e0_28);

  const endpoint_arch_frame_e0_29 = makeAttachmentEndpoint(null);
  const node_arch_frame_e0_29 = new THREE.Group();
  node_arch_frame_e0_29.name = "Window surround e0__pivot";
  node_arch_frame_e0_29.scale.set(1, 1, 1);
  if (endpoint_arch_frame_e0_29) {
    node_arch_frame_e0_29.position.copy(endpoint_arch_frame_e0_29.start);
    node_arch_frame_e0_29.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_frame_e0_29.position.set(4.0, 0.1, -2.4);
    node_arch_frame_e0_29.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_frame_e0_29.userData.sculptComponent = {"id": "arch-frame-e0", "name": "Window surround e0", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [4.0, -1.6, -2.4], "localEnd": [4.0, 1.8, -2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.06, "height": 3.4, "depth": 1.6, "units": "m", "confidence": 0.6}, "transform": {"position": [4.0, 0.1, -2.4], "rotation": [0, 0, 0], "worldPosition": [4.0, 13.2, -2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_e0_29.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_frame_e0_29);
  nodes["arch-frame-e0"] = node_arch_frame_e0_29;
  const mesh_arch_frame_e0_29Geometry = endpoint_arch_frame_e0_29
    ? new THREE.CylinderGeometry(endpoint_arch_frame_e0_29.endRadius, endpoint_arch_frame_e0_29.baseRadius, endpoint_arch_frame_e0_29.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_frame_e0_29) {
    mesh_arch_frame_e0_29Geometry.scale(0.06, 3.4, 1.6);
  }
  const mesh_arch_frame_e0_29 = new THREE.Mesh(
    mesh_arch_frame_e0_29Geometry,
    materialMap["trim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_frame_e0_29.name = "Window surround e0";
  if (endpoint_arch_frame_e0_29) {
    mesh_arch_frame_e0_29.position.copy(endpoint_arch_frame_e0_29.midpoint);
    mesh_arch_frame_e0_29.quaternion.copy(endpoint_arch_frame_e0_29.quaternion);
  }
  mesh_arch_frame_e0_29.castShadow = options.castShadow ?? true;
  mesh_arch_frame_e0_29.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_frame_e0_29.userData.sculptComponent = {"id": "arch-frame-e0", "name": "Window surround e0", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [4.0, -1.6, -2.4], "localEnd": [4.0, 1.8, -2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.06, "height": 3.4, "depth": 1.6, "units": "m", "confidence": 0.6}, "transform": {"position": [4.0, 0.1, -2.4], "rotation": [0, 0, 0], "worldPosition": [4.0, 13.2, -2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_e0_29.add(mesh_arch_frame_e0_29);
  meshes["arch-frame-e0"] = mesh_arch_frame_e0_29;
  colliders["arch-frame-e0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_frame_e0_29);

  const endpoint_arch_e1_30 = makeAttachmentEndpoint(null);
  const node_arch_e1_30 = new THREE.Group();
  node_arch_e1_30.name = "Arched window e1__pivot";
  node_arch_e1_30.scale.set(1, 1, 1);
  if (endpoint_arch_e1_30) {
    node_arch_e1_30.position.copy(endpoint_arch_e1_30.start);
    node_arch_e1_30.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_e1_30.position.set(4.04, -0.2, 0.0);
    node_arch_e1_30.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_e1_30.userData.sculptComponent = {"id": "arch-e1", "name": "Arched window e1", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [4.04, -1.3, 0.0], "localEnd": [4.04, 0.9, 0.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.16, "height": 2.2, "depth": 1.0, "units": "m", "confidence": 0.7}, "transform": {"position": [4.04, -0.2, 0.0], "rotation": [0, 0, 0], "worldPosition": [4.04, 12.9, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_e1_30.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_e1_30);
  nodes["arch-e1"] = node_arch_e1_30;
  const mesh_arch_e1_30Geometry = endpoint_arch_e1_30
    ? new THREE.CylinderGeometry(endpoint_arch_e1_30.endRadius, endpoint_arch_e1_30.baseRadius, endpoint_arch_e1_30.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_e1_30) {
    mesh_arch_e1_30Geometry.scale(0.16, 2.2, 1.0);
  }
  const mesh_arch_e1_30 = new THREE.Mesh(
    mesh_arch_e1_30Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_e1_30.name = "Arched window e1";
  if (endpoint_arch_e1_30) {
    mesh_arch_e1_30.position.copy(endpoint_arch_e1_30.midpoint);
    mesh_arch_e1_30.quaternion.copy(endpoint_arch_e1_30.quaternion);
  }
  mesh_arch_e1_30.castShadow = options.castShadow ?? true;
  mesh_arch_e1_30.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_e1_30.userData.sculptComponent = {"id": "arch-e1", "name": "Arched window e1", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [4.04, -1.3, 0.0], "localEnd": [4.04, 0.9, 0.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.16, "height": 2.2, "depth": 1.0, "units": "m", "confidence": 0.7}, "transform": {"position": [4.04, -0.2, 0.0], "rotation": [0, 0, 0], "worldPosition": [4.04, 12.9, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_e1_30.add(mesh_arch_e1_30);
  meshes["arch-e1"] = mesh_arch_e1_30;
  colliders["arch-e1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_e1_30);

  const attachment_arch_head_e1_31 = {"parentSocket": "belvedere", "localStart": [3.97, 0.9, 0.0], "localEnd": [4.13, 0.9, 0.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5};
  const endpoint_arch_head_e1_31 = makeAttachmentEndpoint(attachment_arch_head_e1_31);
  const node_arch_head_e1_31 = new THREE.Group();
  node_arch_head_e1_31.name = "Arch head e1__pivot";
  node_arch_head_e1_31.scale.set(1, 1, 1);
  if (endpoint_arch_head_e1_31) {
    node_arch_head_e1_31.position.copy(endpoint_arch_head_e1_31.start);
    node_arch_head_e1_31.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_head_e1_31.position.set(4.05, 0.9, 0.0);
    node_arch_head_e1_31.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_head_e1_31.userData.sculptComponent = {"id": "arch-head-e1", "name": "Arch head e1", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [3.97, 0.9, 0.0], "localEnd": [4.13, 0.9, 0.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [4.05, 0.9, 0.0], "rotation": [0, 0, 0], "worldPosition": [4.05, 14.0, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [1, 0, 0]};
  node_arch_head_e1_31.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_head_e1_31);
  nodes["arch-head-e1"] = node_arch_head_e1_31;
  const mesh_arch_head_e1_31Geometry = endpoint_arch_head_e1_31
    ? new THREE.CylinderGeometry(endpoint_arch_head_e1_31.endRadius, endpoint_arch_head_e1_31.baseRadius, endpoint_arch_head_e1_31.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_arch_head_e1_31) {
    mesh_arch_head_e1_31Geometry.scale(1.0, 0.16, 1.0);
  }
  const mesh_arch_head_e1_31 = new THREE.Mesh(
    mesh_arch_head_e1_31Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_head_e1_31.name = "Arch head e1";
  if (endpoint_arch_head_e1_31) {
    mesh_arch_head_e1_31.position.copy(endpoint_arch_head_e1_31.midpoint);
    mesh_arch_head_e1_31.quaternion.copy(endpoint_arch_head_e1_31.quaternion);
  }
  mesh_arch_head_e1_31.castShadow = options.castShadow ?? true;
  mesh_arch_head_e1_31.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_head_e1_31.userData.sculptComponent = {"id": "arch-head-e1", "name": "Arch head e1", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [3.97, 0.9, 0.0], "localEnd": [4.13, 0.9, 0.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [4.05, 0.9, 0.0], "rotation": [0, 0, 0], "worldPosition": [4.05, 14.0, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [1, 0, 0]};
  node_arch_head_e1_31.add(mesh_arch_head_e1_31);
  meshes["arch-head-e1"] = mesh_arch_head_e1_31;
  colliders["arch-head-e1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_head_e1_31);

  const endpoint_arch_frame_e1_32 = makeAttachmentEndpoint(null);
  const node_arch_frame_e1_32 = new THREE.Group();
  node_arch_frame_e1_32.name = "Window surround e1__pivot";
  node_arch_frame_e1_32.scale.set(1, 1, 1);
  if (endpoint_arch_frame_e1_32) {
    node_arch_frame_e1_32.position.copy(endpoint_arch_frame_e1_32.start);
    node_arch_frame_e1_32.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_frame_e1_32.position.set(4.0, 0.1, 0.0);
    node_arch_frame_e1_32.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_frame_e1_32.userData.sculptComponent = {"id": "arch-frame-e1", "name": "Window surround e1", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [4.0, -1.6, 0.0], "localEnd": [4.0, 1.8, 0.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.06, "height": 3.4, "depth": 1.6, "units": "m", "confidence": 0.6}, "transform": {"position": [4.0, 0.1, 0.0], "rotation": [0, 0, 0], "worldPosition": [4.0, 13.2, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_e1_32.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_frame_e1_32);
  nodes["arch-frame-e1"] = node_arch_frame_e1_32;
  const mesh_arch_frame_e1_32Geometry = endpoint_arch_frame_e1_32
    ? new THREE.CylinderGeometry(endpoint_arch_frame_e1_32.endRadius, endpoint_arch_frame_e1_32.baseRadius, endpoint_arch_frame_e1_32.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_frame_e1_32) {
    mesh_arch_frame_e1_32Geometry.scale(0.06, 3.4, 1.6);
  }
  const mesh_arch_frame_e1_32 = new THREE.Mesh(
    mesh_arch_frame_e1_32Geometry,
    materialMap["trim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_frame_e1_32.name = "Window surround e1";
  if (endpoint_arch_frame_e1_32) {
    mesh_arch_frame_e1_32.position.copy(endpoint_arch_frame_e1_32.midpoint);
    mesh_arch_frame_e1_32.quaternion.copy(endpoint_arch_frame_e1_32.quaternion);
  }
  mesh_arch_frame_e1_32.castShadow = options.castShadow ?? true;
  mesh_arch_frame_e1_32.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_frame_e1_32.userData.sculptComponent = {"id": "arch-frame-e1", "name": "Window surround e1", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [4.0, -1.6, 0.0], "localEnd": [4.0, 1.8, 0.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.06, "height": 3.4, "depth": 1.6, "units": "m", "confidence": 0.6}, "transform": {"position": [4.0, 0.1, 0.0], "rotation": [0, 0, 0], "worldPosition": [4.0, 13.2, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_e1_32.add(mesh_arch_frame_e1_32);
  meshes["arch-frame-e1"] = mesh_arch_frame_e1_32;
  colliders["arch-frame-e1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_frame_e1_32);

  const endpoint_arch_e2_33 = makeAttachmentEndpoint(null);
  const node_arch_e2_33 = new THREE.Group();
  node_arch_e2_33.name = "Arched window e2__pivot";
  node_arch_e2_33.scale.set(1, 1, 1);
  if (endpoint_arch_e2_33) {
    node_arch_e2_33.position.copy(endpoint_arch_e2_33.start);
    node_arch_e2_33.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_e2_33.position.set(4.04, -0.2, 2.4);
    node_arch_e2_33.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_e2_33.userData.sculptComponent = {"id": "arch-e2", "name": "Arched window e2", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [4.04, -1.3, 2.4], "localEnd": [4.04, 0.9, 2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.16, "height": 2.2, "depth": 1.0, "units": "m", "confidence": 0.7}, "transform": {"position": [4.04, -0.2, 2.4], "rotation": [0, 0, 0], "worldPosition": [4.04, 12.9, 2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_e2_33.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_e2_33);
  nodes["arch-e2"] = node_arch_e2_33;
  const mesh_arch_e2_33Geometry = endpoint_arch_e2_33
    ? new THREE.CylinderGeometry(endpoint_arch_e2_33.endRadius, endpoint_arch_e2_33.baseRadius, endpoint_arch_e2_33.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_e2_33) {
    mesh_arch_e2_33Geometry.scale(0.16, 2.2, 1.0);
  }
  const mesh_arch_e2_33 = new THREE.Mesh(
    mesh_arch_e2_33Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_e2_33.name = "Arched window e2";
  if (endpoint_arch_e2_33) {
    mesh_arch_e2_33.position.copy(endpoint_arch_e2_33.midpoint);
    mesh_arch_e2_33.quaternion.copy(endpoint_arch_e2_33.quaternion);
  }
  mesh_arch_e2_33.castShadow = options.castShadow ?? true;
  mesh_arch_e2_33.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_e2_33.userData.sculptComponent = {"id": "arch-e2", "name": "Arched window e2", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [4.04, -1.3, 2.4], "localEnd": [4.04, 0.9, 2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.16, "height": 2.2, "depth": 1.0, "units": "m", "confidence": 0.7}, "transform": {"position": [4.04, -0.2, 2.4], "rotation": [0, 0, 0], "worldPosition": [4.04, 12.9, 2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_e2_33.add(mesh_arch_e2_33);
  meshes["arch-e2"] = mesh_arch_e2_33;
  colliders["arch-e2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_e2_33);

  const attachment_arch_head_e2_34 = {"parentSocket": "belvedere", "localStart": [3.97, 0.9, 2.4], "localEnd": [4.13, 0.9, 2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5};
  const endpoint_arch_head_e2_34 = makeAttachmentEndpoint(attachment_arch_head_e2_34);
  const node_arch_head_e2_34 = new THREE.Group();
  node_arch_head_e2_34.name = "Arch head e2__pivot";
  node_arch_head_e2_34.scale.set(1, 1, 1);
  if (endpoint_arch_head_e2_34) {
    node_arch_head_e2_34.position.copy(endpoint_arch_head_e2_34.start);
    node_arch_head_e2_34.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_head_e2_34.position.set(4.05, 0.9, 2.4);
    node_arch_head_e2_34.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_head_e2_34.userData.sculptComponent = {"id": "arch-head-e2", "name": "Arch head e2", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [3.97, 0.9, 2.4], "localEnd": [4.13, 0.9, 2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [4.05, 0.9, 2.4], "rotation": [0, 0, 0], "worldPosition": [4.05, 14.0, 2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [1, 0, 0]};
  node_arch_head_e2_34.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_head_e2_34);
  nodes["arch-head-e2"] = node_arch_head_e2_34;
  const mesh_arch_head_e2_34Geometry = endpoint_arch_head_e2_34
    ? new THREE.CylinderGeometry(endpoint_arch_head_e2_34.endRadius, endpoint_arch_head_e2_34.baseRadius, endpoint_arch_head_e2_34.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_arch_head_e2_34) {
    mesh_arch_head_e2_34Geometry.scale(1.0, 0.16, 1.0);
  }
  const mesh_arch_head_e2_34 = new THREE.Mesh(
    mesh_arch_head_e2_34Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_head_e2_34.name = "Arch head e2";
  if (endpoint_arch_head_e2_34) {
    mesh_arch_head_e2_34.position.copy(endpoint_arch_head_e2_34.midpoint);
    mesh_arch_head_e2_34.quaternion.copy(endpoint_arch_head_e2_34.quaternion);
  }
  mesh_arch_head_e2_34.castShadow = options.castShadow ?? true;
  mesh_arch_head_e2_34.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_head_e2_34.userData.sculptComponent = {"id": "arch-head-e2", "name": "Arch head e2", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [3.97, 0.9, 2.4], "localEnd": [4.13, 0.9, 2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [4.05, 0.9, 2.4], "rotation": [0, 0, 0], "worldPosition": [4.05, 14.0, 2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [1, 0, 0]};
  node_arch_head_e2_34.add(mesh_arch_head_e2_34);
  meshes["arch-head-e2"] = mesh_arch_head_e2_34;
  colliders["arch-head-e2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_head_e2_34);

  const endpoint_arch_frame_e2_35 = makeAttachmentEndpoint(null);
  const node_arch_frame_e2_35 = new THREE.Group();
  node_arch_frame_e2_35.name = "Window surround e2__pivot";
  node_arch_frame_e2_35.scale.set(1, 1, 1);
  if (endpoint_arch_frame_e2_35) {
    node_arch_frame_e2_35.position.copy(endpoint_arch_frame_e2_35.start);
    node_arch_frame_e2_35.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_frame_e2_35.position.set(4.0, 0.1, 2.4);
    node_arch_frame_e2_35.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_frame_e2_35.userData.sculptComponent = {"id": "arch-frame-e2", "name": "Window surround e2", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [4.0, -1.6, 2.4], "localEnd": [4.0, 1.8, 2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.06, "height": 3.4, "depth": 1.6, "units": "m", "confidence": 0.6}, "transform": {"position": [4.0, 0.1, 2.4], "rotation": [0, 0, 0], "worldPosition": [4.0, 13.2, 2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_e2_35.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_frame_e2_35);
  nodes["arch-frame-e2"] = node_arch_frame_e2_35;
  const mesh_arch_frame_e2_35Geometry = endpoint_arch_frame_e2_35
    ? new THREE.CylinderGeometry(endpoint_arch_frame_e2_35.endRadius, endpoint_arch_frame_e2_35.baseRadius, endpoint_arch_frame_e2_35.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_frame_e2_35) {
    mesh_arch_frame_e2_35Geometry.scale(0.06, 3.4, 1.6);
  }
  const mesh_arch_frame_e2_35 = new THREE.Mesh(
    mesh_arch_frame_e2_35Geometry,
    materialMap["trim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_frame_e2_35.name = "Window surround e2";
  if (endpoint_arch_frame_e2_35) {
    mesh_arch_frame_e2_35.position.copy(endpoint_arch_frame_e2_35.midpoint);
    mesh_arch_frame_e2_35.quaternion.copy(endpoint_arch_frame_e2_35.quaternion);
  }
  mesh_arch_frame_e2_35.castShadow = options.castShadow ?? true;
  mesh_arch_frame_e2_35.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_frame_e2_35.userData.sculptComponent = {"id": "arch-frame-e2", "name": "Window surround e2", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [4.0, -1.6, 2.4], "localEnd": [4.0, 1.8, 2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.06, "height": 3.4, "depth": 1.6, "units": "m", "confidence": 0.6}, "transform": {"position": [4.0, 0.1, 2.4], "rotation": [0, 0, 0], "worldPosition": [4.0, 13.2, 2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_e2_35.add(mesh_arch_frame_e2_35);
  meshes["arch-frame-e2"] = mesh_arch_frame_e2_35;
  colliders["arch-frame-e2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_frame_e2_35);

  const endpoint_arch_w0_36 = makeAttachmentEndpoint(null);
  const node_arch_w0_36 = new THREE.Group();
  node_arch_w0_36.name = "Arched window w0__pivot";
  node_arch_w0_36.scale.set(1, 1, 1);
  if (endpoint_arch_w0_36) {
    node_arch_w0_36.position.copy(endpoint_arch_w0_36.start);
    node_arch_w0_36.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_w0_36.position.set(-4.04, -0.2, -2.4);
    node_arch_w0_36.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_w0_36.userData.sculptComponent = {"id": "arch-w0", "name": "Arched window w0", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-4.04, -1.3, -2.4], "localEnd": [-4.04, 0.9, -2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.16, "height": 2.2, "depth": 1.0, "units": "m", "confidence": 0.7}, "transform": {"position": [-4.04, -0.2, -2.4], "rotation": [0, 0, 0], "worldPosition": [-4.04, 12.9, -2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_w0_36.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_w0_36);
  nodes["arch-w0"] = node_arch_w0_36;
  const mesh_arch_w0_36Geometry = endpoint_arch_w0_36
    ? new THREE.CylinderGeometry(endpoint_arch_w0_36.endRadius, endpoint_arch_w0_36.baseRadius, endpoint_arch_w0_36.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_w0_36) {
    mesh_arch_w0_36Geometry.scale(0.16, 2.2, 1.0);
  }
  const mesh_arch_w0_36 = new THREE.Mesh(
    mesh_arch_w0_36Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_w0_36.name = "Arched window w0";
  if (endpoint_arch_w0_36) {
    mesh_arch_w0_36.position.copy(endpoint_arch_w0_36.midpoint);
    mesh_arch_w0_36.quaternion.copy(endpoint_arch_w0_36.quaternion);
  }
  mesh_arch_w0_36.castShadow = options.castShadow ?? true;
  mesh_arch_w0_36.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_w0_36.userData.sculptComponent = {"id": "arch-w0", "name": "Arched window w0", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-4.04, -1.3, -2.4], "localEnd": [-4.04, 0.9, -2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.16, "height": 2.2, "depth": 1.0, "units": "m", "confidence": 0.7}, "transform": {"position": [-4.04, -0.2, -2.4], "rotation": [0, 0, 0], "worldPosition": [-4.04, 12.9, -2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_w0_36.add(mesh_arch_w0_36);
  meshes["arch-w0"] = mesh_arch_w0_36;
  colliders["arch-w0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_w0_36);

  const attachment_arch_head_w0_37 = {"parentSocket": "belvedere", "localStart": [-3.97, 0.9, -2.4], "localEnd": [-4.13, 0.9, -2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5};
  const endpoint_arch_head_w0_37 = makeAttachmentEndpoint(attachment_arch_head_w0_37);
  const node_arch_head_w0_37 = new THREE.Group();
  node_arch_head_w0_37.name = "Arch head w0__pivot";
  node_arch_head_w0_37.scale.set(1, 1, 1);
  if (endpoint_arch_head_w0_37) {
    node_arch_head_w0_37.position.copy(endpoint_arch_head_w0_37.start);
    node_arch_head_w0_37.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_head_w0_37.position.set(-4.05, 0.9, -2.4);
    node_arch_head_w0_37.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_head_w0_37.userData.sculptComponent = {"id": "arch-head-w0", "name": "Arch head w0", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-3.97, 0.9, -2.4], "localEnd": [-4.13, 0.9, -2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [-4.05, 0.9, -2.4], "rotation": [0, 0, 0], "worldPosition": [-4.05, 14.0, -2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [-1, 0, 0]};
  node_arch_head_w0_37.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_head_w0_37);
  nodes["arch-head-w0"] = node_arch_head_w0_37;
  const mesh_arch_head_w0_37Geometry = endpoint_arch_head_w0_37
    ? new THREE.CylinderGeometry(endpoint_arch_head_w0_37.endRadius, endpoint_arch_head_w0_37.baseRadius, endpoint_arch_head_w0_37.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_arch_head_w0_37) {
    mesh_arch_head_w0_37Geometry.scale(1.0, 0.16, 1.0);
  }
  const mesh_arch_head_w0_37 = new THREE.Mesh(
    mesh_arch_head_w0_37Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_head_w0_37.name = "Arch head w0";
  if (endpoint_arch_head_w0_37) {
    mesh_arch_head_w0_37.position.copy(endpoint_arch_head_w0_37.midpoint);
    mesh_arch_head_w0_37.quaternion.copy(endpoint_arch_head_w0_37.quaternion);
  }
  mesh_arch_head_w0_37.castShadow = options.castShadow ?? true;
  mesh_arch_head_w0_37.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_head_w0_37.userData.sculptComponent = {"id": "arch-head-w0", "name": "Arch head w0", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-3.97, 0.9, -2.4], "localEnd": [-4.13, 0.9, -2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [-4.05, 0.9, -2.4], "rotation": [0, 0, 0], "worldPosition": [-4.05, 14.0, -2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [-1, 0, 0]};
  node_arch_head_w0_37.add(mesh_arch_head_w0_37);
  meshes["arch-head-w0"] = mesh_arch_head_w0_37;
  colliders["arch-head-w0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_head_w0_37);

  const endpoint_arch_frame_w0_38 = makeAttachmentEndpoint(null);
  const node_arch_frame_w0_38 = new THREE.Group();
  node_arch_frame_w0_38.name = "Window surround w0__pivot";
  node_arch_frame_w0_38.scale.set(1, 1, 1);
  if (endpoint_arch_frame_w0_38) {
    node_arch_frame_w0_38.position.copy(endpoint_arch_frame_w0_38.start);
    node_arch_frame_w0_38.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_frame_w0_38.position.set(-4.0, 0.1, -2.4);
    node_arch_frame_w0_38.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_frame_w0_38.userData.sculptComponent = {"id": "arch-frame-w0", "name": "Window surround w0", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-4.0, -1.6, -2.4], "localEnd": [-4.0, 1.8, -2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.06, "height": 3.4, "depth": 1.6, "units": "m", "confidence": 0.6}, "transform": {"position": [-4.0, 0.1, -2.4], "rotation": [0, 0, 0], "worldPosition": [-4.0, 13.2, -2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_w0_38.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_frame_w0_38);
  nodes["arch-frame-w0"] = node_arch_frame_w0_38;
  const mesh_arch_frame_w0_38Geometry = endpoint_arch_frame_w0_38
    ? new THREE.CylinderGeometry(endpoint_arch_frame_w0_38.endRadius, endpoint_arch_frame_w0_38.baseRadius, endpoint_arch_frame_w0_38.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_frame_w0_38) {
    mesh_arch_frame_w0_38Geometry.scale(0.06, 3.4, 1.6);
  }
  const mesh_arch_frame_w0_38 = new THREE.Mesh(
    mesh_arch_frame_w0_38Geometry,
    materialMap["trim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_frame_w0_38.name = "Window surround w0";
  if (endpoint_arch_frame_w0_38) {
    mesh_arch_frame_w0_38.position.copy(endpoint_arch_frame_w0_38.midpoint);
    mesh_arch_frame_w0_38.quaternion.copy(endpoint_arch_frame_w0_38.quaternion);
  }
  mesh_arch_frame_w0_38.castShadow = options.castShadow ?? true;
  mesh_arch_frame_w0_38.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_frame_w0_38.userData.sculptComponent = {"id": "arch-frame-w0", "name": "Window surround w0", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-4.0, -1.6, -2.4], "localEnd": [-4.0, 1.8, -2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.06, "height": 3.4, "depth": 1.6, "units": "m", "confidence": 0.6}, "transform": {"position": [-4.0, 0.1, -2.4], "rotation": [0, 0, 0], "worldPosition": [-4.0, 13.2, -2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_w0_38.add(mesh_arch_frame_w0_38);
  meshes["arch-frame-w0"] = mesh_arch_frame_w0_38;
  colliders["arch-frame-w0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_frame_w0_38);

  const endpoint_arch_w1_39 = makeAttachmentEndpoint(null);
  const node_arch_w1_39 = new THREE.Group();
  node_arch_w1_39.name = "Arched window w1__pivot";
  node_arch_w1_39.scale.set(1, 1, 1);
  if (endpoint_arch_w1_39) {
    node_arch_w1_39.position.copy(endpoint_arch_w1_39.start);
    node_arch_w1_39.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_w1_39.position.set(-4.04, -0.2, 0.0);
    node_arch_w1_39.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_w1_39.userData.sculptComponent = {"id": "arch-w1", "name": "Arched window w1", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-4.04, -1.3, 0.0], "localEnd": [-4.04, 0.9, 0.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.16, "height": 2.2, "depth": 1.0, "units": "m", "confidence": 0.7}, "transform": {"position": [-4.04, -0.2, 0.0], "rotation": [0, 0, 0], "worldPosition": [-4.04, 12.9, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_w1_39.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_w1_39);
  nodes["arch-w1"] = node_arch_w1_39;
  const mesh_arch_w1_39Geometry = endpoint_arch_w1_39
    ? new THREE.CylinderGeometry(endpoint_arch_w1_39.endRadius, endpoint_arch_w1_39.baseRadius, endpoint_arch_w1_39.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_w1_39) {
    mesh_arch_w1_39Geometry.scale(0.16, 2.2, 1.0);
  }
  const mesh_arch_w1_39 = new THREE.Mesh(
    mesh_arch_w1_39Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_w1_39.name = "Arched window w1";
  if (endpoint_arch_w1_39) {
    mesh_arch_w1_39.position.copy(endpoint_arch_w1_39.midpoint);
    mesh_arch_w1_39.quaternion.copy(endpoint_arch_w1_39.quaternion);
  }
  mesh_arch_w1_39.castShadow = options.castShadow ?? true;
  mesh_arch_w1_39.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_w1_39.userData.sculptComponent = {"id": "arch-w1", "name": "Arched window w1", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-4.04, -1.3, 0.0], "localEnd": [-4.04, 0.9, 0.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.16, "height": 2.2, "depth": 1.0, "units": "m", "confidence": 0.7}, "transform": {"position": [-4.04, -0.2, 0.0], "rotation": [0, 0, 0], "worldPosition": [-4.04, 12.9, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_w1_39.add(mesh_arch_w1_39);
  meshes["arch-w1"] = mesh_arch_w1_39;
  colliders["arch-w1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_w1_39);

  const attachment_arch_head_w1_40 = {"parentSocket": "belvedere", "localStart": [-3.97, 0.9, 0.0], "localEnd": [-4.13, 0.9, 0.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5};
  const endpoint_arch_head_w1_40 = makeAttachmentEndpoint(attachment_arch_head_w1_40);
  const node_arch_head_w1_40 = new THREE.Group();
  node_arch_head_w1_40.name = "Arch head w1__pivot";
  node_arch_head_w1_40.scale.set(1, 1, 1);
  if (endpoint_arch_head_w1_40) {
    node_arch_head_w1_40.position.copy(endpoint_arch_head_w1_40.start);
    node_arch_head_w1_40.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_head_w1_40.position.set(-4.05, 0.9, 0.0);
    node_arch_head_w1_40.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_head_w1_40.userData.sculptComponent = {"id": "arch-head-w1", "name": "Arch head w1", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-3.97, 0.9, 0.0], "localEnd": [-4.13, 0.9, 0.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [-4.05, 0.9, 0.0], "rotation": [0, 0, 0], "worldPosition": [-4.05, 14.0, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [-1, 0, 0]};
  node_arch_head_w1_40.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_head_w1_40);
  nodes["arch-head-w1"] = node_arch_head_w1_40;
  const mesh_arch_head_w1_40Geometry = endpoint_arch_head_w1_40
    ? new THREE.CylinderGeometry(endpoint_arch_head_w1_40.endRadius, endpoint_arch_head_w1_40.baseRadius, endpoint_arch_head_w1_40.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_arch_head_w1_40) {
    mesh_arch_head_w1_40Geometry.scale(1.0, 0.16, 1.0);
  }
  const mesh_arch_head_w1_40 = new THREE.Mesh(
    mesh_arch_head_w1_40Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_head_w1_40.name = "Arch head w1";
  if (endpoint_arch_head_w1_40) {
    mesh_arch_head_w1_40.position.copy(endpoint_arch_head_w1_40.midpoint);
    mesh_arch_head_w1_40.quaternion.copy(endpoint_arch_head_w1_40.quaternion);
  }
  mesh_arch_head_w1_40.castShadow = options.castShadow ?? true;
  mesh_arch_head_w1_40.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_head_w1_40.userData.sculptComponent = {"id": "arch-head-w1", "name": "Arch head w1", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-3.97, 0.9, 0.0], "localEnd": [-4.13, 0.9, 0.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [-4.05, 0.9, 0.0], "rotation": [0, 0, 0], "worldPosition": [-4.05, 14.0, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [-1, 0, 0]};
  node_arch_head_w1_40.add(mesh_arch_head_w1_40);
  meshes["arch-head-w1"] = mesh_arch_head_w1_40;
  colliders["arch-head-w1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_head_w1_40);

  const endpoint_arch_frame_w1_41 = makeAttachmentEndpoint(null);
  const node_arch_frame_w1_41 = new THREE.Group();
  node_arch_frame_w1_41.name = "Window surround w1__pivot";
  node_arch_frame_w1_41.scale.set(1, 1, 1);
  if (endpoint_arch_frame_w1_41) {
    node_arch_frame_w1_41.position.copy(endpoint_arch_frame_w1_41.start);
    node_arch_frame_w1_41.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_frame_w1_41.position.set(-4.0, 0.1, 0.0);
    node_arch_frame_w1_41.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_frame_w1_41.userData.sculptComponent = {"id": "arch-frame-w1", "name": "Window surround w1", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-4.0, -1.6, 0.0], "localEnd": [-4.0, 1.8, 0.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.06, "height": 3.4, "depth": 1.6, "units": "m", "confidence": 0.6}, "transform": {"position": [-4.0, 0.1, 0.0], "rotation": [0, 0, 0], "worldPosition": [-4.0, 13.2, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_w1_41.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_frame_w1_41);
  nodes["arch-frame-w1"] = node_arch_frame_w1_41;
  const mesh_arch_frame_w1_41Geometry = endpoint_arch_frame_w1_41
    ? new THREE.CylinderGeometry(endpoint_arch_frame_w1_41.endRadius, endpoint_arch_frame_w1_41.baseRadius, endpoint_arch_frame_w1_41.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_frame_w1_41) {
    mesh_arch_frame_w1_41Geometry.scale(0.06, 3.4, 1.6);
  }
  const mesh_arch_frame_w1_41 = new THREE.Mesh(
    mesh_arch_frame_w1_41Geometry,
    materialMap["trim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_frame_w1_41.name = "Window surround w1";
  if (endpoint_arch_frame_w1_41) {
    mesh_arch_frame_w1_41.position.copy(endpoint_arch_frame_w1_41.midpoint);
    mesh_arch_frame_w1_41.quaternion.copy(endpoint_arch_frame_w1_41.quaternion);
  }
  mesh_arch_frame_w1_41.castShadow = options.castShadow ?? true;
  mesh_arch_frame_w1_41.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_frame_w1_41.userData.sculptComponent = {"id": "arch-frame-w1", "name": "Window surround w1", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-4.0, -1.6, 0.0], "localEnd": [-4.0, 1.8, 0.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.06, "height": 3.4, "depth": 1.6, "units": "m", "confidence": 0.6}, "transform": {"position": [-4.0, 0.1, 0.0], "rotation": [0, 0, 0], "worldPosition": [-4.0, 13.2, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_w1_41.add(mesh_arch_frame_w1_41);
  meshes["arch-frame-w1"] = mesh_arch_frame_w1_41;
  colliders["arch-frame-w1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_frame_w1_41);

  const endpoint_arch_w2_42 = makeAttachmentEndpoint(null);
  const node_arch_w2_42 = new THREE.Group();
  node_arch_w2_42.name = "Arched window w2__pivot";
  node_arch_w2_42.scale.set(1, 1, 1);
  if (endpoint_arch_w2_42) {
    node_arch_w2_42.position.copy(endpoint_arch_w2_42.start);
    node_arch_w2_42.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_w2_42.position.set(-4.04, -0.2, 2.4);
    node_arch_w2_42.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_w2_42.userData.sculptComponent = {"id": "arch-w2", "name": "Arched window w2", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-4.04, -1.3, 2.4], "localEnd": [-4.04, 0.9, 2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.16, "height": 2.2, "depth": 1.0, "units": "m", "confidence": 0.7}, "transform": {"position": [-4.04, -0.2, 2.4], "rotation": [0, 0, 0], "worldPosition": [-4.04, 12.9, 2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_w2_42.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_w2_42);
  nodes["arch-w2"] = node_arch_w2_42;
  const mesh_arch_w2_42Geometry = endpoint_arch_w2_42
    ? new THREE.CylinderGeometry(endpoint_arch_w2_42.endRadius, endpoint_arch_w2_42.baseRadius, endpoint_arch_w2_42.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_w2_42) {
    mesh_arch_w2_42Geometry.scale(0.16, 2.2, 1.0);
  }
  const mesh_arch_w2_42 = new THREE.Mesh(
    mesh_arch_w2_42Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_w2_42.name = "Arched window w2";
  if (endpoint_arch_w2_42) {
    mesh_arch_w2_42.position.copy(endpoint_arch_w2_42.midpoint);
    mesh_arch_w2_42.quaternion.copy(endpoint_arch_w2_42.quaternion);
  }
  mesh_arch_w2_42.castShadow = options.castShadow ?? true;
  mesh_arch_w2_42.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_w2_42.userData.sculptComponent = {"id": "arch-w2", "name": "Arched window w2", "level": "micro", "role": "detail", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The straight part of a round-headed window recess; a thin dark box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-4.04, -1.3, 2.4], "localEnd": [-4.04, 0.9, 2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.16, "height": 2.2, "depth": 1.0, "units": "m", "confidence": 0.7}, "transform": {"position": [-4.04, -0.2, 2.4], "rotation": [0, 0, 0], "worldPosition": [-4.04, 12.9, 2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_w2_42.add(mesh_arch_w2_42);
  meshes["arch-w2"] = mesh_arch_w2_42;
  colliders["arch-w2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_w2_42);

  const attachment_arch_head_w2_43 = {"parentSocket": "belvedere", "localStart": [-3.97, 0.9, 2.4], "localEnd": [-4.13, 0.9, 2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5};
  const endpoint_arch_head_w2_43 = makeAttachmentEndpoint(attachment_arch_head_w2_43);
  const node_arch_head_w2_43 = new THREE.Group();
  node_arch_head_w2_43.name = "Arch head w2__pivot";
  node_arch_head_w2_43.scale.set(1, 1, 1);
  if (endpoint_arch_head_w2_43) {
    node_arch_head_w2_43.position.copy(endpoint_arch_head_w2_43.start);
    node_arch_head_w2_43.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_head_w2_43.position.set(-4.05, 0.9, 2.4);
    node_arch_head_w2_43.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_head_w2_43.userData.sculptComponent = {"id": "arch-head-w2", "name": "Arch head w2", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-3.97, 0.9, 2.4], "localEnd": [-4.13, 0.9, 2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [-4.05, 0.9, 2.4], "rotation": [0, 0, 0], "worldPosition": [-4.05, 14.0, 2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [-1, 0, 0]};
  node_arch_head_w2_43.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_head_w2_43);
  nodes["arch-head-w2"] = node_arch_head_w2_43;
  const mesh_arch_head_w2_43Geometry = endpoint_arch_head_w2_43
    ? new THREE.CylinderGeometry(endpoint_arch_head_w2_43.endRadius, endpoint_arch_head_w2_43.baseRadius, endpoint_arch_head_w2_43.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_arch_head_w2_43) {
    mesh_arch_head_w2_43Geometry.scale(1.0, 0.16, 1.0);
  }
  const mesh_arch_head_w2_43 = new THREE.Mesh(
    mesh_arch_head_w2_43Geometry,
    materialMap["glass-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_head_w2_43.name = "Arch head w2";
  if (endpoint_arch_head_w2_43) {
    mesh_arch_head_w2_43.position.copy(endpoint_arch_head_w2_43.midpoint);
    mesh_arch_head_w2_43.quaternion.copy(endpoint_arch_head_w2_43.quaternion);
  }
  mesh_arch_head_w2_43.castShadow = options.castShadow ?? true;
  mesh_arch_head_w2_43.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_head_w2_43.userData.sculptComponent = {"id": "arch-head-w2", "name": "Arch head w2", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The round head of the window: a thin disc on the face normal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-3.97, 0.9, 2.4], "localEnd": [-4.13, 0.9, 2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02, "baseRadius": 0.5, "endRadius": 0.5}, "dimensions": {"width": 1.0, "height": 0.16, "depth": 1.0, "units": "m", "confidence": 0.7, "radius": 0.5}, "transform": {"position": [-4.05, 0.9, 2.4], "rotation": [0, 0, 0], "worldPosition": [-4.05, 14.0, 2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass-dark", "materialLayers": ["glass-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "glass-dark", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "glass-dark", "dominantAlbedo": "rgba(44, 52, 64, 1.0)", "secondaryAlbedo": "rgba(37, 44, 54, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}, "discAxis": [-1, 0, 0]};
  node_arch_head_w2_43.add(mesh_arch_head_w2_43);
  meshes["arch-head-w2"] = mesh_arch_head_w2_43;
  colliders["arch-head-w2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_head_w2_43);

  const endpoint_arch_frame_w2_44 = makeAttachmentEndpoint(null);
  const node_arch_frame_w2_44 = new THREE.Group();
  node_arch_frame_w2_44.name = "Window surround w2__pivot";
  node_arch_frame_w2_44.scale.set(1, 1, 1);
  if (endpoint_arch_frame_w2_44) {
    node_arch_frame_w2_44.position.copy(endpoint_arch_frame_w2_44.start);
    node_arch_frame_w2_44.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_frame_w2_44.position.set(-4.0, 0.1, 2.4);
    node_arch_frame_w2_44.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_frame_w2_44.userData.sculptComponent = {"id": "arch-frame-w2", "name": "Window surround w2", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-4.0, -1.6, 2.4], "localEnd": [-4.0, 1.8, 2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.06, "height": 3.4, "depth": 1.6, "units": "m", "confidence": 0.6}, "transform": {"position": [-4.0, 0.1, 2.4], "rotation": [0, 0, 0], "worldPosition": [-4.0, 13.2, 2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_w2_44.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["belvedere"] ?? root).add(node_arch_frame_w2_44);
  nodes["arch-frame-w2"] = node_arch_frame_w2_44;
  const mesh_arch_frame_w2_44Geometry = endpoint_arch_frame_w2_44
    ? new THREE.CylinderGeometry(endpoint_arch_frame_w2_44.endRadius, endpoint_arch_frame_w2_44.baseRadius, endpoint_arch_frame_w2_44.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_arch_frame_w2_44) {
    mesh_arch_frame_w2_44Geometry.scale(0.06, 3.4, 1.6);
  }
  const mesh_arch_frame_w2_44 = new THREE.Mesh(
    mesh_arch_frame_w2_44Geometry,
    materialMap["trim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_frame_w2_44.name = "Window surround w2";
  if (endpoint_arch_frame_w2_44) {
    mesh_arch_frame_w2_44.position.copy(endpoint_arch_frame_w2_44.midpoint);
    mesh_arch_frame_w2_44.quaternion.copy(endpoint_arch_frame_w2_44.quaternion);
  }
  mesh_arch_frame_w2_44.castShadow = options.castShadow ?? true;
  mesh_arch_frame_w2_44.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_frame_w2_44.userData.sculptComponent = {"id": "arch-frame-w2", "name": "Window surround w2", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat white surround behind the window; a thin box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "belvedere", "attachment": {"parentSocket": "belvedere", "localStart": [-4.0, -1.6, 2.4], "localEnd": [-4.0, 1.8, 2.4], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02}, "dimensions": {"width": 0.06, "height": 3.4, "depth": 1.6, "units": "m", "confidence": 0.6}, "transform": {"position": [-4.0, 0.1, 2.4], "rotation": [0, 0, 0], "worldPosition": [-4.0, 13.2, 2.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trim", "materialLayers": ["trim"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "materialId": "trim", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "brick"}, "materialRegions": [{"regionId": "brick", "materialId": "brick", "profileId": "stone.natural", "crop": {"path": "/Users/william-meroxa/Development/atl-arcade/.claude/worktrees/interesting-jennings-64cf2f/landmarks/ponce-city-market/material-evidence/00-brick.png", "bbox": {"x": 1900, "y": 1100, "width": 300, "height": 220}, "sourceWidth": 4000, "sourceHeight": 2250, "loaderWarnings": [], "coverage": 0.0073}}], "colorMaterialRecipe": {"materialId": "trim", "dominantAlbedo": "rgba(220, 214, 202, 1.0)", "secondaryAlbedo": "rgba(187, 181, 171, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "notes": "Flat toon color; the game bakes it into vertex colors."}};
  node_arch_frame_w2_44.add(mesh_arch_frame_w2_44);
  meshes["arch-frame-w2"] = mesh_arch_frame_w2_44;
  colliders["arch-frame-w2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_arch_frame_w2_44);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createPonceCityMarketLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Ponce City Market look-dev lights";
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
export function createPonceCityMarketEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function framePonceCityMarketCamera(
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
export function createPonceCityMarketPresentationComposer(
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

export function configurePonceCityMarketRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createPonceCityMarketInspectControls(
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
