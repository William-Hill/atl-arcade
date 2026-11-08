import * as THREE from "three";
import { DISTRICT_LOOKS, districtWeights, hexToLinear } from "../pbr-palette.js";
import {
  FX,
  LINE_COLOR,
  accentEmissive,
  addBurst,
  burstEnvelope,
  burstSpecs,
  createFx,
  effectTriggers,
  effectsPolicy,
  impactFrameDone,
  impactSpikes,
  speedLineSegments,
  startImpact,
  stepFx,
} from "./fx.js";

// Comic effects (#113): the render layer. The pure logic is in fx.js.
//
// Two meshes, each one draw call, and each hidden when it has nothing to
// draw, so the layer costs 0 draw calls when no effect runs:
// - the screen mesh: speed lines and impact spikes as quads in clip space
//   (one instanced quad per streak or spike);
// - the burst mesh: star, ring and petal billboards in the world (one
//   instanced quad per particle).
//
// Both are emissive overlays in the scene: they draw after the scene, read
// no light, write no depth, and do not change any material or the grade.
// They go through the bloom pass, so only a value over the bloom threshold
// glows: the star core (FX.emissive.core). userData.overlay keeps them out
// of the GTAO depth and normals (src/render/post.js), so the toon ink and
// the AO do not see them.
//
// Other systems spawn their own particles with burst() (the landmark
// claim, #221) and read `policy` for the tier and reduced-motion gates.

const SCREEN_MAX = 40;
const SHAPES = { star: 0, ring: 1, petal: 2 };

// Clip-space quads: corner.x (position.x) goes 0..1 along the segment, corner.y -1..1
// across it. `seg` is the segment in NDC, `width` the widths in px at each
// end and the style (0 a streak that fades at both ends, 1 a spike).
const screenVertex = /* glsl */ `
  attribute vec4 seg;
  attribute vec3 width;
  attribute vec4 tint;
  uniform vec2 uRes;
  varying vec2 vUv;
  varying vec4 vTint;
  varying float vStyle;
  void main() {
    vec2 corner = position.xy;
    vec2 hres = uRes * 0.5;
    vec2 a = seg.xy * hres;
    vec2 b = seg.zw * hres;
    vec2 d = normalize(b - a + vec2(1e-6, 0.0));
    vec2 n = vec2(-d.y, d.x);
    float w = mix(width.x, width.y, corner.x);
    vec2 p = mix(a, b, corner.x) + n * corner.y * w * 0.5;
    gl_Position = vec4(p / hres, 0.0, 1.0);
    vUv = corner;
    vTint = tint;
    vStyle = width.z;
  }`;

const screenFragment = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vTint;
  varying float vStyle;
  void main() {
    float across = 1.0 - smoothstep(0.55, 1.0, abs(vUv.y));
    // A streak fades in at the inner end and out at the outer end; a spike
    // is solid with a soft tip.
    float along = vStyle < 0.5 ? smoothstep(0.0, 0.35, vUv.x) * (1.0 - smoothstep(0.75, 1.0, vUv.x)) : 1.0 - smoothstep(0.85, 1.0, vUv.x);
    float a = vTint.a * across * along;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vTint.rgb, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// World quads. params: size (m), alpha, shape, core gain; orient: the
// rotation and 1 for a quad flat on the ground.
const burstVertex = /* glsl */ `
  attribute vec3 center;
  attribute vec3 color;
  attribute vec4 params;
  attribute vec2 orient;
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec4 vParams;
  void main() {
    vec2 corner = position.xy;
    float c = cos(orient.x);
    float s = sin(orient.x);
    vec2 q = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * params.x;
    vec4 mv;
    // orient.y 1: flat on the ground (a decal); 0: a billboard.
    if (orient.y > 0.5) mv = modelViewMatrix * vec4(center + vec3(q.x, 0.0, q.y), 1.0);
    else {
      mv = modelViewMatrix * vec4(center, 1.0);
      mv.xy += q;
    }
    gl_Position = projectionMatrix * mv;
    vUv = corner;
    vColor = color;
    vParams = params;
  }`;

const burstFragment = /* glsl */ `
  uniform vec3 uCore;
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec4 vParams;
  void main() {
    float r = length(vUv);
    float shape = vParams.z;
    float aa = 0.06;
    float m;
    if (shape < 0.5) {
      // A 5-point star.
      float th = atan(vUv.y, vUv.x) + 1.5707963;
      float t = 0.5 + 0.5 * cos(5.0 * th);
      float rs = 0.36 + 0.6 * t * t * t;
      m = 1.0 - smoothstep(rs - aa, rs, r);
    } else if (shape < 1.5) {
      // A ring.
      m = 1.0 - smoothstep(0.07, 0.07 + aa, abs(r - 0.82));
    } else {
      // A petal: an ellipse.
      vec2 p = vUv * vec2(1.0, 1.8);
      m = 1.0 - smoothstep(0.9 - aa, 0.9, length(p));
    }
    float a = m * vParams.y;
    if (a < 0.003) discard;
    // The hot core: only it goes over the bloom threshold.
    float hot = vParams.w > 0.0 ? 1.0 - smoothstep(0.1, 0.24, r) : 0.0;
    vec3 col = mix(vColor, uCore * vParams.w, hot);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function instanced(count, attrs) {
  const geo = new THREE.InstancedBufferGeometry();
  // Two triangles; the corner (x, y) is the position attribute, so Three.js
  // counts the vertices.
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(attrs.corners), 2));
  const out = { geo, arrays: {} };
  for (const [name, size] of Object.entries(attrs.instance)) {
    const array = new Float32Array(count * size);
    const attr = new THREE.InstancedBufferAttribute(array, size);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, attr);
    out.arrays[name] = attr;
  }
  geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return out;
}

function overlayMaterial(vertexShader, fragmentShader, uniforms, depthTest = false) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest,
    // A flat ring faces down by its winding; draw both sides.
    side: THREE.DoubleSide,
    fog: false,
    lights: false,
  });
}

// Watch prefers-reduced-motion. Calls onChange(reduced) when it changes.
// Returns the current value and a stop function.
export function watchReducedMotion(win = globalThis.window, onChange = () => {}) {
  const mq = win?.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (!mq) return { reduced: false, stop() {} };
  const handler = (e) => onChange(Boolean(e.matches));
  mq.addEventListener?.("change", handler);
  return { reduced: Boolean(mq.matches), stop: () => mq.removeEventListener?.("change", handler) };
}

// The effects layer. `tier` is the quality tier, `anchors` the district
// anchors (styles.js districtAnchors()) for the accent color, `off` is
// ?fx=0. `win` is the window for the reduced-motion query.
export function createEffects({ scene, camera, renderer, tier, anchors = [], off = false, win = globalThis.window } = {}) {
  let reduced = false;
  const watch = watchReducedMotion(win, (r) => {
    reduced = r;
    applyPolicy();
  });
  reduced = watch.reduced;

  let policy = effectsPolicy(tier, { reducedMotion: reduced, off });
  let fx = createFx();
  let hold = false;
  let forceSpeed = null;
  const info = { lines: 0, spikes: 0, bursts: 0, impacts: 0, triggers: { bonk: 0, land: 0, grind: 0, beat: 0 } };
  // The draw calls of the effect meshes in the last frame (all passes).
  let draws = 0;
  let lastDraws = 0;
  const countDraw = () => {
    draws += 1;
  };

  // The screen mesh.
  const screen = instanced(SCREEN_MAX, { corners: [0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1], instance: { seg: 4, width: 3, tint: 4 } });
  const screenMat = overlayMaterial(screenVertex, screenFragment, { uRes: { value: new THREE.Vector2(1280, 720) } });
  const screenMesh = new THREE.Mesh(screen.geo, screenMat);
  screenMesh.name = "fx-screen";
  screenMesh.frustumCulled = false;
  screenMesh.renderOrder = 1001;
  screenMesh.visible = false;
  screenMesh.userData.overlay = true;

  // The burst mesh.
  const bursts = instanced(FX.burst.max, { corners: [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1], instance: { center: 3, color: 3, params: 4, orient: 2 } });
  const core = hexToLinear("#fff6e0");
  // The bursts test the depth: a building or the skater in front hides them.
  const burstMat = overlayMaterial(burstVertex, burstFragment, { uCore: { value: new THREE.Vector3(...core) } }, true);
  const burstMesh = new THREE.Mesh(bursts.geo, burstMat);
  burstMesh.name = "fx-bursts";
  burstMesh.frustumCulled = false;
  burstMesh.renderOrder = 1000;
  burstMesh.visible = false;
  burstMesh.userData.overlay = true;

  screenMesh.onAfterRender = countDraw;
  burstMesh.onAfterRender = countDraw;
  if (scene) {
    scene.add(burstMesh);
    scene.add(screenMesh);
  }

  const line = hexToLinear(LINE_COLOR).map((v) => v * FX.emissive.line);
  const accents = new Map();
  function accentAt(x, z) {
    const w = districtWeights(x, z, anchors);
    const id = Object.entries(w).sort((a, b) => b[1] - a[1])[0][0];
    if (!accents.has(id)) accents.set(id, accentEmissive((DISTRICT_LOOKS[id] ?? DISTRICT_LOOKS.trail).accent.map(hexToLinear)));
    return { id, color: accents.get(id) };
  }

  function applyPolicy() {
    policy = effectsPolicy(tier, { reducedMotion: reduced, off });
    if (!policy.enabled) {
      fx = createFx();
      screenMesh.visible = false;
      burstMesh.visible = false;
    }
  }

  const v = new THREE.Vector3();
  function anchorOf(skater) {
    const [x, y, z] = skater.position;
    v.set(x, y + 0.9, z).project(camera);
    const ax = v.x;
    const ay = v.y;
    const behind = v.z > 1;
    v.set(x, y + 1.75, z).project(camera);
    const hy = v.y;
    v.set(x, y, z).project(camera);
    return { x: ax, y: ay, r: behind ? 0 : Math.abs(hy - v.y) / 2 };
  }

  function writeSegments(list, color, widths, style, from) {
    const { seg, width, tint } = screen.arrays;
    let i = from;
    for (const s of list) {
      if (i >= SCREEN_MAX) break;
      seg.array.set([s.ax, s.ay, s.bx, s.by], i * 4);
      width.array.set([widths[0], widths[1], style], i * 3);
      tint.array.set([color[0], color[1], color[2], s.alpha], i * 4);
      i += 1;
    }
    return i;
  }

  function spawn(reason, position) {
    const { color } = accentAt(position[0], position[2]);
    // The ring lies on the ground around the feet; the star stands beside
    // the skater, on the camera's right, so the skater does not hide it.
    camera.getWorldDirection(v);
    const side = [-v.z, 0, v.x];
    const n = Math.hypot(side[0], side[2]) || 1;
    for (const spec of burstSpecs(reason, position, color, policy)) {
      const flat = spec.shape === "ring";
      const at = flat ? [position[0], position[1] + 0.06, position[2]] : [position[0] + (side[0] / n) * 0.7, position[1] + 0.9, position[2] + (side[2] / n) * 0.7];
      fx = addBurst(fx, { ...spec, position: at, flat });
    }
  }

  return {
    get policy() {
      return policy;
    },
    get reducedMotion() {
      return reduced;
    },
    // The district accent at (x, z), linear and scaled to the body emissive.
    accentAt,
    // A simulation tick: the skater before and after and the run's moves.
    observe(prev, next, moves = []) {
      if (!policy.enabled) return;
      for (const t of effectTriggers(prev, next, moves)) {
        info.triggers[t.reason] += 1;
        if (t.kind === "impact") {
          const before = fx.impact.seq;
          fx = startImpact(fx, t.reason, policy);
          if (fx.impact.seq !== before) info.impacts += 1;
        } else spawn(t.reason, next.position);
      }
    },
    // Add one particle (see fx.js addBurst()). The caller gates it with
    // its own policy row.
    burst(spec) {
      fx = addBurst(fx, spec);
    },
    // Each rendered frame, before the draw. `active` false (photo mode, a
    // pause) fades the speed lines and hides the layer.
    update(dt, { skater, active = true } = {}) {
      lastDraws = draws;
      draws = 0;
      if (!policy.enabled) return;
      fx = stepFx(fx, hold ? 0 : dt, { speed: forceSpeed ?? skater?.speed ?? 0, active });
      const size = renderer ? renderer.getDrawingBufferSize(new THREE.Vector2()) : new THREE.Vector2(1280, 720);
      screenMat.uniforms.uRes.value.copy(size);
      const aspect = size.x / Math.max(1, size.y);
      const pr = renderer ? Math.max(1, renderer.getPixelRatio()) : 1;
      const anchor = skater ? anchorOf(skater) : { x: 0, y: 0, r: 0 };

      let n = 0;
      const lines = active ? speedLineSegments(policy.lines, fx.time, anchor, aspect, fx.speed) : [];
      n = writeSegments(lines, line, [1.5 * pr, 3.5 * pr], 0, n);
      info.lines = lines.length;
      let spikes = [];
      if (active && fx.impact.frames > 0) {
        const frame = policy.impact - fx.impact.frames;
        spikes = impactSpikes(policy.spikes, fx.impact.seq, frame, anchor, aspect);
        const { color } = skater ? accentAt(skater.position[0], skater.position[2]) : { color: line };
        n = writeSegments(spikes, color, [14 * pr, 1.5 * pr], 1, n);
        if (!hold) fx = impactFrameDone(fx);
      }
      info.spikes = spikes.length;
      screen.geo.instanceCount = n;
      for (const a of Object.values(screen.arrays)) a.needsUpdate = true;
      screenMesh.visible = n > 0;

      const { center, color, params, orient } = bursts.arrays;
      let m = 0;
      if (active) {
        for (const b of fx.bursts) {
          const env = burstEnvelope(b.t / b.life);
          center.array.set(b.position, m * 3);
          color.array.set(b.color ?? line, m * 3);
          params.array.set([b.size * env.scale, env.alpha, SHAPES[b.shape] ?? 0, b.core ? FX.emissive.core : 0], m * 4);
          orient.array.set([b.rotation + b.spin * b.t, b.flat ? 1 : 0], m * 2);
          m += 1;
        }
      }
      bursts.geo.instanceCount = m;
      for (const a of Object.values(bursts.arrays)) a.needsUpdate = true;
      burstMesh.visible = m > 0;
      info.bursts = m;
    },
    // The screenshot hooks: show an effect and hold it still.
    trigger(kind, position) {
      if (!policy.enabled) return;
      if (kind === "speed") {
        forceSpeed = 99;
        fx = { ...fx, speed: 1 };
      } else if (kind === "impact") fx = startImpact({ ...fx, cooldown: 0 }, "bonk", policy);
      else if (position) {
        spawn(kind, position);
        // Age the new burst a little, so a held picture shows it grown.
        fx = stepFx(fx, FX.burst.life * 0.3, { speed: forceSpeed ?? 0 });
        if (forceSpeed) fx = { ...fx, speed: 1 };
      }
    },
    hold(on) {
      hold = Boolean(on);
      if (!on) forceSpeed = null;
    },
    clear() {
      fx = createFx();
      forceSpeed = null;
    },
    get info() {
      return { ...info, draws: lastDraws, enabled: policy.enabled, reducedMotion: reduced, policy: { ...policy }, speed: fx.speed, impactFrames: fx.impact.frames, visible: { screen: screenMesh.visible, bursts: burstMesh.visible } };
    },
    meshes: [screenMesh, burstMesh],
    dispose() {
      watch.stop();
      scene?.remove(screenMesh);
      scene?.remove(burstMesh);
      screen.geo.dispose();
      bursts.geo.dispose();
      screenMat.dispose();
      burstMat.dispose();
    },
  };
}
