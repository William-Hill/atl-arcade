import * as THREE from "three";
import { HEIGHT_FOG, bloomThreshold, districtLook, districtWeights, envForSky, timeGrade } from "./pbr-palette.js";
import { ENV_SKY, LOOKS, createSkyEnvironment } from "./look.js";
import { SKATER_RIM } from "./toon.js";
import { PBR_GRADE_GLSL } from "./post.js";

// The per-frame light of the pbr look (#160). Pure values come from
// src/render/pbr-palette.js; this module writes them to the scene:
//
// - the grade pass uniforms (src/render/post.js): the tone grade by time of
//   day and the light tint of the district at the camera. The phone tier
//   has a cheap grade pass (createLitePost()). The low tier has no post
//   pass: the same grade goes into the materials (installMaterialGrade(),
//   #195)
// - the fog color: the horizon color with a part of the district fog tint
// - the environment map: baked again from the sky when the sky colors move
//   (dusk, night, cloud), and its intensity follows the daylight, so the
//   night is not lit by a noon sky
// - the skater rim (src/render/toon.js SKATER_RIM)
// - the sun: the weather sun times LOOKS.pbr.sunScale
// - the bloom threshold: high in the day, so no sunlit surface glows
//
// installHeightFog() changes the Three.js fog chunks, so every material with
// fog gets the height fog. Call it once, before the first material compiles,
// and only in the pbr look.

const f4 = (v) => v.toFixed(4);

export function installHeightFog(f = HEIGHT_FOG) {
  const C = THREE.ShaderChunk;
  if (C.fog_fragment.includes("pbrHeightFog")) return;
  C.fog_pars_vertex = `#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying float vFogWorldY;\n#endif`;
  // The world height from the view-space position: the view matrix is a
  // rotation R and a move t, so the world point is R^T (mv - t).
  C.fog_vertex = `#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogWorldY = ((mvPosition.xyz - viewMatrix[3].xyz) * mat3(viewMatrix)).y;\n#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG\n\tuniform vec3 fogColor;\n\tvarying float vFogDepth;\n\tvarying float vFogWorldY;\n\t#ifdef FOG_EXP2\n\t\tuniform float fogDensity;\n\t#else\n\t\tuniform float fogNear;\n\t\tuniform float fogFar;\n\t#endif\n#endif`;
  // pbr-palette.js heightFogFactor(), for the linear fog. The exp2 fog
  // (not used by the levels) keeps the stock formula.
  C.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		// pbrHeightFog
		float fogFd = smoothstep( fogNear, fogFar, vFogDepth );
		float fogHk = exp( - max( vFogWorldY - cameraPosition.y - (${f4(f.base)}), 0.0 ) / ${f4(f.falloff)} );
		float fogFactor = fogFd * mix( ${f4(f.top)}, 1.0, fogHk );
		fogFactor = mix( fogFactor, 1.0, smoothstep( 0.85, 1.0, fogFd ) );
		fogFactor = max( fogFactor, ${f4(f.haze)} * fogHk * smoothstep( fogNear * ${f4(f.hazeStart)}, fogFar, vFogDepth ) );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}

// The material grade of the low tier and of the last governor rung (#195).
// These draws have no post pass, so each material applies the grade
// (src/render/post.js
// PBR_GRADE_GLSL) just before its tone mapping. The tone mapping runs only
// in a draw to the canvas, so a draw into a render target (the full post
// chain, the environment bake) gets no grade here.
//
// The values live in one shared object. Three.js copies the uniforms of a
// built-in material from THREE.ShaderLib, and it keeps a plain object by
// reference, so every material reads this one object. A ShaderMaterial
// does not get the uniform: GLSL gives it 0, so `on` is 0 and the grade is
// off (the identity).
export const MATERIAL_GRADE = { on: 0, contrast: 1, sat: 1, warm: 0, lift: 0, tint: [1, 1, 1] };

// Pure: the grade values for the time grade `g` (pbr-palette.js timeGrade())
// and the district look `d` (pbr-palette.js districtLook()). The grade pass
// and the material grade get the same values.
export function gradeValues(g, d) {
  return { contrast: g.contrast, sat: g.saturation * d.saturation, warm: g.warm, lift: g.lift ?? 0, tint: [d.tint[0], d.tint[1], d.tint[2]] };
}

// Changes the tone mapping chunks and the ShaderLib uniforms. Call it once,
// before the first material compiles to the canvas, and only in the pbr look.
export function installMaterialGrade(ref = MATERIAL_GRADE) {
  const C = THREE.ShaderChunk;
  if (C.tonemapping_fragment.includes("pbrGrade")) return;
  C.tonemapping_pars_fragment = `struct PbrMaterialGrade { float on; float contrast; float sat; float warm; float lift; vec3 tint; };
uniform PbrMaterialGrade pbrMaterialGrade;
${PBR_GRADE_GLSL}
${C.tonemapping_pars_fragment}`;
  C.tonemapping_fragment = `#if defined( TONE_MAPPING )
	if ( pbrMaterialGrade.on > 0.5 ) gl_FragColor.rgb = pbrGrade( gl_FragColor.rgb, pbrMaterialGrade.contrast, pbrMaterialGrade.sat, pbrMaterialGrade.warm, pbrMaterialGrade.lift, pbrMaterialGrade.tint );
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`;
  for (const shader of Object.values(THREE.ShaderLib)) shader.uniforms.pbrMaterialGrade = { value: ref };
}

// The sky light of the phone and low tiers (#191): the env map functions
// of the standard and physical materials read 9 spherical harmonics
// (look.js skyShFromScene()) and not the env map. On SwiftShader the map
// lookup was about a third of the pbr phone frame. The material keeps its
// envMapIntensity and the BRDF; only the lookup changes:
// - the diffuse sky light: the SH irradiance (as a light probe);
// - the reflection: the SH radiance in the reflection direction for a
//   smooth surface, the irradiance / PI for a rough one, mixed by the
//   roughness. The sky of these tiers has no clouds, so 9 coefficients hold
//   its gradient; a sharp reflection gets a soft sky.
// The 9 RGB values live in one shared plain object (a struct uniform):
// THREE copies an array of vectors into each material, but it keeps a plain
// object by reference, so setSkySh() reaches every material.
export const SKY_SH = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`c${i}`, new THREE.Vector3()]));

// Pure: true for a usable sky SH: 27 finite numbers with a lit mean (a
// failed read gives zeros, and the tiers would lose the whole sky light).
export function validSkySh(c) {
  return Array.isArray(c) && c.length === 27 && c.every(Number.isFinite) && c[0] + c[1] + c[2] > 1e-4;
}

export function setSkySh(coefficients, ref = SKY_SH) {
  if (!validSkySh(coefficients)) return;
  for (let i = 0; i < 9; i += 1) ref[`c${i}`].set(coefficients[i * 3], coefficients[i * 3 + 1], coefficients[i * 3 + 2]);
}

const SKY_SH_GLSL = /* glsl */ `
struct PbrSkySh { vec3 c0; vec3 c1; vec3 c2; vec3 c3; vec3 c4; vec3 c5; vec3 c6; vec3 c7; vec3 c8; };
uniform PbrSkySh pbrSkySh;
// pbrSkySh: the radiance (three SphericalHarmonics3.getAt) and the
// irradiance (shGetIrradianceAt) in a world direction.
vec3 pbrShRadiance(vec3 d) {
  return pbrSkySh.c0 * 0.282095
    + 0.488603 * (pbrSkySh.c1 * d.y + pbrSkySh.c2 * d.z + pbrSkySh.c3 * d.x)
    + 1.092548 * (pbrSkySh.c4 * d.x * d.y + pbrSkySh.c5 * d.y * d.z + pbrSkySh.c7 * d.x * d.z)
    + pbrSkySh.c6 * (0.315392 * (3.0 * d.z * d.z - 1.0))
    + pbrSkySh.c8 * (0.546274 * (d.x * d.x - d.y * d.y));
}
vec3 pbrShIrradiance(vec3 d) {
  return pbrSkySh.c0 * 0.886227
    + 1.023328 * (pbrSkySh.c1 * d.y + pbrSkySh.c2 * d.z + pbrSkySh.c3 * d.x)
    + 0.858086 * (pbrSkySh.c4 * d.x * d.y + pbrSkySh.c5 * d.y * d.z + pbrSkySh.c7 * d.x * d.z)
    + pbrSkySh.c6 * (0.743125 * d.z * d.z - 0.247708)
    + pbrSkySh.c8 * (0.429043 * (d.x * d.x - d.y * d.y));
}`;

// Call it once, before the first material compiles, and only in the pbr
// look on a tier with no cloud sky. The env map stays on the scene (it
// keeps USE_ENVMAP and envMapIntensity), but no shader samples it.
export function installSkySh(ref = SKY_SH) {
  const C = THREE.ShaderChunk;
  if (C.envmap_physical_pars_fragment.includes("pbrSkySh")) return;
  // Whitespace in three's chunk is free, so the matches allow any.
  const swaps = [
    [/#ifdef USE_ENVMAP\n/, `#ifdef USE_ENVMAP\n${SKY_SH_GLSL}\n`],
    [/vec4 envMapColor = textureCubeUV\( envMap, envMapRotation \* worldNormal, 1\.0 \);\s*return PI \* envMapColor\.rgb \* envMapIntensity;/, "return max( pbrShIrradiance( envMapRotation * worldNormal ), 0.0 ) * envMapIntensity;"],
    [
      /vec4 envMapColor = textureCubeUV\( envMap, envMapRotation \* reflectVec, roughness \);\s*return envMapColor\.rgb \* envMapIntensity;/,
      "vec3 skyDir = envMapRotation * reflectVec;\n\t\t\treturn max( mix( pbrShRadiance( skyDir ), pbrShIrradiance( skyDir ) * RECIPROCAL_PI, roughness ), 0.0 ) * envMapIntensity;",
    ],
  ];
  let chunk = C.envmap_physical_pars_fragment;
  for (const [from, to] of swaps) {
    if (!from.test(chunk)) throw new Error(`installSkySh: three's envmap chunk changed (${from.source.slice(0, 40)})`);
    chunk = chunk.replace(from, to);
  }
  C.envmap_physical_pars_fragment = chunk;
  for (const name of ["standard", "physical"]) THREE.ShaderLib[name].uniforms.pbrSkySh = { value: ref };
}

// The sky change that bakes the environment map again (max channel step,
// linear), and the shortest time between two bakes (s).
const ENV_REBAKE = { step: 0.025, seconds: 2 };
// The warm white half of the rim color.
const RIM_WARM = new THREE.Color(1, 0.95, 0.88);
const envGround = new THREE.Color();

export function createPbrLook({ scene, renderer, sky = null, geoLights = null, anchors = [], getPost = () => null, skySh = false }) {
  const L = LOOKS.pbr;
  // Before the first frame: the materials compile with the grade code.
  installMaterialGrade();
  const fogBase = scene.fog ? scene.fog.color.clone() : null;
  const fogTint = new THREE.Color();
  let baked = sky ? snapshot(sky) : null;
  let sinceBake = 0;
  let env = { intensity: 1, ground: 1 };
  let bakes = 0;
  const info = { district: "trail", weights: { trail: 1 }, grade: null, envBakes: 0, envIntensity: scene.environmentIntensity };

  function snapshot(s) {
    const u = s.mesh.material.uniforms;
    return [u.uZenith.value.r, u.uZenith.value.g, u.uZenith.value.b, u.uHorizon.value.r, u.uHorizon.value.g, u.uHorizon.value.b, u.uCover?.value ?? 0];
  }

  // The mean luma of the sky zenith and horizon colors (linear).
  function skyLuma(v) {
    const l = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return 0.5 * (l(v[0], v[1], v[2]) + l(v[3], v[4], v[5]));
  }

  function rebake() {
    const old = scene.environment;
    baked = snapshot(sky);
    env = envForSky(skyLuma(baked));
    // The ground disc is the bounce of the street: a sunlit pavement in the
    // day, the dim city glow at night.
    envGround.set(ENV_SKY.ground).multiplyScalar(env.ground);
    scene.environment = createSkyEnvironment(renderer, sky, { ground: envGround, sh: skySh });
    setSkySh(scene.environment.userData.sh);
    if (old) old.dispose();
    sinceBake = 0;
    bakes += 1;
  }

  return {
    info,
    // pos: the camera (or skater) position; state: the weather state
    // (weather-view.js), or null with ?weather=0. dt: seconds.
    update(pos, state, dt = 0) {
      sinceBake += dt;
      const w = districtWeights(pos.x, pos.z, anchors);
      const d = districtLook(w);
      const elevation = state ? state.sun.elevation : 50;
      const g = timeGrade(elevation, state ? state.cloudCover : 0);
      info.weights = w;
      info.district = Object.entries(w).sort((a, b) => b[1] - a[1])[0][0];
      info.grade = { ...g, saturation: g.saturation * d.saturation, tint: d.tint };

      const post = getPost();
      const u = post?.grade?.uniforms;
      const v = gradeValues(g, d);
      if (u) {
        u.uContrast.value = v.contrast;
        u.uSat.value = v.sat;
        u.uWarm.value = v.warm;
        if (u.uLift) u.uLift.value = v.lift;
        if (u.uTint) u.uTint.value.set(v.tint[0], v.tint[1], v.tint[2]);
      }
      // No grade pass (the low tier, or the last governor rung):
      // the materials apply the grade. With a grade pass they do not, so
      // the grade does not apply two times.
      Object.assign(MATERIAL_GRADE, v, { on: u ? 0 : 1 });
      info.materialGrade = MATERIAL_GRADE.on === 1;
      if (post?.bloom) post.bloom.threshold = bloomThreshold(state ? state.day : 1);

      // The fog: the weather writes the horizon color each frame; with no
      // weather the first fog color is the base.
      if (scene.fog) {
        if (!state && fogBase) scene.fog.color.copy(fogBase);
        // Less tint at night: the dark horizon keeps the night sky.
        const day = state ? state.day : 1;
        fogTint.setRGB(d.fog[0], d.fog[1], d.fog[2]).multiplyScalar(Math.max(0.15, day));
        scene.fog.color.lerp(fogTint, HEIGHT_FOG.tint * (0.4 + 0.6 * day));
      }

      // The environment map follows the sky (once the sky moved enough).
      if (sky && baked && sinceBake >= ENV_REBAKE.seconds) {
        const now = snapshot(sky);
        if (now.some((v, i) => Math.abs(v - baked[i]) > ENV_REBAKE.step)) rebake();
      }
      // The baked map is dark at night; envForSky() keeps a part of the light.
      scene.environmentIntensity = L.environment * env.intensity;
      info.envIntensity = scene.environmentIntensity;
      info.envBakes = bakes;

      // The skater rim: the sky color at the horizon, a part of the grade.
      SKATER_RIM.uRimStrength.value = g.rim;
      if (state) SKATER_RIM.uRimColor.value.setRGB(...state.horizon).lerp(RIM_WARM, 0.5);
      // The pbr sun: the weather writes the sun each frame, so the scale
      // does not add up. With no weather the sun keeps LOOKS.pbr.sun.
      if (geoLights && state) geoLights.sun.intensity *= L.sunScale;
      info.sun = geoLights ? geoLights.sun.intensity : null;
    },
  };
}
