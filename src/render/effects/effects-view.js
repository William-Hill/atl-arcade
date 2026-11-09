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
  screenAnchor,
  speedLineSegments,
  startImpact,
  stepFx,
} from "./fx.js";
import { dustSpecs, feelTriggers, sparkSpecs } from "./feel.js";

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
//
// Game feel (#105, feel.js) adds two particle kinds to the burst mesh, so
// they cost no draw call more: a dust puff on a landing and sparks while the
// skater slides along a wall.

const SCREEN_MAX = 40;
const NONE = Object.freeze([]);
const SHAPES = { star: 0, ring: 1, petal: 2, spark: 3, puff: 4 };

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
    } else if (shape < 2.5) {
      // A petal: an ellipse.
      vec2 p = vUv * vec2(1.0, 1.8);
      m = 1.0 - smoothstep(0.9 - aa, 0.9, length(p));
    } else if (shape < 3.5) {
      // A spark: a thin streak with a pale center.
      vec2 p = vUv * vec2(1.0, 5.0);
      m = 1.0 - smoothstep(0.6, 1.0, length(p));
    } else {
      // A dust puff: a soft disc.
      m = 0.85 * (1.0 - smoothstep(0.25, 1.0, r));
    }
    float a = m * vParams.y;
    if (a < 0.003) discard;
    // The hot core: only it goes over the bloom threshold.
    float hot = vParams.w > 0.0 ? 1.0 - smoothstep(0.1, 0.24, r) : 0.0;
    vec3 col = mix(vColor, uCore * vParams.w, hot);
    if (shape > 2.5 && shape < 3.5) col = mix(col, vec3(0.9, 0.82, 0.62), 1.0 - smoothstep(0.0, 0.45, length(vUv * vec2(1.0, 5.0))));
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
  const info = { lines: 0, spikes: 0, bursts: 0, impacts: 0, triggers: { bonk: 0, land: 0, grind: 0, beat: 0, dust: 0, sparks: 0 } };
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

  const screenAttrs = Object.values(screen.arrays);
  const burstAttrs = Object.values(bursts.arrays);
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
  // Kept, so a frame makes no new vector (review of #236).
  const size = new THREE.Vector2(1280, 720);
  const anchor = { x: 0, y: 0, r: 0 };
  const lineWidths = [0, 0];
  const spikeWidths = [0, 0];
  function anchorOf(skater) {
    const [x, y, z] = skater.position;
    // A point behind the camera projects mirrored (screenAnchor()). The
    // camera-space z tells which side of the camera the skater is on.
    v.set(x, y + 0.9, z).applyMatrix4(camera.matrixWorldInverse);
    const behind = v.z > 0;
    v.applyMatrix4(camera.projectionMatrix);
    const a = screenAnchor(v.x, v.y, behind);
    anchor.x = a.x;
    anchor.y = a.y;
    anchor.r = 0;
    if (!behind) {
      v.set(x, y + 1.75, z).project(camera);
      const hy = v.y;
      v.set(x, y, z).project(camera);
      anchor.r = Math.abs(hy - v.y) / 2;
    }
    return anchor;
  }

  // Write the attribute values by index: no temporary arrays each frame.
  function writeSegments(list, color, widths, style, from) {
    const seg = screen.arrays.seg.array;
    const width = screen.arrays.width.array;
    const tint = screen.arrays.tint.array;
    let i = from;
    for (const s of list) {
      if (i >= SCREEN_MAX) break;
      const a = i * 4;
      seg[a] = s.ax;
      seg[a + 1] = s.ay;
      seg[a + 2] = s.bx;
      seg[a + 3] = s.by;
      tint[a] = color[0];
      tint[a + 1] = color[1];
      tint[a + 2] = color[2];
      tint[a + 3] = s.alpha;
      const b = i * 3;
      width[b] = widths[0];
      width[b + 1] = widths[1];
      width[b + 2] = style;
      i += 1;
    }
    return i;
  }

  // Game feel (#105): the dust of a landing and the sparks of a wall slide.
  function spawnDust(position, strength, seed) {
    for (const spec of dustSpecs(position, strength, policy.dust, seed)) fx = addBurst(fx, spec);
  }
  function spawnSparks(skater, strength, tick) {
    const [vx, , vz] = skater.velocity ?? [0, 0, 0];
    const n = Math.hypot(vx, vz);
    // With no horizontal velocity, use the yaw (controller.js heading()).
    const yaw = skater.yaw ?? 0;
    const heading = n > 1e-6 ? [vx / n, vz / n] : [Math.cos(yaw), -Math.sin(yaw)];
    for (const spec of sparkSpecs(skater.position, heading, strength, policy.sparks, tick)) fx = addBurst(fx, spec);
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
      if (!policy.dust && !policy.sparks) return;
      const feel = feelTriggers(prev, next);
      if (feel.land && feel.land.strength > 0 && policy.dust) {
        info.triggers.dust += 1;
        spawnDust(next.position, feel.land.strength, next.tick ?? 0);
      }
      if (feel.slide && feel.slide.strength > 0 && policy.sparks) {
        info.triggers.sparks += 1;
        spawnSparks(next, feel.slide.strength, next.tick ?? 0);
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
      if (renderer) renderer.getDrawingBufferSize(size);
      screenMat.uniforms.uRes.value.copy(size);
      const aspect = size.x / Math.max(1, size.y);
      const pr = renderer ? Math.max(1, renderer.getPixelRatio()) : 1;
      if (skater) anchorOf(skater);
      else anchor.x = anchor.y = anchor.r = 0;

      let n = 0;
      const lines = active ? speedLineSegments(policy.lines, fx.time, anchor, aspect, fx.speed) : NONE;
      lineWidths[0] = 1.5 * pr;
      lineWidths[1] = 3.5 * pr;
      n = writeSegments(lines, line, lineWidths, 0, n);
      info.lines = lines.length;
      let spikes = NONE;
      if (active && fx.impact.frames > 0) {
        const frame = policy.impact - fx.impact.frames;
        spikes = impactSpikes(policy.spikes, fx.impact.seq, frame, anchor, aspect);
        const { color } = skater ? accentAt(skater.position[0], skater.position[2]) : { color: line };
        spikeWidths[0] = 14 * pr;
        spikeWidths[1] = 1.5 * pr;
        n = writeSegments(spikes, color, spikeWidths, 1, n);
        if (!hold) fx = impactFrameDone(fx);
      }
      info.spikes = spikes.length;
      screen.geo.instanceCount = n;
      // No upload when nothing draws.
      if (n > 0) for (const a of screenAttrs) a.needsUpdate = true;
      screenMesh.visible = n > 0;

      const center = bursts.arrays.center.array;
      const color = bursts.arrays.color.array;
      const params = bursts.arrays.params.array;
      const orient = bursts.arrays.orient.array;
      let m = 0;
      if (active) {
        for (const b of fx.bursts) {
          const env = burstEnvelope(b.t / b.life);
          const c = b.color ?? line;
          const i3 = m * 3;
          center[i3] = b.position[0];
          center[i3 + 1] = b.position[1];
          center[i3 + 2] = b.position[2];
          color[i3] = c[0];
          color[i3 + 1] = c[1];
          color[i3 + 2] = c[2];
          const i4 = m * 4;
          params[i4] = b.size * env.scale;
          params[i4 + 1] = env.alpha * (b.opacity ?? 1);
          params[i4 + 2] = SHAPES[b.shape] ?? 0;
          params[i4 + 3] = b.core ? FX.emissive.core : 0;
          orient[m * 2] = b.rotation + b.spin * b.t;
          orient[m * 2 + 1] = b.flat ? 1 : 0;
          m += 1;
        }
      }
      bursts.geo.instanceCount = m;
      if (m > 0) for (const a of burstAttrs) a.needsUpdate = true;
      burstMesh.visible = m > 0;
      info.bursts = m;
    },
    // The screenshot hooks: show an effect and hold it still.
    // Game feel (#105): trigger("dust", position, { strength }) and
    // trigger("sparks", position, { skater, strength }); `skater` gives the
    // heading of the sparks.
    trigger(kind, position, opts = {}) {
      if (!policy.enabled) return;
      if (kind === "dust" || kind === "sparks") {
        if (kind === "dust") spawnDust(position, opts.strength ?? 1, 1);
        // Sparks of several ticks, aged, so a held picture shows a spray.
        else for (let t = 0; t < 10; t += 1) {
          spawnSparks({ ...opts.skater, position }, opts.strength ?? 1, t);
          fx = stepFx(fx, 1 / 60, { speed: forceSpeed ?? 0 });
        }
        if (kind === "dust") fx = stepFx(fx, 0.16, { speed: forceSpeed ?? 0 });
        return;
      }
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
      return { ...info, triggers: { ...info.triggers }, draws: lastDraws, enabled: policy.enabled, reducedMotion: reduced, policy: { ...policy }, speed: fx.speed, impactFrames: fx.impact.frames, visible: { screen: screenMesh.visible, bursts: burstMesh.visible } };
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
