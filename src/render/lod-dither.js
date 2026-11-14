import * as THREE from "three";
import { DITHER_FULL, FADE_NONE, cameraJumped, createLodFade, fadeDraw } from "./lod-fade.js";

// The render side of the timed LOD fade (#279) for a BatchedMesh: a float
// texture with one dither value per instance, the shader patch that reads
// it, and the spare instances that draw the old shape during a fade.
// The fade state itself is in the pure module lod-fade.js.

// A 4x4 Bayer threshold on the screen pixel (0 < t < 1), and the discard
// rule of lod-fade.js: d < 1 fades in (draw when t < d), d > 1.5 fades out
// (draw when t >= d - 2), and d = 1 is the full shape.
const DITHER_GLSL = /* glsl */ `
varying float vLodDither;
float lodBayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int k = q.x + q.y * 4;
  int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(b[k]) + 0.5) / 16.0;
}`;

const DITHER_TEST = /* glsl */ `
if (vLodDither != 1.0) {
  float lodT = lodBayer4(gl_FragCoord.xy);
  if (vLodDither < 1.0 ? lodT >= vLodDither : lodT < vLodDither - 2.0) discard;
}`;

// Adds the dither to a material of the batch (the color material or the
// shadow depth material). `uniform` is { value: texture }. The patch runs
// after the material's own onBeforeCompile. A second call only changes the
// uniform.
export function addLodDither(material, uniform) {
  if (material.userData.lodDither) {
    material.userData.lodDither.value = uniform.value;
    return material;
  }
  material.userData.lodDither = uniform;
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey;
  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    if (before) before.call(this, shader, renderer);
    shader.uniforms.lodDitherTexture = material.userData.lodDither;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <batching_pars_vertex>",
        "#include <batching_pars_vertex>\nuniform highp sampler2D lodDitherTexture;\nvarying float vLodDither;",
      )
      .replace(
        "#include <batching_vertex>",
        [
          "#include <batching_vertex>",
          "#ifdef USE_BATCHING",
          "{",
          "  int lodSize = textureSize(lodDitherTexture, 0).x;",
          "  int lodId = int(getIndirectIndex(gl_DrawID));",
          "  vLodDither = texelFetch(lodDitherTexture, ivec2(lodId % lodSize, lodId / lodSize), 0).r;",
          "}",
          "#else",
          "vLodDither = 1.0;",
          "#endif",
        ].join("\n"),
      );
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", `${DITHER_GLSL}\nvoid main() {\n${DITHER_TEST}`);
  };
  material.customProgramCacheKey = function customProgramCacheKey() {
    return `${key ? key.call(this) : ""}|lod-dither`;
  };
  material.needsUpdate = true;
  return material;
}

// The fade of one BatchedMesh. The caller adds the `count` main instances
// first (ids 0 to count - 1), with room for `copies` more instances.
// geometryOf(i, lod) gives the geometry id of instance i at a LOD.
// Options: enabled, duration, colors (copy the instance color to the fade
// copy), clock (s).
export function createBatchFade(mesh, count, copies, { geometryOf, enabled = true, duration, colors = false, clock = () => performance.now() / 1000 } = {}) {
  const fade = createLodFade(count, { enabled, duration });
  const total = count + copies;
  const size = Math.max(1, Math.ceil(Math.sqrt(total)));
  const data = new Float32Array(size * size).fill(DITHER_FULL);
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const uniform = { value: texture };
  let dirty = false;

  // The LOD each instance shows now (-1 hidden), so a call is made only on
  // a change.
  const shown = new Int8Array(total).fill(-1);
  const free = [];
  const copyOf = new Int32Array(count).fill(-1);
  for (let k = 0; k < copies; k += 1) {
    const id = mesh.addInstance(geometryOf(0, 1));
    mesh.setVisibleAt(id, false);
    free.push(id);
  }
  const m = new THREE.Matrix4();
  const c = new THREE.Color();

  function show(id, i, lod, dither) {
    if (lod !== shown[id]) {
      if (lod < 0) mesh.setVisibleAt(id, false);
      else {
        mesh.setGeometryIdAt(id, geometryOf(i, lod));
        if (shown[id] < 0) mesh.setVisibleAt(id, true);
      }
      shown[id] = lod;
    }
    const d = lod < 0 ? DITHER_FULL : dither;
    if (data[id] !== d) {
      data[id] = d;
      dirty = true;
    }
  }

  function releaseCopy(i) {
    const id = copyOf[i];
    if (id < 0) return;
    show(id, i, -1, DITHER_FULL);
    free.push(id);
    copyOf[i] = -1;
  }

  // Draws instance i (and its copy) for its fade state at `now`.
  function apply(i, now) {
    const { main, copy } = fadeDraw(fade.from[i], fade.lod[i], fade.progress(i, now));
    if (copy && copyOf[i] < 0) {
      const id = free.pop();
      if (id === undefined) {
        // No free copy: a hard switch for this instance.
        fade.finish(i);
        show(i, i, fade.lod[i], DITHER_FULL);
        info.dropped += 1;
        return;
      }
      copyOf[i] = id;
      mesh.getMatrixAt(i, m);
      mesh.setMatrixAt(id, m);
      if (colors) {
        mesh.getColorAt(i, c);
        mesh.setColorAt(id, c);
      }
    }
    show(i, i, main.lod, main.dither);
    if (copy) show(copyOf[i], i, copy.lod, copy.dither);
    else releaseCopy(i);
  }

  const info = { enabled, copies, fading: 0, copiesUsed: 0, started: 0, dropped: 0 };
  let last = null;
  let now = 0;
  let snap = true;

  return {
    uniform,
    texture,
    info,
    fade,
    // Call once per update, before set(). The first update and an update
    // after a camera jump (a teleport, a fast travel) make hard switches.
    begin(cameraPosition, time = clock()) {
      now = time;
      snap = cameraJumped(last, cameraPosition);
      last = { x: cameraPosition.x, z: cameraPosition.z };
      if (snap) {
        for (const i of fade.activeList()) releaseCopy(i);
        fade.finishAll((i) => apply(i, now));
      }
    },
    // Sets the LOD of instance i.
    set(i, lod) {
      const kind = fade.set(i, lod, now, snap);
      if (kind === FADE_NONE) return;
      if (fade.fading(i)) info.started += 1;
      apply(i, now);
    },
    fading(i) {
      return fade.fading(i);
    },
    // Moves the fade copy of instance i to the instance (a moving car).
    follow(i) {
      const id = copyOf[i];
      if (id < 0) return;
      mesh.getMatrixAt(i, m);
      mesh.setMatrixAt(id, m);
    },
    // Call once per update, after set(): moves each fade on, and ends the
    // fades that are done.
    end() {
      for (const i of fade.activeList()) apply(i, now);
      fade.step(now, (i) => apply(i, now));
      info.fading = fade.active;
      info.copiesUsed = copies - free.length;
      if (dirty) {
        texture.needsUpdate = true;
        dirty = false;
      }
    },
    // Ends every fade now (for a test or a teleport outside update()).
    snap() {
      last = null;
    },
  };
}

// Puts the dither on the batch's material and on its shadow depth
// material. A depth material that a caller sets later (for example the
// leaf cut of the trees) gets the dither too, so a shadow does not pop.
export function ditherBatch(mesh, uniform) {
  addLodDither(mesh.material, uniform);
  let depth = addLodDither(new THREE.MeshDepthMaterial(), { value: uniform.value });
  Object.defineProperty(mesh, "customDepthMaterial", {
    configurable: true,
    enumerable: true,
    get: () => depth,
    set: (mat) => {
      depth = mat ? addLodDither(mat, { value: uniform.value }) : mat;
    },
  });
}
